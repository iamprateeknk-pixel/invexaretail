import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from './otp-auth.js';
import { executeRaw, prisma, queryRaw, resolveDatabaseUrl } from './db.js';
import { saveImportedCustomValues } from './import-custom-values.js';
import type { CompanyProfileRecord, CountAssignmentRecord, CountRecord, ItemRecord, LocationRecord, TransferRecord, UserRecord } from './repository.js';
import type { AuditEvent } from './audit.js';
import { transferCartons, companyProfile, counts, countAssignments, dailyMovements, items, locations, saveCompanyProfile, setCompanyProfile, stockLedger, syncCheckpoints, transfers, users } from './repository.js';
import { enhancedUsers } from './enterprise-repository.js';
import type { Role } from './inventory.js';
import { aggregateOpeningStock, type StockImportPreview } from './stock-import.js';
import { countRowToRecord } from './count-record-mapper.js';
import { itemRowToRecord } from './item-record-mapper.js';
import { transferRowToRecord, transferCartonRowToRecord } from './transfer-record-mapper.js';
import type { DailyMovementRecord, LotRecord, SyncCheckpointRecord } from './repository.js';
import { getIndustryPack, hydrateActiveWorkflow, setActiveWorkflow, workflowFromPack } from './industry-packs.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID, adoptHydratedOwnership, itemsForCompany, locationsForCompany, registerItemCompany, registerLocationCompany, scopedImportKey } from './saas/tenant-scope.js';
import { assertValidCountReviewTransition, transitionTransferStatus, type CountReviewStatus } from './domain-policies.js';
import { DomainError } from './errors.js';
import { postInventoryMovementInTransaction } from './inventory-posting-service.js';
import { journalTypeForImport, syncJournalToBalances } from './import-journal-sync.js';
import { replaceContents, pushAll } from './array-utils.js';

export const databaseEnabled = Boolean(resolveDatabaseUrl());

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  assignedLocationIds: string[];
};

const demoUsers: Record<string, AuthenticatedUser> = {
  'admin@retail.local': { id: 'user-admin-1', email: 'admin@retail.local', role: 'ADMIN', assignedLocationIds: ['loc-1', 'loc-2', 'wh-1'] },
  'manager@retail.local': { id: 'user-manager-1', email: 'manager@retail.local', role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] },
  'store@retail.local': { id: 'user-store-1', email: 'store@retail.local', role: 'STORE_USER', assignedLocationIds: ['loc-1'] },
  'picker@retail.local': { id: 'user-picker-1', email: 'picker@retail.local', role: 'WAREHOUSE_PICKER', assignedLocationIds: ['wh-1'] },
  'auditor@retail.local': { id: 'user-auditor-1', email: 'auditor@retail.local', role: 'AUDITOR', assignedLocationIds: ['loc-1'] },
};

export function parseAssignedLocations(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    // Legacy Hostinger rows can contain blank or malformed assignment data.
    // Authentication must remain available; an admin can repair assignments.
    return [];
  }
}

export async function authenticateUser(email: string, password: string, requestedRole?: Role): Promise<AuthenticatedUser> {
  if (!databaseEnabled) {
    const user = demoUsers[email.toLowerCase()];
    const developmentPassword = process.env.SEED_PASSWORD;
    if (!developmentPassword || !user || password !== developmentPassword) throw new Error('Invalid email or password.');
    if (requestedRole && requestedRole !== user.role) throw new Error('Requested role does not match the user.');
    return user;
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error('Invalid email or password.');
  if (user.passwordHash.startsWith('$2')) {
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new Error('Invalid email or password.');
  } else {
    // Legacy sha256 hash: verify-only (see lib/otp-auth.ts). A success
    // upgrades the stored hash to bcrypt, so the weak format is never
    // accepted for this account again - migrate-on-login.
    if (!verifyPassword(password, user.passwordHash)) throw new Error('Invalid email or password.');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    assignedLocationIds: parseAssignedLocations(user.assignedLocations),
  };
}

function requireDatabase(): void {
  if (!databaseEnabled) {
    throw new Error('Database persistence is disabled. Set DATABASE_URL to the Postgres database.');
  }
}

// Row-to-record mappers for the document arrays, shared by full hydration and the delta refresh below
// (item/count/transfer mappings live in their own mapper modules for the same reason). Local copies of
// the assignment/movement/checkpoint mappings also exist in their repositories — pre-existing duplication
// recorded in docs/db-first-reads-plan.md, not something this slice widens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function locationRowToRecord(location: any): LocationRecord {
  return {
    id: location.id,
    name: location.name,
    type: location.type as 'store' | 'warehouse',
    sortOrder: location.sortOrder,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userRowToRecord(user: any): UserRecord {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    assignedLocationIds: parseAssignedLocations(user.assignedLocations),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assignmentRowToRecord(row: any): CountAssignmentRecord {
  return {
    id: row.id,
    locationId: row.locationId,
    itemId: row.itemId,
    assignedToId: row.assignedToId,
    assignedById: row.assignedById,
    countDate: row.countDate.toISOString(),
    dueDate: row.dueDate?.toISOString(),
    priority: (row.priority as CountAssignmentRecord['priority']) || 'NORMAL',
    instructions: row.instructions ?? undefined,
    status: row.status,
    countId: row.countId ?? undefined,
    parentCountId: row.parentCountId ?? undefined,
    campaignId: (row as { campaignId?: string | null }).campaignId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function movementRowToRecord(row: any): DailyMovementRecord {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    itemId: row.itemId,
    lotId: row.lotId ?? undefined,
    locationId: row.locationId,
    movementType: row.movementType,
    qtyDelta: Number(row.qtyDelta),
    transactionAt: row.transactionAt.toISOString(),
    sourceType: row.sourceType as DailyMovementRecord['sourceType'],
    sourceReference: row.sourceReference,
    importBatchId: row.importBatchId ?? undefined,
    createdById: row.createdById,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkpointRowToRecord(row: any): SyncCheckpointRecord {
  return {
    locationId: row.locationId,
    sourceType: row.sourceType as SyncCheckpointRecord['sourceType'],
    syncedThroughAt: row.syncedThroughAt.toISOString(),
    lastImportBatchId: row.lastImportBatchId ?? '',
  };
}

function maxDate(values: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const value of values) {
    if (value && (!max || value > max)) max = value;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Delta refresh (ULTRA P1, issue #184): the reconciler used to re-run the FULL
// hydration above every 30s per replica — every location, item+lot, count,
// transfer+line, assignment and user of every company, whether anything had
// changed or not. The delta path instead keeps a per-table `updatedAt`
// watermark from the last full load and, per tick, fetches only rows changed
// since then (InventoryMovement, which has no updatedAt, uses importedAt).
// Nested changes are followed to their parent: a changed Lot reloads its Item,
// a changed TransferLine reloads its Transfer.
//
// Two things a watermark cannot see, handled explicitly rather than ignored:
//   - hard deletes: a per-table row-count check runs every tick; a database
//     count below the snapshot's length falls back to a full hydration (a
//     delete masked by a simultaneous insert is caught by the periodic full
//     refresh below);
//   - brand-new companies: the CompanyProfile id set is re-read every tick
//     and any change falls back to a full hydration.
// A full hydration also runs unconditionally every DATABASE_DELTA_FULL_REFRESH_EVERY
// delta ticks (default 20), so ordering drift from in-place merges is bounded.
// All rows are fetched BEFORE anything is merged, so a failed tick leaves the
// last good snapshot and the watermarks untouched (the reconciler counts the
// failure and keeps serving, exactly as before).
// ---------------------------------------------------------------------------

type DeltaWatermarks = {
  companiesKey: string;
  location: Date | null;
  item: Date | null;
  lot: Date | null;
  count: Date | null;
  transfer: Date | null;
  transferLine: Date | null;
  assignment: Date | null;
  user: Date | null;
  carton: Date | null;
  checkpoint: Date | null;
  movementImportedAt: Date | null;
};

let deltaWatermarks: DeltaWatermarks | null = null;
let deltaTickCount = 0;

export type DeltaRefreshStats = {
  mode: 'full' | 'delta' | 'none';
  lastRunAt: string | null;
  rowsLoaded: number;
  fullRefreshes: number;
  deltaRefreshes: number;
};

const deltaStats: DeltaRefreshStats = { mode: 'none', lastRunAt: null, rowsLoaded: 0, fullRefreshes: 0, deltaRefreshes: 0 };

/** Snapshot-refresh provenance for /ops/metrics: which mode last ran, when, and how many rows it loaded. */
export function deltaRefreshStats(): DeltaRefreshStats {
  return { ...deltaStats };
}

/** How often a delta tick is replaced by a full hydration (env-tunable; never below 2). */
export function deltaFullRefreshEvery(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.DATABASE_DELTA_FULL_REFRESH_EVERY ?? 20);
  return Number.isFinite(configured) ? Math.max(2, Math.floor(configured)) : 20;
}

function mergeById<T extends { id: string }>(target: T[], rows: T[]): void {
  if (!rows.length) return;
  const indexById = new Map(target.map((row, index) => [row.id, index] as const));
  for (const row of rows) {
    const at = indexById.get(row.id);
    if (at === undefined) {
      indexById.set(row.id, target.length);
      target.push(row);
    } else {
      target[at] = row;
    }
  }
}

export async function refreshRepositoryDeltaFromDatabase(): Promise<void> {
  if (!databaseEnabled) return;
  deltaTickCount += 1;
  const watermarks = deltaWatermarks;
  if (!watermarks || deltaTickCount % deltaFullRefreshEvery() === 0) {
    await hydrateRepositoryFromDatabase();
    return;
  }

  const profileCompanyIds = (await prisma.companyProfile.findMany({ select: { id: true } })).map((company) => company.id);
  const companyIds = [...new Set([DEFAULT_COMPANY_ID, ...profileCompanyIds])];
  if (companyIds.join(',') !== watermarks.companiesKey) {
    await hydrateRepositoryFromDatabase();
    return;
  }

  // Deletion detection: row counts are cheap aggregates. Only a count BELOW the snapshot's
  // length falls back to a full hydration — an insert makes the database count HIGHER, and the
  // delta queries below see new rows on their own (a fresh row's updatedAt is past the
  // watermark). A delete masked by a simultaneous insert keeps counts equal and is caught by
  // the periodic full refresh instead. The movements table is exempt (the snapshot
  // intentionally caps it at 10,000 rows) and cartons are counted globally because hydration
  // loads them unscoped, exactly like the snapshot does.
  const [locationCount, itemCount, countCount, transferCount, assignmentCount, userCount, cartonCount] = await Promise.all([
    prisma.location.count({ where: { companyId: { in: companyIds } } }),
    prisma.item.count({ where: { companyId: { in: companyIds } } }),
    prisma.stockCount.count({ where: { companyId: { in: companyIds } } }),
    prisma.transfer.count({ where: { companyId: { in: companyIds } } }),
    prisma.countAssignment.count({ where: { location: { companyId: { in: companyIds } } } }),
    prisma.user.count({ where: { companyId: { in: companyIds } } }),
    prisma.transferCarton.count(),
  ]);
  if (
    locationCount < locations.length
    || itemCount < items.length
    || countCount < counts.length
    || transferCount < transfers.length
    || assignmentCount < countAssignments.length
    || userCount < users.length
    || cartonCount < transferCartons.length
  ) {
    await hydrateRepositoryFromDatabase();
    return;
  }

  const since = (watermark: Date | null) => (watermark ? { gte: watermark } : undefined);

  // Fetch phase — nothing below mutates the snapshot until every query has succeeded.
  const [changedLocations, changedItems, changedLots, changedCounts, changedTransfers, changedLines, changedAssignments, changedUsers, changedCartons, changedCheckpoints, changedMovements] = await Promise.all([
    prisma.location.findMany({ where: { companyId: { in: companyIds }, updatedAt: since(watermarks.location) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.item.findMany({ where: { companyId: { in: companyIds }, updatedAt: since(watermarks.item) }, include: { lots: true } }),
    prisma.lot.findMany({ where: { item: { companyId: { in: companyIds } }, updatedAt: since(watermarks.lot) }, select: { itemId: true, updatedAt: true } }),
    prisma.stockCount.findMany({ where: { companyId: { in: companyIds }, updatedAt: since(watermarks.count) } }),
    prisma.transfer.findMany({ where: { companyId: { in: companyIds }, updatedAt: since(watermarks.transfer) }, include: { lines: true } }),
    prisma.transferLine.findMany({ where: { transfer: { companyId: { in: companyIds } }, updatedAt: since(watermarks.transferLine) }, select: { transferId: true, updatedAt: true } }),
    prisma.countAssignment.findMany({ where: { location: { companyId: { in: companyIds } }, updatedAt: since(watermarks.assignment) } }),
    prisma.user.findMany({ where: { companyId: { in: companyIds }, updatedAt: since(watermarks.user) } }),
    prisma.transferCarton.findMany({ where: { updatedAt: since(watermarks.carton) }, orderBy: { createdAt: 'asc' } }),
    prisma.syncCheckpoint.findMany({ where: { updatedAt: since(watermarks.checkpoint) } }),
    prisma.inventoryMovement.findMany({ where: { importedAt: since(watermarks.movementImportedAt) }, orderBy: { transactionAt: 'desc' }, take: 10_000 }),
  ]);

  // Parents of changed nested rows must be reloaded whole, or the snapshot would keep the old
  // nested copy forever (a lot's expiry edit touches only the Lot row, not its Item).
  const itemIdsToReload = new Set(changedLots.map((lot) => lot.itemId));
  for (const itemId of [...itemIdsToReload]) {
    if (changedItems.some((item) => item.id === itemId)) itemIdsToReload.delete(itemId);
  }
  const transferIdsToReload = new Set(changedLines.map((line) => line.transferId));
  for (const transferId of [...transferIdsToReload]) {
    if (changedTransfers.some((transfer) => transfer.id === transferId)) transferIdsToReload.delete(transferId);
  }
  const [reloadedItems, reloadedTransfers] = await Promise.all([
    itemIdsToReload.size
      ? prisma.item.findMany({ where: { id: { in: [...itemIdsToReload] }, companyId: { in: companyIds } }, include: { lots: true } })
      : Promise.resolve([]),
    transferIdsToReload.size
      ? prisma.transfer.findMany({ where: { id: { in: [...transferIdsToReload] }, companyId: { in: companyIds } }, include: { lines: true } })
      : Promise.resolve([]),
  ]);

  // Merge phase.
  mergeById(locations, changedLocations.map(locationRowToRecord));
  // Keep the admin-chosen location order after in-place merges (stable sort: equal sortOrder
  // keeps the existing relative order; the periodic full refresh restores exact createdAt order).
  locations.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const mergedItems = [...changedItems, ...reloadedItems].map(itemRowToRecord);
  mergeById(items, mergedItems);
  mergeById(counts, changedCounts.map((count) => countRowToRecord(count, 'STORE_USER')));
  mergeById(users, changedUsers.map(userRowToRecord));
  mergeById(countAssignments, changedAssignments.map(assignmentRowToRecord));
  mergeById(transfers, [...changedTransfers, ...reloadedTransfers].map(transferRowToRecord));
  mergeById(transferCartons, changedCartons.map(transferCartonRowToRecord));

  // Register ownership for rows this tick introduced. Deliberately NOT adoptHydratedOwnership:
  // that helper rebuilds both ownership maps from its input, which is only safe for a full load.
  for (const location of changedLocations) registerLocationCompany(location.id, (location as { companyId?: string }).companyId);
  for (const item of [...changedItems, ...reloadedItems]) registerItemCompany(item.id, (item as { companyId?: string }).companyId);

  for (const row of changedCheckpoints) {
    if (row.sourceType !== 'SALES' && row.sourceType !== 'PURCHASE') continue;
    const record = checkpointRowToRecord(row);
    const at = syncCheckpoints.findIndex((entry) => entry.locationId === record.locationId && entry.sourceType === record.sourceType);
    if (at === -1) syncCheckpoints.push(record);
    else syncCheckpoints[at] = record;
  }

  if (changedMovements.length) {
    const changed = changedMovements.map(movementRowToRecord);
    const changedIds = new Set(changed.map((row) => row.id));
    replaceContents(dailyMovements, [...changed, ...dailyMovements.filter((row) => !changedIds.has(row.id))]
      .sort((a, b) => b.transactionAt.localeCompare(a.transactionAt))
      .slice(0, 10_000));
  }

  // Advance the watermarks only now that every merge succeeded.
  deltaWatermarks = {
    companiesKey: watermarks.companiesKey,
    location: maxDate([...changedLocations.map((row) => row.updatedAt), watermarks.location]),
    item: maxDate([...changedItems.map((row) => row.updatedAt), ...reloadedItems.map((row) => row.updatedAt), watermarks.item]),
    lot: maxDate([...changedLots.map((row) => row.updatedAt), ...[...changedItems, ...reloadedItems].flatMap((row) => row.lots.map((lot) => lot.updatedAt)), watermarks.lot]),
    count: maxDate([...changedCounts.map((row) => row.updatedAt), watermarks.count]),
    transfer: maxDate([...changedTransfers.map((row) => row.updatedAt), ...reloadedTransfers.map((row) => row.updatedAt), watermarks.transfer]),
    transferLine: maxDate([...changedLines.map((row) => row.updatedAt), ...[...changedTransfers, ...reloadedTransfers].flatMap((row) => row.lines.map((line) => line.updatedAt)), watermarks.transferLine]),
    assignment: maxDate([...changedAssignments.map((row) => row.updatedAt), watermarks.assignment]),
    user: maxDate([...changedUsers.map((row) => row.updatedAt), watermarks.user]),
    carton: maxDate([...changedCartons.map((row) => row.updatedAt), watermarks.carton]),
    checkpoint: maxDate([...changedCheckpoints.map((row) => row.updatedAt), watermarks.checkpoint]),
    movementImportedAt: maxDate([...changedMovements.map((row) => row.importedAt), watermarks.movementImportedAt]),
  };

  deltaStats.mode = 'delta';
  deltaStats.lastRunAt = new Date().toISOString();
  deltaStats.rowsLoaded = changedLocations.length + changedItems.length + reloadedItems.length + changedCounts.length
    + changedTransfers.length + reloadedTransfers.length + changedAssignments.length + changedUsers.length
    + changedCartons.length + changedCheckpoints.length + changedMovements.length;
  deltaStats.deltaRefreshes += 1;
}

export async function hydrateRepositoryFromDatabase(): Promise<void> {
  if (!databaseEnabled) return;

  // `CompanyProfile` predates multi-tenant operational data and production's
  // singleton row is still keyed as `default`, while Location/User/Item rows
  // use `default-company`.  Treating profile ids as the complete tenant list
  // therefore emptied every operational in-memory mirror after a restart.
  // Keep profile-backed tenants, but always hydrate the canonical legacy/default
  // operational tenant as well.
  const profileCompanyIds = (await prisma.companyProfile.findMany({ select: { id: true } })).map((company) => company.id);
  const companyIds = [...new Set([DEFAULT_COMPANY_ID, ...profileCompanyIds])];

  // Phase 5 step 15 (hydration slimming): StockLedger is deliberately NOT
  // loaded into the snapshot any more. Every stock read goes to the
  // database through lib/repositories/stock-repository.ts, and every
  // DB-mode stock write is a canonical posting — a hydrated copy would be
  // a second, stale stock truth (R1) that nothing may read. The snapshot
  // keeps the document arrays (locations, items, counts, transfers,
  // assignments, users), which the reconciler continues to refresh.
  const [dbLocations, dbItems, dbCounts, dbTransfers, dbAssignments, dbUsers] = await Promise.all([
    prisma.location.findMany({ where: { companyId: { in: companyIds } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.item.findMany({ where: { companyId: { in: companyIds } }, include: { lots: true } }),
    prisma.stockCount.findMany({ where: { companyId: { in: companyIds } } }),
    prisma.transfer.findMany({ where: { companyId: { in: companyIds } }, include: { lines: true } }),
    prisma.countAssignment.findMany({ where: { location: { companyId: { in: companyIds } } } }),
    prisma.user.findMany({ where: { companyId: { in: companyIds } } }),
  ]);

  replaceContents(locations, dbLocations.map(locationRowToRecord));

  replaceContents(items, dbItems.map(itemRowToRecord));

  adoptHydratedOwnership({
    locations: dbLocations.map((location) => ({ id: location.id, companyId: (location as { companyId?: string }).companyId })),
    items: dbItems.map((item) => ({ id: item.id, companyId: (item as { companyId?: string }).companyId })),
  });

  // The role is not stored on StockCount; the snapshot keeps its historical placeholder (see lib/repositories/count-repository.ts).
  replaceContents(counts, dbCounts.map((count) => countRowToRecord(count, 'STORE_USER')));

  replaceContents(users, dbUsers.map(userRowToRecord));

  replaceContents(countAssignments, dbAssignments.map(assignmentRowToRecord));

  replaceContents(transfers, dbTransfers.map(transferRowToRecord));

  // Delta-refresh watermarks (see refreshRepositoryDeltaFromDatabase): the newest updatedAt this
  // full load saw per table, so the next reconciler tick only needs rows changed since here.
  deltaWatermarks = {
    companiesKey: companyIds.join(','),
    location: maxDate(dbLocations.map((row) => row.updatedAt)),
    item: maxDate(dbItems.map((row) => row.updatedAt)),
    lot: maxDate(dbItems.flatMap((row) => row.lots.map((lot) => lot.updatedAt))),
    count: maxDate(dbCounts.map((row) => row.updatedAt)),
    transfer: maxDate(dbTransfers.map((row) => row.updatedAt)),
    transferLine: maxDate(dbTransfers.flatMap((row) => row.lines.map((line) => line.updatedAt))),
    assignment: maxDate(dbAssignments.map((row) => row.updatedAt)),
    user: maxDate(dbUsers.map((row) => row.updatedAt)),
    carton: null,
    checkpoint: null,
    movementImportedAt: null,
  };

  try {
    const dbCartons = await prisma.transferCarton.findMany({ orderBy: { createdAt: 'asc' } });
    replaceContents(transferCartons, dbCartons.map(transferCartonRowToRecord));
    if (deltaWatermarks) deltaWatermarks.carton = maxDate(dbCartons.map((row) => row.updatedAt));
  } catch (error) {
    console.warn('Transfer cartons could not be hydrated:', error instanceof Error ? error.message : error);
  }

  // These tables were introduced after the original Hostinger deployment.
  // Keep startup compatible while the migration is pending, then hydrate them
  // normally once present so sync state survives an API restart.
  try {
    const [dbMovements, dbCheckpoints] = await Promise.all([
      prisma.inventoryMovement.findMany({ orderBy: { transactionAt: 'desc' }, take: 10_000 }),
      prisma.syncCheckpoint.findMany(),
    ]);
    replaceContents(dailyMovements, dbMovements.map(movementRowToRecord));
    replaceContents(syncCheckpoints, dbCheckpoints
      .filter((row) => row.sourceType === 'SALES' || row.sourceType === 'PURCHASE')
      .map(checkpointRowToRecord));
    if (deltaWatermarks) {
      deltaWatermarks.movementImportedAt = maxDate(dbMovements.map((row) => row.importedAt));
      deltaWatermarks.checkpoint = maxDate(dbCheckpoints.map((row) => row.updatedAt));
    }
  } catch (error) {
    console.warn('Daily sync tables are not available yet; run the Hostinger migration.', error instanceof Error ? error.message : error);
  }

  deltaStats.fullRefreshes += 1;
  deltaStats.mode = 'full';
  deltaStats.lastRunAt = new Date().toISOString();
  deltaStats.rowsLoaded = dbLocations.length + dbItems.length + dbCounts.length + dbTransfers.length + dbAssignments.length + dbUsers.length;
}

export async function hydrateAuditFromDatabase(): Promise<AuditEvent[]> {
  if (!databaseEnabled) return [];
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function loadTransferPickSlips(transferId: string): Promise<AuditEvent[]> {
  if (!databaseEnabled) return [];
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'Transfer', entityId: transferId, action: 'PICK_SLIP_SAVED' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function persistItem(item: ItemRecord, companyId = 'default-company'): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const operationalFields = {
    countMethod: item.countMethod,
    pickMethod: item.pickMethod,
    allocationStrategy: item.allocationStrategy,
    lotRequired: item.lotRequired,
    expiryRequired: item.expiryRequired,
    decimalQuantity: item.decimalQuantity,
  };
  // The full item state is written every time, so a cleared optional field
  // must become NULL (an undefined key would leave the old value in place).
  const masterFields = {
    status: item.status ?? 'ACTIVE',
    archiveReason: item.archiveReason ?? null,
    archivedAt: item.archivedAt ? new Date(item.archivedAt) : null,
    archivedById: item.archivedById ?? null,
    barcode: item.barcode ?? null,
    hsn: item.hsn ?? null,
    gstRate: item.gstRate ?? null,
    mrp: item.mrp ?? null,
    leadTimeDays: item.leadTimeDays ?? null,
    shelfLifeDays: item.shelfLifeDays ?? null,
    aliases: (item.aliases?.length ? item.aliases : Prisma.JsonNull) as Prisma.InputJsonValue,
    version: item.version ?? 1,
    createdById: item.createdById ?? null,
    updatedById: item.updatedById ?? null,
  };
  await prisma.item.upsert({
    where: { id: item.id },
    update: { code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit, ...operationalFields, ...masterFields } as any,
    create: { id: item.id, code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, companyId, tenantId: DEFAULT_TENANT_ID, unit: item.unit, ...operationalFields, ...masterFields } as any,
  });
  for (const lot of item.lots) {
    await prisma.lot.upsert({
      where: { id: lot.id },
      update: { lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue },
      create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue },
    });
  }
}

function importId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value.trim().toLowerCase()).digest('hex').slice(0, 20)}`;
}

export type StockImportCommitResult = {
  /** Values of the company's custom import columns written onto items (set when the file had any). */
  customValues?: { fields: number; values: number; unmatchedItems: number };
  customValuesError?: string;
  batchId: string;
  importedItems: number;
  importedLots: number;
  importedLocations: number;
  stockRows: number;
};

/**
 * Commits a validated opening-stock workbook as an immutable snapshot and sets
 * current on-hand for each matching location/item/lot. IDs are deterministic,
 * so retrying after a network interruption cannot create duplicate masters.
 */
export async function persistOpeningStockImport(
  preview: StockImportPreview,
  fileName: string,
  importedBy: string,
  options?: { batchId?: string; fileHash?: string; branchId?: string | null; companyId?: string },
): Promise<StockImportCommitResult> {
  const companyId = options?.companyId || 'default-company';
  const rows = aggregateOpeningStock(preview.validRows);
  // Only this company's own locations and items can be matched. Matching the process-wide lists let one company's
  // file rewrite another company's item master and set stock at another company's branch.
  const ownLocations = locationsForCompany(companyId, locations);
  const ownItems = itemsForCompany(companyId, items);
  const locationMap = new Map(ownLocations.map((row) => [row.name.trim().toLowerCase(), row]));
  const itemCodeMap = new Map(ownItems.map((row) => [row.code.trim().toLowerCase(), row]));
  const itemNameMap = new Map(ownItems.map((row) => [`${(row.category ?? '').trim().toLowerCase()}|${row.name.trim().toLowerCase()}`, row]));
  const newLocations: LocationRecord[] = [];
  const newItems: ItemRecord[] = [];
  const touchedItems = new Map<string, ItemRecord>();
  const newLots: ItemRecord['lots'] = [];
  const lotMap = new Map(ownItems.flatMap((item) => item.lots.map((lot) => [`${item.id}|${lot.lotNo.trim().toLowerCase()}`, lot] as const)));
  const prepared = rows.map((row) => {
    const locationKey = row.locationName!.trim().toLowerCase();
    let location = locationMap.get(locationKey);
    if (!location) {
      const normalizedLocation = row.locationName!.toLowerCase().replace(/[^a-z0-9]+/g, '');
      location = { id: importId('loc-erp', scopedImportKey(companyId, locationKey)), name: row.locationName!, type: normalizedLocation === 'hobasni' || normalizedLocation === 'basni' ? 'warehouse' : 'store' };
      locationMap.set(locationKey, location);
      newLocations.push(location);
    }

    const nameKey = `${(row.category ?? '').trim().toLowerCase()}|${row.itemName.trim().toLowerCase()}`;
    let item = itemCodeMap.get(row.code.toLowerCase()) ?? itemNameMap.get(nameKey);
    if (!item) {
      item = { id: importId('item-erp', scopedImportKey(companyId, row.code)), code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit, lots: [] };
      itemCodeMap.set(row.code.toLowerCase(), item);
      itemNameMap.set(nameKey, item);
      newItems.push(item);
    } else {
      item.name = row.itemName || item.name;
      item.category = row.category || item.category;
      item.subcategory = row.subcategory || item.subcategory;
      item.company = row.companyName || item.company;
      item.unit = row.unit || item.unit;
    }
    touchedItems.set(item.id, item);

    const lotKey = row.lotNo!.trim().toLowerCase();
    let lot = lotMap.get(`${item.id}|${lotKey}`);
    if (!lot) {
      lot = {
        id: importId('lot-erp', `${item.id}|${lotKey}`),
        itemId: item.id,
        lotNo: row.lotNo!,
        expiryDate: row.expiryDate,
        attributes: {
          source: 'opening-stock-import',
          companyName: row.companyName,
          batch: row.batch,
          purchaseValue: row.purchaseValue,
          saleValue: row.saleValue,
          purchaseRate: row.quantity ? (row.purchaseValue ?? 0) / row.quantity : null,
          saleRate: row.quantity ? (row.saleValue ?? 0) / row.quantity : null,
        },
      };
      lotMap.set(`${item.id}|${lotKey}`, lot);
      newLots.push(lot);
    } else if (row.expiryDate) {
      lot.expiryDate = row.expiryDate;
    }
    return { row, item, lot, location };
  });

  const batchId = options?.batchId ?? importId('imp-opening', `${fileName}|${importedBy}|${Date.now()}`);
  if (databaseEnabled) {
    requireDatabase();
    await prisma.$transaction(async (tx) => {
      if (newLocations.length) {
        await tx.location.createMany({
          data: newLocations.map((location) => ({
            id: location.id,
            code: `ERP-${location.id.slice(-12).toUpperCase()}`,
            name: location.name,
            type: location.type,
            companyId,
          })),
          skipDuplicates: true,
        });
      }
      const itemMasters = [...touchedItems.values()];
      for (let offset = 0; offset < itemMasters.length; offset += 500) {
        const chunk = itemMasters.slice(offset, offset + 500);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "Item" (id, code, name, category, subcategory, company, "companyId", unit, "createdAt", "updatedAt")
          VALUES ${Prisma.join(chunk.map((item) => Prisma.sql`(
            ${item.id}, ${item.code}, ${item.name}, ${item.category ?? null}, ${item.subcategory ?? null},
            ${item.company ?? null}, ${companyId}, ${item.unit}, NOW(), NOW()
          )`))}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory, company = EXCLUDED.company, unit = EXCLUDED.unit, "updatedAt" = NOW()
        `);
      }
      if (newLots.length) {
        await tx.lot.createMany({
          data: newLots.map((lot) => ({
            id: lot.id,
            itemId: lot.itemId,
            lotNo: lot.lotNo,
            expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null,
            attributes: lot.attributes as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
      const lotsWithExpiry = [...lotMap.values()].filter((lot) => lot.expiryDate);
      for (let offset = 0; offset < lotsWithExpiry.length; offset += 400) {
        const chunk = lotsWithExpiry.slice(offset, offset + 400);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Lot" SET "expiryDate" = CASE id
            ${Prisma.join(chunk.map((lot) => Prisma.sql`WHEN ${lot.id} THEN ${new Date(lot.expiryDate!)}::timestamp`), ' ')}
          END, "updatedAt" = NOW()
          WHERE id IN (${Prisma.join(chunk.map((lot) => Prisma.sql`${lot.id}`))})
        `);
      }

      await tx.importBatch.upsert({
        where: { id: batchId },
        create: {
          id: batchId,
          type: 'OPENING_STOCK',
          companyId,
          fileName,
          sourceFormat: preview.format,
          importedById: importedBy,
          totalRows: preview.totalRows,
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          metadata: { branches: preview.branches, mapping: preview.mapping, negativeQuantityRows: preview.negativeQuantityRows, fractionalQuantityRows: preview.fractionalQuantityRows },
          status: 'POSTED',
          fileHash: options?.fileHash,
          branchId: options?.branchId ?? null,
        },
        update: {
          status: 'POSTED',
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          metadata: { branches: preview.branches, mapping: preview.mapping, negativeQuantityRows: preview.negativeQuantityRows, fractionalQuantityRows: preview.fractionalQuantityRows },
        },
      });

      for (let offset = 0; offset < prepared.length; offset += 500) {
        const chunk = prepared.slice(offset, offset + 500);
        await tx.openingStockSnapshot.createMany({
          data: chunk.map(({ row, item, lot, location }) => ({
            id: importId('opening', `${batchId}|${item.id}|${lot.id}|${location.id}`),
            importBatchId: batchId,
            itemId: item.id,
            lotId: lot.id,
            locationId: location.id,
            qty: row.quantity ?? 0,
            snapshotAt: new Date(preview.snapshotAt),
          })),
          skipDuplicates: true,
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "StockLedger" (id, "itemId", "lotId", "locationId", "onHand", reserved, "inTransit", version, "lastUpdatedAt", "companyId")
          VALUES ${Prisma.join(chunk.map(({ row, item, lot, location }) => Prisma.sql`(
            ${importId('stock', `${item.id}|${lot.id}|${location.id}`)}, ${item.id}, ${lot.id}, ${location.id},
            ${row.quantity ?? 0}, 0, 0, 1, NOW(), ${companyId}
          )`))}
          ON CONFLICT ("companyId","itemId","lotId","locationId") DO UPDATE SET "onHand" = EXCLUDED."onHand", version = "StockLedger".version + 1, "lastUpdatedAt" = NOW()
        `);
        // The movement journal must explain this balance too (lib/import-journal-sync.ts).
        await syncJournalToBalances(tx, chunk.map(({ item, lot, location }) => ({ itemId: item.id, lotId: lot.id, locationId: location.id })), {
          companyId, batchId, actor: importedBy, movementType: 'OPENING_STOCK',
          reason: 'Opening stock import: balance set by file',
        });
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  pushAll(locations, newLocations);
  pushAll(items, newItems);
  for (const location of newLocations) registerLocationCompany(location.id, companyId);
  for (const item of newItems) registerItemCompany(item.id, companyId);
  for (const lot of newLots) {
    const item = items.find((candidate) => candidate.id === lot.itemId);
    if (item && !item.lots.some((candidate) => candidate.id === lot.id)) item.lots.push(lot);
  }
  // Memory mode only: the snapshot ledger is the demo's stock store, so an
  // opening-stock import maintains it directly. In database mode the
  // transaction above is the write and the snapshot holds no stock at all
  // (Phase 5 step 15), so there is no mirror copy to maintain.
  if (!databaseEnabled) for (const { row, item, lot, location } of prepared) {
    const existing = stockLedger.find((entry) => entry.itemId === item.id && entry.lotId === lot.id && entry.locationId === location.id);
    if (existing) {
      existing.onHand = row.quantity ?? 0;
      existing.version += 1;
    } else {
      stockLedger.push({ itemId: item.id, lotId: lot.id, locationId: location.id, onHand: row.quantity ?? 0, quarantine: 0, version: 1 });
    }
  }

  const customValues = await saveImportedCustomValuesSafely(companyId, preview.validRows);
  return { batchId, importedItems: newItems.length, importedLots: newLots.length, importedLocations: newLocations.length, stockRows: prepared.length, ...customValues };
}

/**
 * Custom-column values are written after the stock itself is committed. A failure here must not roll
 * back (or hide) a stock import that already succeeded, so it is reported on the result instead.
 */
export async function saveImportedCustomValuesSafely(
  companyId: string,
  rows: Array<{ code: string; extra?: Record<string, string | number | null> }>,
): Promise<Pick<StockImportCommitResult, 'customValues' | 'customValuesError'>> {
  if (!rows.some((row) => row.extra && Object.keys(row.extra).length)) return {};
  try {
    return { customValues: await saveImportedCustomValues(companyId, rows) };
  } catch (error) {
    console.error('Custom column values could not be saved', error);
    return { customValuesError: 'Stock was imported, but the custom column values could not be saved. Re-import the file to retry them.' };
  }
}

export async function persistDailyMovementImport(input: { batchId: string; importType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT' | string; fileName: string; importedBy: string; totalRows: number; invalidRows: number; duplicateRows: number; transactionFrom?: string; transactionTo?: string; movements: DailyMovementRecord[]; lots: LotRecord[]; checkpoints: SyncCheckpointRecord[]; fileHash?: string; branchId?: string | null; sourceFormat?: string; metadata?: Record<string, unknown>; companyId?: string }): Promise<{ committedRows: number }> {
  if (!databaseEnabled) return { committedRows: input.movements.length };
  const companyId = input.companyId || 'default-company';
  requireDatabase();
  let committedRows = 0;
  await prisma.$transaction(async (tx) => {
    const metadata = { transactionFrom: input.transactionFrom, transactionTo: input.transactionTo, ...(input.metadata ?? {}) };
    await tx.importBatch.upsert({
      where: { id: input.batchId },
      create: {
        id: input.batchId,
        type: input.importType,
        companyId,
        fileName: input.fileName,
        sourceFormat: input.sourceFormat ?? 'daily-erp-export',
        importedById: input.importedBy,
        totalRows: input.totalRows,
        validRows: input.movements.length,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        metadata,
        status: 'POSTED',
        fileHash: input.fileHash,
        branchId: input.branchId ?? null,
        sourceDateFrom: input.transactionFrom ? new Date(input.transactionFrom) : null,
        sourceDateTo: input.transactionTo ? new Date(input.transactionTo) : null,
      },
      update: {
        status: 'POSTED',
        validRows: input.movements.length,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        metadata,
      },
    });
    for (const lot of input.lots) await tx.lot.upsert({ where: { itemId_lotNo: { itemId: lot.itemId, lotNo: lot.lotNo } }, update: { expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : undefined, attributes: lot.attributes as Prisma.InputJsonValue }, create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue } });
    // Import in bounded chunks so 5,000+ lot rows do not time out the
    // database connection. Existing dedupe keys are excluded before ledger updates,
    // preventing a retried file from changing stock twice.
    for (let offset = 0; offset < input.movements.length; offset += 400) {
      const chunk = input.movements.slice(offset, offset + 400);
      const existing = await tx.inventoryMovement.findMany({
        where: { dedupeKey: { in: chunk.map((movement) => movement.dedupeKey) } },
        select: { dedupeKey: true },
      });
      const existingKeys = new Set(existing.map((entry) => entry.dedupeKey));
      const fresh = chunk.filter((movement) => !existingKeys.has(movement.dedupeKey));
      if (!fresh.length) continue;
      await tx.inventoryMovement.createMany({
        data: fresh.map((movement) => ({ id: movement.id, dedupeKey: movement.dedupeKey, itemId: movement.itemId, lotId: movement.lotId, locationId: movement.locationId, movementType: movement.movementType, qtyDelta: movement.qtyDelta, transactionAt: new Date(movement.transactionAt), sourceType: movement.sourceType, sourceReference: movement.sourceReference, importBatchId: input.batchId, createdById: movement.createdById, metadata: movement.metadata as Prisma.InputJsonValue })),
        skipDuplicates: true,
      });
      committedRows += fresh.length;
      const ledgerRows = fresh.filter((movement) => movement.lotId);
      if (ledgerRows.length) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "StockLedger" (id, "itemId", "lotId", "locationId", "onHand", reserved, "inTransit", version, "lastUpdatedAt", "companyId")
          VALUES ${Prisma.join(ledgerRows.map((movement) => Prisma.sql`(
            ${importId('stock', `${movement.itemId}|${movement.lotId}|${movement.locationId}`)},
            ${movement.itemId}, ${movement.lotId!}, ${movement.locationId}, ${movement.qtyDelta}, 0, 0, 1, NOW(), ${companyId}
          )`))}
          ON CONFLICT ("companyId","itemId","lotId","locationId") DO UPDATE SET "onHand" = "StockLedger"."onHand" + EXCLUDED."onHand", version = "StockLedger".version + 1, "lastUpdatedAt" = NOW()
        `);
        // Journal the net effect of this chunk (lib/import-journal-sync.ts); a re-sent file adds nothing.
        await syncJournalToBalances(tx, ledgerRows.map((movement) => ({ itemId: movement.itemId, lotId: movement.lotId!, locationId: movement.locationId })), {
          companyId, batchId: input.batchId, actor: input.importedBy, movementType: journalTypeForImport(String(input.importType)),
          reason: `${input.importType} import ${input.fileName}`,
        });
      }
    }
    for (const checkpoint of input.checkpoints) {
      const key = { locationId_sourceType: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType } };
      const next = new Date(checkpoint.syncedThroughAt);
      const existing = await tx.syncCheckpoint.findUnique({ where: key });
      // Only ever move forward: a backfill of an older day must not regress the branch.
      if (existing && existing.syncedThroughAt >= next) continue;
      await tx.syncCheckpoint.upsert({ where: key, update: { syncedThroughAt: next, lastImportBatchId: input.batchId }, create: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType, syncedThroughAt: next, lastImportBatchId: input.batchId } });
    }
  }, { maxWait: 10_000, timeout: 120_000 });
  return { committedRows };
}

/** Best-effort removal of a count whose sibling lots failed to save (weight counts are all-or-nothing). */
export async function persistCountDeletion(id: string, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.delete({ where: { id, companyId } }).catch(() => undefined);
}

export async function persistCount(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.upsert({
    where: { id: count.id, companyId },
    update: {
      physicalQty: count.physicalQuantity,
      bookQty: count.bookQty,
      mode: count.mode,
      parentCountId: count.parentCountId ?? null,
    },
    create: {
      id: count.id,
      itemId: count.itemId,
      lotId: count.lotId,
      locationId: count.locationId,
      physicalQty: count.physicalQuantity,
      bookQty: count.bookQty,
      mode: count.mode,
      submittedById: count.submittedBy,
      parentCountId: count.parentCountId ?? null,
      requestId: count.requestId ?? null,
      companyId,
    } as never,
  });
}

/**
 * Persists a count review decision. On APPROVED this also posts the
 * resulting variance to the stock ledger, in the same transaction, so the
 * count status and the on-hand quantity can never disagree.
 */
/** Writes the reconciliation state (and a recomputed book quantity) of a count. */
export async function persistCountReconciliation(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.update({
    where: { id: count.id, companyId },
    data: {
      bookQty: count.bookQty,
      reconciliationRequired: count.reconciliationRequired ?? false,
      reconciliationNote: count.reconciliationNote ?? null,
      reconciliationAt: count.reconciliationAt ? new Date(count.reconciliationAt) : null,
      bookQtyOriginal: count.bookQtyOriginal ?? null,
      lateDelta: count.lateDelta ?? 0,
      lateMovementKeys: (count.lateMovementKeys ?? []) as unknown as Prisma.InputJsonValue,
    } as never,
  });
}

export async function persistCountReview(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();

  // Week 7: name the legal moves centrally instead of relying only on the
  // `WHERE reviewStatus = 'PENDING_REVIEW'` claim below to reject a bad
  // target status. The claim still does the concurrency-safe part (two
  // simultaneous reviews of the same count can't both win); this rejects an
  // illegal *target* (e.g. something other than APPROVED/REJECTED/RECOUNT)
  // before the transaction opens, with a stable error code and an audit row.
  await assertValidCountReviewTransition(
    'PENDING_REVIEW',
    (count.status ?? 'PENDING_REVIEW') as CountReviewStatus,
    count.id,
    { actorId: count.reviewedBy ?? 'system', actorRole: count.role ?? 'UNKNOWN', reason: count.reviewReason },
  );

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.stockCount.updateMany({
      where: { id: count.id, companyId, reviewStatus: 'PENDING_REVIEW' },
      data: {
        approvedById: count.status === 'APPROVED' ? count.reviewedBy : null,
        approvedAt: (count.status === 'APPROVED' || count.status === 'REJECTED' || count.status === 'RECOUNT') && count.reviewedAt
          ? new Date(count.reviewedAt)
          : null,
        reviewStatus: count.status ?? 'PENDING_REVIEW',
        reviewReason: count.reviewReason ?? null,
        reasonCode: count.reasonCode ?? null,
      },
    });
    if (claimed.count !== 1) {
      throw new DomainError('CONCURRENT_UPDATE_CONFLICT', 'Stock count was already reviewed; variance was not posted again.');
    }

    if (count.status === 'APPROVED') {
      const variance = count.physicalQuantity - count.bookQty;
      const ledger = await tx.stockLedger.findUnique({
        where: { companyId_itemId_lotId_locationId: { companyId, itemId: count.itemId, lotId: count.lotId, locationId: count.locationId } },
      });
      // Posted through the canonical service in this same transaction (journal + ledger +
      // audit + outbox with the review). A count with no ledger row yet establishes stock
      // at the physical quantity. The review claim above already guarantees one posting;
      // the idempotency key is the second, independent guard.
      await postInventoryMovementInTransaction(tx, {
        tenant: {
          companyId, tenantId: DEFAULT_TENANT_ID,
          userId: count.reviewedBy ?? 'system', role: (count.role ?? 'ADMIN') as Role,
        },
        itemId: count.itemId, lotId: count.lotId, locationId: count.locationId,
        movementType: 'COUNT_VARIANCE', qtyDelta: ledger ? variance : count.physicalQuantity,
        idempotencyKey: `count-variance:${count.id}`,
        reason: count.reviewReason ?? 'Approved stock count variance', sourceDocument: count.id, sourceLineId: count.id, correlationId: count.id,
        metadata: { countId: count.id, physicalQuantity: count.physicalQuantity, bookQty: count.bookQty },
      });
    }
  });
}

export async function persistCountAssignment(assignment: CountAssignmentRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.create({
    data: {
      id: assignment.id,
      locationId: assignment.locationId,
      itemId: assignment.itemId,
      assignedToId: assignment.assignedToId,
      assignedById: assignment.assignedById,
      countDate: new Date(assignment.countDate),
      dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
      priority: assignment.priority ?? 'NORMAL',
      instructions: assignment.instructions,
      status: assignment.status,
      parentCountId: assignment.parentCountId ?? null,
      campaignId: assignment.campaignId ?? null,
    } as any,
  });
}

export async function persistCountAssignmentUpdate(assignment: CountAssignmentRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.update({
    where: { id: assignment.id },
    data: {
      assignedToId: assignment.assignedToId,
      countDate: new Date(assignment.countDate),
      dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
      priority: assignment.priority ?? 'NORMAL',
      instructions: assignment.instructions ?? null,
      status: assignment.status,
      countId: assignment.countId ?? null,
      parentCountId: assignment.parentCountId ?? null,
    },
  });
}

export async function persistCountAssignmentDelete(assignmentId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.delete({ where: { id: assignmentId } });
}

export async function persistAssignmentSubmitted(assignmentId: string, countId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.update({ where: { id: assignmentId }, data: { status: 'SUBMITTED', countId } });
}

export async function persistTransfer(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
  await prisma.transfer.upsert({
    where: { id: transfer.id, companyId },
    update: { status: status as any, notes: transfer.notes, cartonCount: transfer.cartonCount ?? null },
    create: {
      id: transfer.id,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      requestedById: transfer.requestedBy,
      status: status as any,
      notes: transfer.notes,
      cartonCount: transfer.cartonCount ?? null,
      companyId,
      lines: { create: transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
    },
  });
}

function transferReservationTotals(transfer: TransferRecord): Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }> {
  const totals = new Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }>();
  for (const line of transfer.lines) {
    const key = `${line.itemId}\u0000${line.lotId}\u0000${transfer.sourceLocationId}`;
    const current = totals.get(key);
    if (current) current.quantity += line.quantity;
    else totals.set(key, { itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity });
  }
  return totals;
}

export async function persistTransferReplacement(current: TransferRecord, next: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    const currentTotals = transferReservationTotals(current);
    const nextTotals = transferReservationTotals(next);
    // Per-key delta adjustment (Wave 3, P1-3): the previous release-all /
    // reserve-all pair read each ledger row, decided in JS and wrote the
    // absolute value back - the read-decide-write anti-pattern
    // reservation.ts's header documents, with a window where the
    // reservation briefly vanished. Each key now moves exactly once,
    // atomically, inside this transaction: increases go through the same
    // conditional UPDATE as reserveStockForTransfer (the row only moves
    // when enough unreserved stock remains), decreases clamp at zero
    // like releaseReservedStock.
    for (const key of new Set([...currentTotals.keys(), ...nextTotals.keys()])) {
      const currentLine = currentTotals.get(key);
      const nextLine = nextTotals.get(key);
      const line = (nextLine ?? currentLine)!;
      const delta = (nextLine?.quantity ?? 0) - (currentLine?.quantity ?? 0);
      if (delta > 0) {
        const affected = await executeRaw(
          tx,
          `UPDATE "StockLedger"
           SET reserved = reserved + ?, version = version + 1
           WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ?
             AND "companyId" = ?
             AND ("onHand" - reserved) >= ?`,
          delta,
          line.itemId,
          line.lotId,
          line.locationId,
          companyId,
          delta,
        );
        if (affected === 0) {
          const [existing] = await queryRaw<Array<{ onHand: number; reserved: number }>>(
            tx,
            `SELECT "onHand"::float8 AS "onHand", reserved::float8 AS reserved FROM "StockLedger" WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ? AND "companyId" = ?`,
            line.itemId,
            line.lotId,
            line.locationId,
            companyId,
          );
          const available = existing ? existing.onHand - existing.reserved : 0;
          throw new Error(`Only ${Math.max(0, available)} units are available for lot ${line.lotId} at this location - ${delta} were requested.`);
        }
      } else if (delta < 0) {
        await executeRaw(
          tx,
          `UPDATE "StockLedger"
           SET reserved = GREATEST(0, reserved - ?), version = version + 1
           WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ? AND "companyId" = ?`,
          -delta,
          line.itemId,
          line.lotId,
          line.locationId,
          companyId,
        );
      }
    }
    await tx.transferLine.deleteMany({ where: { transferId: current.id } });
    await tx.transfer.update({
      where: { id: current.id, companyId },
      data: {
        sourceLocationId: next.sourceLocationId,
        destinationLocationId: next.destinationLocationId,
        notes: next.notes ?? null,
        cartonCount: next.cartonCount ?? null,
        lines: { create: next.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
      },
    });
  });
}

export async function persistTransferDeletion(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    for (const line of transferReservationTotals(transfer).values()) {
      const ledger = await tx.stockLedger.findUnique({
        where: { companyId_itemId_lotId_locationId: { companyId, itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      if (ledger) {
        await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: Math.max(0, Number(ledger.reserved) - line.quantity), version: { increment: 1 } } });
      }
    }
    await tx.transferLine.deleteMany({ where: { transferId: transfer.id } });
    await tx.transfer.delete({ where: { id: transfer.id, companyId } });
  });
}

export async function persistTransferCarton(carton: import('./transfer-packing.js').TransferCartonRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const contents = { lines: carton.lines, packedById: carton.packedById, sealedAt: carton.sealedAt, requestId: carton.requestId ?? null };
  await prisma.transferCarton.upsert({
    where: { id: carton.id },
    update: { status: carton.status, contents: contents as never },
    create: {
      id: carton.id, transferId: carton.transferId, cartonNumber: carton.cartonNumber, qrCode: carton.packageId,
      contents: contents as never, quantity: carton.quantity, weight: carton.weightKg ?? null, status: carton.status,
    },
  });
}

/** Packing completion / dispatch details / carton count for a transfer. */
export async function persistTransferLogistics(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.transfer.update({
    where: { id: transfer.id, companyId },
    data: { cartonCount: transfer.cartonCount ?? null, logistics: { packing: transfer.packing ?? null, dispatch: transfer.dispatch ?? null } as never },
  });
}

export async function persistTransferAssignedPicker(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.transfer.update({
    where: { id: transfer.id, companyId },
    data: { assignedPickerId: transfer.assignedPickerId ?? null },
  });
}

export async function persistTransferStatus(
  transfer: TransferRecord,
  actor: { id: string; role: Role; companyId: string },
): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await transitionTransferStatus({
    entityId: transfer.id,
    companyId: actor.companyId,
    to: transfer.status,
    role: actor.role,
    actorId: actor.id,
  });
}

export async function persistConfirmedPickAllocations(
  transferId: string,
  allocations: Array<{ itemId: string; lotId: string; locationId: string; quantity: number }>,
  tenant: import('./tenant-context.js').TenantContext,
): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findFirst({ where: { id: transferId, companyId: tenant.companyId } });
    if (!transfer) throw new Error('Transfer was not found.');
    if (['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED'].includes(String(transfer.status))) {
      throw new Error('Transfer is already confirmed and stock cannot be deducted twice.');
    }
    for (const allocation of allocations) {
      const ledger = await tx.stockLedger.findUnique({
        where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
      });
      if (!ledger || Number(ledger.onHand) < allocation.quantity) throw new Error(`Insufficient current stock for lot ${allocation.lotId}.`);
      // Stock leaves the source through the canonical service, in this transaction.
      const outPost = await postInventoryMovementInTransaction(tx, {
        tenant,
        itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId,
        movementType: 'TRANSFER_OUT', qtyDelta: -allocation.quantity,
        idempotencyKey: `transfer-confirm:${transferId}:${allocation.itemId}:${allocation.lotId}:${allocation.locationId}`,
        reason: 'Transfer pick confirmed', sourceDocument: transferId, correlationId: transferId,
        // Marks the leg as tracked in transit, so the receipt only releases what this confirm added.
        metadata: { inTransit: true },
      });
      // Stock in flight stays visible on the source lot row until the receipt releases it (audit O-7).
      // Skipped when this confirm was already applied (duplicate idempotent post), so a replay cannot double it.
      if (!outPost.duplicate) {
        await tx.stockLedger.updateMany({
          where: { companyId: tenant.companyId, itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId },
          data: { inTransit: { increment: allocation.quantity } },
        });
      }
    }
    await tx.transfer.update({ where: { id: transferId, companyId: tenant.companyId }, data: { status: 'CONFIRMED' as any } });
  }, { maxWait: 10_000, timeout: 60_000 });
}

// Company self-registration writes the new admin into enhancedUsers (see
// enterprise-repository.ts) so it can log in immediately, but that array is
// in-memory only and startup's hydrateDatabase() (index.ts) overwrites it
// wholesale from the User table on every restart. Without this, a user
// created after boot is silently gone on the next one - not because the
// process restarted, but because hydration replaces the very array their
// row lived in with what the database has, which never received it either.
export async function persistEnterpriseUser(user: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  locationIds: string[];
  companyId?: string;
}): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      role: user.role,
      assignedLocations: JSON.stringify(user.locationIds ?? []),
      companyId: user.companyId ?? DEFAULT_COMPANY_ID,
    },
  });
}

export async function hydrateAuthUsers(): Promise<number> {
  if (!databaseEnabled) return enhancedUsers.length;
  requireDatabase();
  const { ensureDailySyncSchema } = await import('./runtime-schema.js');
  await prisma.$queryRaw`SELECT 1`;
  await ensureDailySyncSchema();
  const dbUsers = await prisma.user.findMany();
  enhancedUsers.length = 0;
  for (const user of dbUsers) {
    enhancedUsers.push({
      id: user.id,
      companyId: (user as { companyId?: string }).companyId || DEFAULT_COMPANY_ID,
      name: user.name,
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
      branchIds: [],
      locationIds: parseAssignedLocations(user.assignedLocations),
      status: 'active',
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });
  }
  return enhancedUsers.length;
}

export async function hydrateCompanyProfile(): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const row = await prisma.companyProfile.findUnique({ where: { id: 'default' } });
  if (row) {
    setCompanyProfile({
      name: row.name,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      industry: row.industry ?? undefined,
      industryKey: (row as { industryKey?: string | null }).industryKey ?? undefined,
      address: row.address ?? undefined,
    });
    await hydrateActiveWorkflow((row as { industryKey?: string | null }).industryKey ?? row.industry);
  }
  // Every other company's own profile row (id = company id). 'default-company' is the default company, whose
  // profile is the 'default' row above, so a row with that id is not read as a separate profile.
  const others = await prisma.companyProfile.findMany({ where: { id: { notIn: ['default', DEFAULT_COMPANY_ID] } } });
  for (const other of others) {
    saveCompanyProfile(other.id, {
      name: other.name,
      email: other.email ?? undefined,
      phone: other.phone ?? undefined,
      industry: other.industry ?? undefined,
      industryKey: (other as { industryKey?: string | null }).industryKey ?? undefined,
      address: other.address ?? undefined,
    });
    const otherKey = (other as { industryKey?: string | null }).industryKey ?? other.industry;
    if (otherKey) setActiveWorkflow(workflowFromPack(getIndustryPack(otherKey)), other.id);
  }
}

// The default company's profile lives in the row with id 'default' (kept for existing databases); every other
// company's profile is the CompanyProfile row whose id is its company id.
const profileRowId = (companyId: string) => (companyId === DEFAULT_COMPANY_ID ? 'default' : companyId);

export async function persistCompanyProfile(profile: CompanyProfileRecord, companyId: string = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const id = profileRowId(companyId);
  await prisma.companyProfile.upsert({
    where: { id },
    update: { name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
    create: { id, name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
  });
}

export async function persistLocationCreate(location: LocationRecord, code: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.create({ data: { id: location.id, code, name: location.name, type: location.type, companyId, tenantId: DEFAULT_TENANT_ID } });
}

export async function persistLocationUpdate(location: LocationRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.update({ where: { id: location.id }, data: { name: location.name, type: location.type } });
}

export async function persistLocationDelete(locationId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.delete({ where: { id: locationId } });
}

export async function persistUserCreate(user: UserRecord, passwordHash: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash,
      role: user.role,
      assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
      companyId,
      tenantId: DEFAULT_TENANT_ID,
    },
  });
}

export async function persistUserUpdate(user: UserRecord, passwordHash?: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: user.name,
      role: user.role,
      assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });
}

export async function persistUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function persistUserDelete(userId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.delete({ where: { id: userId } });
}

export async function persistAudit(event: AuditEvent): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.auditLog.upsert({
    where: { id: event.id },
    update: { action: event.action, metadata: event.metadata as Prisma.InputJsonValue },
    create: {
      id: event.id,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Prisma.InputJsonValue,
      createdAt: new Date(event.createdAt),
    },
  });
}
