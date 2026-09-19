import { evidenceMime, saveTransferEvidence, listTransferEvidence, readTransferEvidence } from '../lib/transfer-evidence.js';
import { saveItemPhoto, listItemPhotos, readItemPhoto, deleteItemPhoto } from '../lib/item-photos.js';
import { canReceiveTransfer, validateReceiptLines, type ReceiptLineInput } from '../lib/receipt-validation.js';
import { activeCartons, isTransitDelayed } from '../lib/transfer-packing.js';
import { recordThenPersist } from '../lib/record-then-persist.js';
import { quarantineFailedLines, verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import type { QcCheckResult } from '../lib/qc-inspection.js';
import { beginReceiptRequest, endReceiptRequest, findReceiptByRequestId, persistTransferReceipt, rememberReceipt } from '../lib/transfer-receipt.js';
// Core inventory API consumed by the web app: locations, items, counts,
// transfers, picker tasks, dashboard, audit and CSV import/export.
import { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';

import { extractToken, requireAuth } from './enterprise-auth.js';
import * as enterpriseRepo from '../lib/enterprise-repository.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';
import { hashPassword } from '../lib/otp-auth.js';
import {
  DEFAULT_COMPANY_ID,
  itemsForCompany,
  registerItemCompany,
  registerLocationCompany,
} from '../lib/saas/tenant-scope.js';
import { hiddenNavigationForCompany } from '../lib/saas/entitlements.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import {
  canAccessLocation,
  sanitizeStockForRole,
  hidesZeroStockForRole,
  parseItemOperationalMeta,
  type ItemOperationalMeta,
  validateBlindCountSubmission,
  validateTransferRequest,
  validateTransferStatusChange,
  type AccessContext,
  type BlindCountInput,
  type Role,
  type TransferInput,
} from '../lib/inventory.js';
import {
  assertCountLocationAccess,
  canManageCountWork,
  parseCountPriority,
  parseCountReviewReason,
  parseCountReviewStatus,
  parseOptionalDueDate,
} from '../lib/count-lifecycle.js';
import {
  buildCycleCountPlan,
  cycleCountInstructions,
  parseAbcClasses,
  selectEligibleCycleCountItems,
} from '../lib/abc-cycle-count.js';
import {
  canCreateTransfer,
  isReceivableStatus,
  parseCartonCount,
} from '../lib/transfer-lifecycle.js';
import {
  createInventoryItem,
  createTransferRequest,
  submitStockCount,
} from '../lib/store.js';
import {
  createCountAssignment,
  deleteCountAssignment,
  createCountRecord,
  removeCountRecord,
  createItemRecord,
  createRecountAssignment,
  findAssignmentForCount,
  createTransferRecord,
  adjustStockLedger,
  adjustQuarantineLedger,
  ensureLotRecord,
  findActiveAssignment,
  findPendingCountForLot,
  findStockLedgerEntry,
  findUserById,
  getCompanyProfile,
  listCountAssignments,
  listCountAssignmentsFor,
  listCounts,
  counts as countsStore,
  updateItemRecord,
  listItems,
  listDailyMovements,
  listLocations,
  listStockLedgerForLocation,
  listSyncCheckpoints,
  listTransfers,
  listTransferCartons,
  listUsers,
  locations,
  markAssignmentSubmitted,
  setCompanyProfile,
  updateCountReview,
  updateCountAssignment,
  updateTransferStatus,
  updateTransferReceiptProgress,
  recordDailyMovement,
  upsertSyncCheckpoint,
  upsertItemRecord,
  users,
  type CountRecord,
  type LocationRecord,
  type TransferRecord,
  type UserRecord,
} from '../lib/repository.js';
import { buildDashboardSummary, buildReportSummary } from '../lib/dashboard.js';
import { emitTransferUpdated, emitWebhookEvent, maybeEmitStockLow } from '../lib/webhook-dispatcher.js';
import { buildExpiryDashboard } from '../lib/expiry.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { getCountRecommendation } from '../lib/count-tolerance.js';
import { checkApprovalGate } from '../lib/approval-rules.js';
import { estimateValueAtRisk } from '../lib/exceptions.js';
import { requireEvidenceForDamage } from '../lib/evidence-rules.js';
import { createPutawayTask } from '../lib/putaway.js';
import { assertReceiptQcComplete } from '../lib/qc-receive.js';
import { persistBinStockDelta, STAGING_BIN_ID } from '../lib/bin-stock.js';
import { lastKnownBin, sequenceKeyForBin } from '../lib/pick-wave.js';
import { reserveStockForTransfer, releaseReservedStock, InsufficientStockError, TERMINAL_TRANSFER_STATUSES } from '../lib/reservation.js';
import { buildPickerTask, completePickerTask } from '../lib/picker.js';
import { generateThermalTransferLabel, getReprintAudit, recordReprint } from '../lib/thermal-pdf.js';
import { listAuditEvents, recordAudit } from '../lib/audit.js';
import { reconcileCampaignQuietly } from '../lib/campaign-service.js';
import { applyLateMovementsQuietly } from '../lib/late-movement-service.js';
import { allocateWeightCount, totalVariance } from '../lib/weight-allocation.js';
import { publishEvent } from '../lib/event-bus.js';
import { findIdentityConflict, isOperationalItem, resolveItemByIdentity, parseItemMasterFields, parseStatusFilter, seesInactiveItems, visibleItems } from '../lib/item-master.js';
import {
  databaseEnabled,
  listStockFromDatabase,
  loadTransferPickSlips,
  persistAssignmentSubmitted,
  persistAudit,
  persistCompanyProfile,
  persistCount,
  persistCountDeletion,
  persistCountAssignment,
  persistCountAssignmentDelete,
  persistCountAssignmentUpdate,
  persistCountReview,
  persistItem,
  persistOpeningStockImport,
  persistDailyMovementImport,
  persistCountReconciliation,
  persistLocationCreate,
  persistLocationDelete,
  persistLocationUpdate,
  persistTransfer,
  persistTransferStatus,
  persistConfirmedPickAllocations,
  persistUserCreate,
  persistUserDelete,
  persistUserUpdate,
} from '../lib/persistence.js';
import { aggregateOpeningStock, importPreviewResponse, parseStockImport, readTabularFile, type StockImportPreview } from '../lib/stock-import.js';
import { allocatePick, isPickableLot, isPooledPick } from '../lib/kg-pick.js';
import { allocateLots, parseTransferImport, PICK_EXCEPTION_REASONS, validatePickInput } from '../lib/warehouse-workflow.js';
import {
  applyIndustryPack,
  getActiveWorkflow,
  getIndustryPack,
  listIndustryCatalog,
  resolveIndustryKey,
  toWorkspacePackView,
} from '../lib/industry-packs.js';
import { matchImportLocation, parseDailyStockImport, type DailyImportPreview, type DailyStockRow } from '../lib/daily-stock-sync.js';
import { listImportBatches, reverseImportBatch } from '../lib/import-reversal.js';
import { computeFileHash, InvalidBatchTransitionError } from '../lib/import-center.js';
import {
  countRowsByStatus,
  createPreviewBatch,
  findDuplicateBatch,
  getBatch,
  listRows,
  transitionBatch,
} from '../lib/import-batch-store.js';
import {
  buildBatchPreviewPayload,
  buildErrorCsv,
  duplicateConflictMessage,
  movementsFromStagedDailyRows,
  openingPreviewFromStagedRows,
  stageDailyImport,
  stageOpeningStock,
  stageStockAdjustment,
} from '../lib/import-token-flow.js';
import type { DailyMovementRecord, LotRecord } from '../lib/repository.js';
import { prisma } from '../lib/db.js';
import { enforcePermissionOverrides, PERMISSION_ACTIONS, PERMISSION_MODULES } from '../lib/access-control.js';

const router = Router();

router.use(extractToken, requireAuth, enforcePermissionOverrides);

const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];

// EnhancedUserRecord carries a wider role union than the inventory rules know
// about. An unmapped role falls back to the least privileged one rather than
// silently inheriting admin access.
function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function xmlEscape(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

// Blueprint v4 §6: an inactive or archived item stays in history but cannot
// take part in any new transaction.
function inactiveItemMessage(itemIds: string[]): string | null {
  const catalog = listItems();
  for (const id of itemIds) {
    const item = catalog.find((entry) => entry.id === id);
    if (item && !isOperationalItem(item)) {
      return `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be used in new transactions.`;
    }
  }
  return null;
}

router.get('/permissions/catalog', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can view the permission catalog.' });
  return res.json({ modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS });
});

router.get('/users/:userId/permissions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can view user permissions.' });
  if (!databaseEnabled) return res.json({ permissions: [] });
  const userId = firstParam(req.params.userId);
  const permissions = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: { select: { module: true, action: true, description: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return res.json({ permissions });
});

router.put('/users/:userId/permissions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can change user permissions.' });
  const userId = firstParam(req.params.userId);
  if (userId === req.user!.id) return res.status(400).json({ message: 'Main Admin permissions cannot be restricted.' });
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ message: 'User not found.' });
  if (target.role === 'ADMIN') return res.status(400).json({ message: 'Another Main Admin cannot be restricted here.' });
  const entries = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  if (entries.length > 200) return res.status(400).json({ message: 'Too many permission entries.' });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });
      for (const entry of entries) {
        const module = String(entry.module ?? '').toUpperCase();
        const action = String(entry.action ?? '').toUpperCase();
        if (!PERMISSION_MODULES.includes(module as any) || !PERMISSION_ACTIONS.includes(action as any)) throw new Error(`Invalid permission ${module} ${action}.`);
        const permission = await tx.permission.upsert({
          where: { module_action: { module, action: action as any } },
          create: { module, action: action as any, description: `${module} ${action}` },
          update: {},
        });
        await tx.userPermission.create({ data: {
          userId, permissionId: permission.id,
          allowed: Boolean(entry.allowed) && !Boolean(entry.denied),
          denied: Boolean(entry.denied),
          scopeId: typeof entry.scopeId === 'string' && entry.scopeId ? entry.scopeId : null,
          scopeType: entry.scopeId ? 'LOCATION' : null,
          reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 191) : null,
        } });
      }
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'USER_PERMISSIONS_REPLACED',
        entityType: 'User', entityId: userId, metadata: { entryCount: entries.length },
      } });
    });
    return res.json({ success: true, userId, permissionCount: entries.length });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save permissions.' });
  }
});

// ============================================
// USERS & LOCATIONS
// ============================================

router.get('/users', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can list users.' });
  }
  const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
  const context = accessContext(req.user!);
  const filtered = listUsers().filter((user) => {
    if (req.companyId) {
      const tenantUser = enterpriseRepo.findUserById(user.id);
      if ((tenantUser?.companyId ?? DEFAULT_COMPANY_ID) !== req.companyId) return false;
    }
    if (roleFilter && user.role !== roleFilter) return false;
    if (context.role !== 'BRANCH_MANAGER') return true;
    return user.role === 'STORE_USER'
      && user.assignedLocationIds.some((locationId) => canAccessLocation(context, locationId));
  });
  return res.json({
    users: filtered.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      assignedLocationIds: user.assignedLocationIds,
    })),
  });
});

router.get('/locations', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const visible = listLocations().filter((location) => canAccessLocation(context, location.id));

  return res.json({ locations: visible, activeLocationId: visible[0]?.id ?? null });
});

// ============================================
// ADMIN PORTAL: company profile, locations, users
// ============================================

const VALID_ROLES: readonly Role[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function requireAdmin(req: Request, res: Response): boolean {
  if (!isOperationalAdmin(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

router.get('/industries', (_req: Request, res: Response) => {
  return res.json({
    industries: listIndustryCatalog().map((pack) => ({
      key: pack.key,
      label: pack.label,
      description: pack.description,
      allocationStrategy: pack.allocationStrategy,
      expiryBlocking: pack.expiryBlocking,
      hide: pack.hide,
      dashboardKpis: pack.dashboardKpis,
    })),
  });
});

router.get('/workspace/profile', (req: Request, res: Response) => {
  const company = getCompanyProfile();
  const pack = getIndustryPack(company.industryKey ?? company.industry);
  const view = toWorkspacePackView(pack);
  const companyId = req.companyId || DEFAULT_COMPANY_ID;
  return res.json({
    name: company.name,
    industry: company.industry ?? pack.label,
    industryKey: pack.key,
    pack: {
      ...view,
      hide: [...new Set([...view.hide, ...hiddenNavigationForCompany(companyId)])],
    },
    workflow: getActiveWorkflow(),
  });
});

router.get('/runtime/config', (req: Request, res: Response) => {
  const companyId = req.companyId || DEFAULT_COMPANY_ID;
  const role = req.user?.role ?? 'ADMIN';
  return res.json({ success: true, runtime: controlPlane.runtimeConfig(companyId, role) });
});

router.get('/company', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const company = getCompanyProfile();
  const pack = getIndustryPack(company.industryKey ?? company.industry);
  return res.json({ company: { ...company, industryKey: pack.key, industry: company.industry ?? pack.label } });
});

router.put('/company', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, email, phone, industry, industryKey, address } = req.body as {
    name?: string; email?: string; phone?: string; industry?: string; industryKey?: string; address?: string;
  };
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Company name must be at least 2 characters.' });
  }
  const current = getCompanyProfile();
  const nextKey = resolveIndustryKey(industryKey ?? current.industryKey ?? industry ?? current.industry);
  const pack = getIndustryPack(nextKey);
  const profile = setCompanyProfile({
    name: name.trim(),
    email: email?.trim() || undefined,
    phone: phone?.trim() || undefined,
    industry: pack.label,
    industryKey: nextKey,
    address: address?.trim() || undefined,
  });

  try {
    await persistCompanyProfile(profile);
    const applied = await applyIndustryPack(nextKey);
    return res.json({
      company: profile,
      pack: toWorkspacePackView(pack),
      applied,
    });
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to save company profile.' });
  }
});

router.post('/locations', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, type } = req.body as { name?: string; type?: string };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Location name must be at least 2 characters.' });
  }
  if (type !== 'store' && type !== 'warehouse') {
    return res.status(400).json({ message: 'Type must be "store" or "warehouse".' });
  }

  const record: LocationRecord = {
    id: `loc-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim(),
    type,
  };
  // Prisma's Location.code is unique and has no other consumer in this app,
  // so it is derived here rather than collected from the admin.
  const code = `${type.toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  try {
    await persistLocationCreate(record, code, req.companyId ?? DEFAULT_COMPANY_ID);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save location.' });
  }

  registerLocationCompany(record.id, req.companyId ?? DEFAULT_COMPANY_ID);
  locations.push(record);
  return res.status(201).json({ location: record });
});

router.put('/locations/:locationId', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const locationId = firstParam(req.params.locationId);
  const record = locations.find((location) => location.id === locationId);
  if (!record) {
    return res.status(404).json({ message: 'Location not found.' });
  }

  const { name, type } = req.body as { name?: string; type?: string };
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ message: 'Location name must be at least 2 characters.' });
    }
    record.name = name.trim();
  }
  if (type !== undefined) {
    if (type !== 'store' && type !== 'warehouse') {
      return res.status(400).json({ message: 'Type must be "store" or "warehouse".' });
    }
    record.type = type;
  }

  try {
    await persistLocationUpdate(record);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update location.' });
  }

  return res.json({ location: record });
});

router.delete('/locations/:locationId', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can permanently delete locations.' });
  const locationId = firstParam(req.params.locationId);
  const index = locations.findIndex((location) => location.id === locationId);
  if (index === -1) {
    return res.status(404).json({ message: 'Location not found.' });
  }

  try {
    await persistLocationDelete(locationId);
  } catch (error) {
    // A foreign-key violation means stock, counts, or transfers still
    // reference this location - the message says so rather than surfacing
    // the raw Prisma error.
    return res.status(400).json({ message: 'This location has stock, counts, or transfers on record and cannot be deleted.' });
  }

  locations.splice(index, 1);
  return res.json({ success: true });
});

// A user created here must work everywhere a user can appear: logging in
// (enhancedUsers, read by enterprise-auth's requireAuth), being listed or
// picked for an assignment (repository.ts's users, read by GET /users and
// findUserById), and surviving a restart (the User table both of those
// hydrate from at startup). Writing to only one of the three is exactly how
// an admin-created Store User would fail to show up in the Assign Count
// dialog, or fail to log in, depending on which was skipped.
router.post('/users', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, email, password, role, assignedLocationIds } = req.body as {
    name?: string; email?: string; password?: string; role?: string; assignedLocationIds?: string[];
  };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters.' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'A valid email is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
  }
  if (req.user!.role === 'ADMIN_USER' && ['ADMIN', 'ADMIN_USER'].includes(role)) {
    return res.status(403).json({ message: 'Admin User can create only lower-level users.' });
  }
  const locationIds = Array.isArray(assignedLocationIds) ? assignedLocationIds.filter((id) => typeof id === 'string') : [];
  for (const id of locationIds) {
    if (!locations.some((location) => location.id === id)) {
      return res.status(400).json({ message: `Unknown location: ${id}` });
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (users.some((user) => user.email.toLowerCase() === normalizedEmail) || enterpriseRepo.findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'A user with this email already exists.' });
  }

  const id = `user-${Math.random().toString(36).slice(2, 9)}`;
  const passwordHash = hashPassword(password);
  const record: UserRecord = { id, email: normalizedEmail, name: name.trim(), role: role as Role, assignedLocationIds: locationIds };

  try {
    await persistUserCreate(record, passwordHash, req.companyId ?? DEFAULT_COMPANY_ID);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save user.' });
  }

  users.push(record);
  enterpriseRepo.createEnhancedUser({
    id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    email: normalizedEmail,
    name: record.name,
    role: role as enterpriseRepo.Role,
    branchIds: [],
    locationIds,
    passwordHash,
    status: 'active',
  });

  return res.status(201).json({ user: { id, name: record.name, email: normalizedEmail, role: record.role, assignedLocationIds: locationIds } });
});

router.put('/users/:userId', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const userId = firstParam(req.params.userId);
  const record = users.find((user) => user.id === userId);
  const enhanced = enterpriseRepo.findUserById(userId);
  if (!record || !enhanced) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const { name, role, assignedLocationIds, password } = req.body as {
    name?: string; role?: string; assignedLocationIds?: string[]; password?: string;
  };

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters.' });
    }
    record.name = name.trim();
    enhanced.name = record.name;
  }
  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as Role)) {
      return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
    }
    if (req.user!.role === 'ADMIN_USER' && ['ADMIN', 'ADMIN_USER'].includes(role)) return res.status(403).json({ message: 'Admin User cannot promote users to an admin role.' });
    if (userId === req.user!.id && role !== 'ADMIN') {
      return res.status(400).json({ message: 'You cannot change your own role away from Admin.' });
    }
    record.role = role as Role;
    enhanced.role = role as enterpriseRepo.Role;
  }
  if (assignedLocationIds !== undefined) {
    if (!Array.isArray(assignedLocationIds) || assignedLocationIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ message: 'assignedLocationIds must be an array of location ids.' });
    }
    for (const id of assignedLocationIds) {
      if (!locations.some((location) => location.id === id)) {
        return res.status(400).json({ message: `Unknown location: ${id}` });
      }
    }
    record.assignedLocationIds = assignedLocationIds;
    enhanced.locationIds = assignedLocationIds;
  }
  let passwordHash: string | undefined;
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }
    passwordHash = hashPassword(password);
    enhanced.passwordHash = passwordHash;
  }

  try {
    await persistUserUpdate(record, passwordHash);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update user.' });
  }

  return res.json({ user: { id: record.id, name: record.name, email: record.email, role: record.role, assignedLocationIds: record.assignedLocationIds } });
});

router.delete('/users/:userId', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can permanently delete users.' });
  const userId = firstParam(req.params.userId);
  if (userId === req.user!.id) {
    return res.status(400).json({ message: 'You cannot delete your own account.' });
  }

  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) {
    return res.status(404).json({ message: 'User not found.' });
  }

  try {
    await persistUserDelete(userId);
  } catch (error) {
    return res.status(400).json({ message: 'This user has records on file (counts, transfers, assignments) and cannot be deleted.' });
  }

  users.splice(index, 1);
  const enhancedIndex = enterpriseRepo.enhancedUsers.findIndex((user) => user.id === userId);
  if (enhancedIndex !== -1) {
    enterpriseRepo.enhancedUsers.splice(enhancedIndex, 1);
  }

  return res.json({ success: true });
});

router.get('/items', (req: Request, res: Response) => {
  const companyId = req.companyId ?? req.user?.companyId ?? DEFAULT_COMPANY_ID;
  let filter;
  try {
    filter = parseStatusFilter(req.query.status);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid status filter.' });
  }
  // Operational users only ever see ACTIVE items; admins can ask for
  // ARCHIVED / all to maintain the master (blueprint v4 §6).
  return res.json({ items: visibleItems(req.user!.role, itemsForCompany(companyId, listItems()), filter) });
});

router.post('/items', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can create items.' });
  }
  if (typeof req.body.code !== 'string' || !req.body.code.trim() || typeof req.body.name !== 'string' || !req.body.name.trim()) {
    return res.status(400).json({ message: 'Item Code and Item Name are required.' });
  }
  let operationalMeta: ItemOperationalMeta;
  let masterFields: ReturnType<typeof parseItemMasterFields>;
  try {
    operationalMeta = parseItemOperationalMeta(req.body);
    masterFields = parseItemMasterFields(req.body);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid item fields.' });
  }
  const claimConflict = findIdentityConflict(listItems(), '', { code: req.body.code, barcode: masterFields.barcode, aliases: masterFields.aliases });
  if (claimConflict) return res.status(409).json({ message: claimConflict });
  try {
    const item = createInventoryItem({
      code: req.body.code,
      name: req.body.name,
      category: req.body.category,
      subcategory: req.body.subcategory,
      company: req.body.company,
      unit: req.body.unit,
      ...operationalMeta,
    });
    const saved = createItemRecord({ code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit, ...operationalMeta, ...masterFields, createdById: req.user!.id });
    registerItemCompany(saved.id, req.companyId ?? DEFAULT_COMPANY_ID);
    await persistItem(saved, req.companyId ?? DEFAULT_COMPANY_ID);
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'ITEM_CREATED',
      entityType: 'Item',
      entityId: saved.id,
    }));
    return res.status(201).json({ success: true, item: saved });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create item' });
  }
});

router.put('/items/:itemId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  const item = listItems().find((candidate) => candidate.id === itemId);
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const nextCode = typeof req.body.code === 'string' ? req.body.code.trim() : item.code;
  const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : item.name;
  if (!nextCode || !nextName) return res.status(400).json({ message: 'Item Code and Item Name are required.' });
  if (listItems().some((candidate) => candidate.id !== item.id && candidate.code.trim().toLowerCase() === nextCode.toLowerCase())) {
    return res.status(409).json({ message: 'Another item already uses this Item Code.' });
  }
  let operationalMeta: ItemOperationalMeta;
  let masterFields: ReturnType<typeof parseItemMasterFields>;
  try {
    operationalMeta = parseItemOperationalMeta(req.body);
    masterFields = parseItemMasterFields(req.body);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid item fields.' });
  }
  const claimConflict = findIdentityConflict(listItems(), item.id, {
    code: nextCode !== item.code ? nextCode : undefined,
    barcode: masterFields.barcode,
    aliases: masterFields.aliases,
  });
  if (claimConflict) return res.status(409).json({ message: claimConflict });
  const patch = {
    code: nextCode,
    name: nextName,
    category: req.body.category === undefined ? item.category : String(req.body.category || '').trim() || undefined,
    subcategory: req.body.subcategory === undefined ? item.subcategory : String(req.body.subcategory || '').trim() || undefined,
    company: req.body.company === undefined ? item.company : String(req.body.company || '').trim() || undefined,
    unit: req.body.unit === undefined ? item.unit : String(req.body.unit || '').trim() || undefined,
    ...operationalMeta,
    ...masterFields,
    version: (item.version ?? 1) + 1,
    updatedById: req.user!.id,
  };
  // Write to the stored record (item is only a copy) so the change is
  // visible to every later request, not just this response.
  const updated = updateItemRecord(item.id, patch)!;
  await persistItem(updated);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'ITEM_UPDATED', entityType: 'Item', entityId: updated.id, metadata: { code: updated.code, name: updated.name } }));
  return res.json({ item: updated });
});

router.put('/items/:itemId/lots/:lotId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const item = listItems().find((candidate) => candidate.id === firstParam(req.params.itemId));
  const lot = item?.lots.find((candidate) => candidate.id === firstParam(req.params.lotId));
  if (!item || !lot) return res.status(404).json({ message: 'Item lot was not found.' });
  const lotNo = typeof req.body.lotNo === 'string' ? req.body.lotNo.trim() : lot.lotNo;
  if (!lotNo) return res.status(400).json({ message: 'Lot Code is required.' });
  if (item.lots.some((candidate) => candidate.id !== lot.id && candidate.lotNo.trim().toLowerCase() === lotNo.toLowerCase())) {
    return res.status(409).json({ message: 'This item already has the same Lot Code.' });
  }
  lot.lotNo = lotNo;
  if (req.body.expiryDate !== undefined) {
    const parsed = req.body.expiryDate ? new Date(req.body.expiryDate) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return res.status(400).json({ message: 'Expiry date is invalid.' });
    lot.expiryDate = parsed?.toISOString() ?? null;
  }
  lot.attributes = { ...(lot.attributes ?? {}), ...(req.body.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {}) };
  await persistItem(item);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'LOT_UPDATED', entityType: 'Lot', entityId: lot.id, metadata: { itemId: item.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate } }));
  return res.json({ item, lot });
});

// ============================================
// STOCK
// ============================================

router.get('/stock/:locationId', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const locationId = firstParam(req.params.locationId);

  if (!canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'Location access denied for this role.' });
  }

  const rows = databaseEnabled
    ? await listStockFromDatabase(locationId)
    : listStockLedgerForLocation(locationId).map((row) => ({
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        bookQuantity: row.onHand,
        physicalQuantity: row.onHand,
        variance: 0,
        stockValue: 0,
        quarantineQuantity: row.quarantine,
        damagedQuantity: 0,
        // Reservations are DB-only (see lib/reservation.ts) - memory mode
        // has no concurrent requests to race, so nothing is ever reserved.
        reservedQuantity: 0,
        availableQuantity: row.onHand,
      }));

  const activeItemIds = new Set(listItems().filter(isOperationalItem).map((item) => item.id));
  const visibleRows = (hidesZeroStockForRole(context.role)
    ? rows.filter((row) => row.availableQuantity > 0)
    : rows
  ).filter((row) => seesInactiveItems(context.role) || activeItemIds.has(row.itemId));

  return res.json({ locationId, items: visibleRows.map((row) => sanitizeStockForRole(context.role, row)) });
});

// ============================================
// COUNTS
// ============================================

router.get('/counts', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (context.role === 'WAREHOUSE_PICKER') return res.json({ counts: [] });
  const visible = listCounts().filter((count) =>
    canAccessLocation(context, count.locationId)
    && (context.role !== 'STORE_USER' || count.submittedBy === req.user!.id),
  );
  if (context.role === 'STORE_USER') {
    return res.json({
      counts: visible.map((count) => ({
        id: count.id,
        itemId: count.itemId,
        lotId: count.lotId,
        locationId: count.locationId,
        physicalQuantity: count.physicalQuantity,
        mode: count.mode,
        submittedBy: count.submittedBy,
        role: count.role,
        createdAt: count.createdAt,
        status: count.status,
        reviewedAt: count.reviewedAt,
        parentCountId: count.parentCountId,
      })),
    });
  }
  // Blueprint §10.2: attach a tolerance recommendation to every count still
  // awaiting review, so the reviewer sees it alongside the variance -
  // never applied automatically, just surfaced (best-effort; a
  // recommendation-engine failure never blocks the count list itself).
  const counts = await Promise.all(visible.map(async (count) => {
    const variance = count.physicalQuantity - count.bookQty;
    const toleranceRecommendation = count.status === 'PENDING_REVIEW'
      ? await getCountRecommendation({ itemId: count.itemId, locationId: count.locationId, bookQty: count.bookQty, physicalQty: count.physicalQuantity })
      : null;
    return { ...count, variance, toleranceRecommendation };
  }));
  return res.json({ counts });
});

// Blueprint v4 §14: a reviewer acknowledges a late-movement flag once they have
// looked at it (and adjusted stock if needed). The recomputed figures stay on
// the count for the audit trail.
router.post('/stock-counts/:countId/reconciliation/ack', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can resolve a reconciliation flag.' });
  const count = listCounts().find((candidate) => candidate.id === firstParam(req.params.countId));
  if (!count) return res.status(404).json({ message: 'Stock count was not found.' });
  if (!canAccessLocation(accessContext(req.user!), count.locationId)) return res.status(403).json({ message: 'This user cannot review counts at that location.' });
  if (!count.reconciliationRequired) return res.status(409).json({ message: 'This count has no open reconciliation flag.' });
  let note: string;
  try {
    note = parseCountReviewReason(req.body?.note);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'A resolution note is required.' });
  }
  const stored = countsStore.find((candidate) => candidate.id === count.id)!;
  stored.reconciliationRequired = false;
  stored.reconciliationNote = `${stored.reconciliationNote ?? ''} Resolved by ${req.user!.id}: ${note}`.trim();
  await persistCountReconciliation(stored);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_RECONCILIATION_RESOLVED', entityType: 'StockCount', entityId: count.id, metadata: { note, lateDelta: stored.lateDelta } }));
  publishEvent({ topic: 'count.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [count.locationId] });
  return res.json({ success: true, count: { ...stored, variance: stored.physicalQuantity - stored.bookQty } });
});

// Blueprint v4 §38: a client-generated idempotency key makes a retried submit
// (offline outbox, request timeout) return the count it already created.
function parseRequestId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 191) throw new Error('requestId must be text of at most 191 characters.');
  return value.trim() || undefined;
}

function countsForRequest(userId: string, requestId: string) {
  return listCounts().filter((count) => count.submittedBy === userId && count.requestId === requestId);
}

// A store user stays blind to book quantity and variance in every response.
function countResponse(role: string, count: { id: string; itemId: string; lotId: string; locationId: string; physicalQuantity: number; bookQty: number }) {
  return role === 'STORE_USER'
    ? { id: count.id, itemId: count.itemId, lotId: count.lotId, locationId: count.locationId, physicalQuantity: count.physicalQuantity }
    : { ...count, variance: count.physicalQuantity - count.bookQty };
}

type LotCountArgs = {
  userId: string;
  userRole: string;
  role: Role;
  item: ReturnType<typeof listItems>[number];
  lot: ReturnType<typeof listItems>[number]['lots'][number];
  locationId: string;
  physicalQuantity: number;
  mode: 'scan' | 'manual' | 'weight';
  requestId?: string;
  assignment?: ReturnType<typeof findActiveAssignment>;
  // 'auto' closes the assignment once every lot with stock is counted (scan
  // counts); weight counts close it themselves after allocating the item total.
  closeAssignment: 'auto' | 'never';
};

/** Records one lot's count: memory + database + audit, and the assignment/campaign bookkeeping. */
async function commitLotCount(args: LotCountArgs) {
  const { item, lot, assignment } = args;
  const bookQty = findStockLedgerEntry(item.id, lot.id, args.locationId)?.onHand ?? 0;
  const saved = submitStockCount({
    itemId: item.id,
    lotId: lot.id,
    locationId: args.locationId,
    physicalQuantity: args.physicalQuantity,
    mode: args.mode,
    submittedBy: args.userId,
    role: args.role,
  });
  // Memory first, database second, and the memory copy is withdrawn if the database refuses.
  await recordThenPersist(
    () => createCountRecord({
      id: saved.id,
      itemId: saved.itemId,
      lotId: saved.lotId,
      locationId: saved.locationId,
      physicalQuantity: saved.physicalQuantity,
      bookQty,
      mode: saved.mode,
      submittedBy: saved.submittedBy,
      role: saved.role,
      createdAt: saved.createdAt,
      parentCountId: assignment?.parentCountId,
      requestId: args.requestId,
    }),
    () => persistCount({ ...saved, bookQty, status: 'PENDING_REVIEW', parentCountId: assignment?.parentCountId, requestId: args.requestId }),
    (record) => removeCountRecord(record.id),
  );
  const followUps: Promise<unknown>[] = [
    persistAudit(recordAudit({ actorId: args.userId, actorRole: args.userRole, action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: saved.id })),
  ];
  if (assignment && args.closeAssignment === 'auto') {
    const requiredLotIds = item.lots
      .filter((candidate) => (findStockLedgerEntry(item.id, candidate.id, args.locationId)?.onHand ?? 0) !== 0)
      .map((candidate) => candidate.id);
    const countedLotIds = new Set(
      listCounts()
        .filter((count) => count.itemId === item.id && count.locationId === args.locationId && count.submittedBy === args.userId && count.createdAt >= assignment.createdAt)
        .map((count) => count.lotId),
    );
    countedLotIds.add(saved.lotId);
    if (requiredLotIds.length === 0 || requiredLotIds.every((lotId) => countedLotIds.has(lotId))) {
      markAssignmentSubmitted(assignment.id, saved.id);
      followUps.push(persistAssignmentSubmitted(assignment.id, saved.id));
      // A campaign task just moved to SUBMITTED: keep coverage in step.
      followUps.push(reconcileCampaignQuietly(assignment.campaignId));
    }
  }
  await Promise.all(followUps);
  return { saved, bookQty };
}

router.post('/stock-counts', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as BlindCountInput;

  if (!canAccessLocation(context, input.locationId)) {
    return res.status(403).json({ message: 'This user cannot submit a count for the selected location.' });
  }

  try {
    const validated = validateBlindCountSubmission(context.role, input);
    const requestId = parseRequestId(input.requestId);
    if (requestId) {
      const [prior] = countsForRequest(req.user!.id, requestId);
      if (prior) return res.status(200).json({ success: true, duplicate: true, count: countResponse(context.role, prior) });
    }

    const item = listItems().find((candidate) => candidate.id === validated.itemId);
    if (!item) return res.status(400).json({ message: 'Item was not found.' });
    if (!isOperationalItem(item)) return res.status(400).json({ message: `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be counted.` });

    const lot = validated.lotNo
      ? item.lots.find((candidate) => candidate.lotNo.toLowerCase() === validated.lotNo!.toLowerCase())
      : item.lots[0];
    if (!lot) return res.status(400).json({ message: `Lot "${validated.lotNo}" was not found for this item.` });

    // Blueprint v4 §13: pieces are whole numbers; only weight / decimal items take fractions.
    if (!item.decimalQuantity && item.countMethod !== 'ITEM_WEIGHT' && !Number.isInteger(validated.physicalQuantity)) {
      return res.status(400).json({ message: `Item ${item.code} is counted in whole units.` });
    }

    // Blueprint v4 §7: operational users never act on a zero-stock lot.
    if (hidesZeroStockForRole(context.role) && (findStockLedgerEntry(item.id, lot.id, validated.locationId)?.onHand ?? 0) <= 0) {
      return res.status(400).json({ message: `Lot ${lot.lotNo} has no stock at this location and cannot be counted.` });
    }

    if (findPendingCountForLot(req.user!.id, item.id, lot.id, validated.locationId)) {
      return res.status(409).json({ message: 'This lot is already submitted and waiting for review.' });
    }

    // Store Users may only count what Admin assigned them; Admin can record ad hoc counts freely.
    let assignment;
    if (context.role === 'STORE_USER') {
      assignment = findActiveAssignment(req.user!.id, item.id, validated.locationId);
      if (!assignment) {
        return res.status(403).json({ message: 'This item is not assigned to you for counting at this location.' });
      }
    }

    const { saved, bookQty } = await commitLotCount({
      userId: req.user!.id, userRole: req.user!.role, role: context.role, item, lot, locationId: validated.locationId,
      physicalQuantity: validated.physicalQuantity, mode: validated.mode ?? 'manual', requestId, assignment, closeAssignment: 'auto',
    });
    return res.status(201).json({ success: true, count: countResponse(context.role, { ...saved, bookQty }) });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid stock count payload' });
  }
});

// Blueprint v4 §13.2: loose KG / item-weight counting. The user enters one
// decimal total for the item; the server spreads it over the item's lots in
// FIFO/FEFO order (lib/weight-allocation.ts) and creates a count per lot. The
// user never picks or splits lots, and a store user is never shown the split
// (it would reveal the book quantities the count is blind to).
const weightInFlight = new Set<string>();

router.post('/stock-counts/weight', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as { itemId?: string; locationId?: string; totalQuantity?: number; requestId?: string };
  if (!input?.itemId || !input?.locationId) return res.status(400).json({ message: 'Item and location are required for a count submission.' });
  const locationId = input.locationId;
  if (!canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'This user cannot submit a count for the selected location.' });
  }
  try {
    const total = Number(input.totalQuantity);
    if (input.totalQuantity === undefined || input.totalQuantity === null || (input.totalQuantity as unknown) === '' || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({ message: 'Counted quantity must be a non-negative number.' });
    }
    const requestId = parseRequestId(input.requestId);
    if (requestId) {
      const prior = countsForRequest(req.user!.id, requestId);
      if (prior.length) {
        return res.status(200).json({
          success: true, duplicate: true,
          ...(context.role === 'STORE_USER' ? { lots: prior.length } : { counts: prior.map((count) => countResponse(context.role, count)) }),
        });
      }
    }

    const item = listItems().find((candidate) => candidate.id === input.itemId);
    if (!item) return res.status(400).json({ message: 'Item was not found.' });
    if (!isOperationalItem(item)) return res.status(400).json({ message: `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be counted.` });
    if (item.countMethod !== 'ITEM_WEIGHT') {
      return res.status(400).json({ message: `Item ${item.code} is counted by scanning lots, not by weight.` });
    }

    let assignment;
    if (context.role === 'STORE_USER') {
      assignment = findActiveAssignment(req.user!.id, item.id, locationId);
      if (!assignment) return res.status(403).json({ message: 'This item is not assigned to you for counting at this location.' });
    }

    const lots = item.lots.map((lot) => ({
      lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate, status: lot.status,
      bookQty: findStockLedgerEntry(item.id, lot.id, locationId)?.onHand ?? 0,
    }));
    const allocation = allocateWeightCount(total, lots, item.allocationStrategy ?? 'FEFO');
    if (allocation.some((row) => findPendingCountForLot(req.user!.id, item.id, row.lotId, locationId))) {
      return res.status(409).json({ message: 'This item is already submitted and waiting for review.' });
    }

    // A weight count is all-or-nothing: if one lot cannot be saved the others are withdrawn,
    // so a retry never finds half a count and calls it done.
    const flightKey = requestId ? `${req.user!.id}|${requestId}` : '';
    if (flightKey && weightInFlight.has(flightKey)) return res.status(409).json({ message: 'This count is already being saved. Retry in a moment.' });
    if (flightKey) weightInFlight.add(flightKey);
    const saved: Array<Awaited<ReturnType<typeof commitLotCount>>> = [];
    try {
      for (const row of allocation) {
        const lot = item.lots.find((candidate) => candidate.id === row.lotId)!;
        saved.push(await commitLotCount({
          userId: req.user!.id, userRole: req.user!.role, role: context.role, item, lot, locationId,
          physicalQuantity: row.physicalQty, mode: 'weight', requestId, assignment, closeAssignment: 'never',
        }));
      }
    } catch (error) {
      for (const row of saved) {
        removeCountRecord(row.saved.id);
        await persistCountDeletion(row.saved.id).catch(() => undefined);
      }
      throw error;
    } finally {
      if (flightKey) weightInFlight.delete(flightKey);
    }
    // The whole item was counted in one entry, so the task is complete now.
    if (assignment) {
      markAssignmentSubmitted(assignment.id, saved[0].saved.id);
      await Promise.all([persistAssignmentSubmitted(assignment.id, saved[0].saved.id), reconcileCampaignQuietly(assignment.campaignId)]);
    }

    if (context.role === 'STORE_USER') return res.status(201).json({ success: true, lots: saved.length });
    return res.status(201).json({
      success: true,
      counts: saved.map((row) => countResponse(context.role, { ...row.saved, bookQty: row.bookQty })),
      allocation: allocation.map((row) => ({ lotId: row.lotId, lotNo: row.lotNo, bookQty: row.bookQty, physicalQuantity: row.physicalQty })),
      totalVariance: totalVariance(allocation),
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid weight count payload' });
  }
});

router.patch('/stock-counts/:countId/review', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can review stock counts.' });
  }

  let status;
  let reviewReason;
  try {
    status = parseCountReviewStatus(req.body.status);
    reviewReason = parseCountReviewReason(req.body.reviewReason ?? req.body.reason);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid review payload.' });
  }

  try {
    const countId = firstParam(req.params.countId);
    const current = listCounts().find((count) => count.id === countId);
    if (!current) return res.status(404).json({ message: 'Stock count was not found.' });
    if (current.status !== 'PENDING_REVIEW') return res.status(409).json({ message: `Count is already ${current.status} and cannot be reviewed again.` });
    try {
      assertCountLocationAccess(accessContext(req.user!), current.locationId);
    } catch {
      return res.status(403).json({ message: 'This user cannot review counts at the selected location.' });
    }
    const reviewedAt = new Date().toISOString();
    // Claim and post the variance in MySQL before mutating the in-memory mirror.
    // The conditional database update makes concurrent/retried approvals exactly-once.
    await persistCountReview({ ...current, status, reviewedBy: req.user!.id, reviewedAt, reviewReason });
    const updated = updateCountReview(countId, status, req.user!.id, reviewReason);
    const variance = updated.physicalQuantity - updated.bookQty;
    const reviewedCampaignId = findAssignmentForCount(countId)?.campaignId;
    let recountAssignment;
    if (status === 'RECOUNT') {
      const recount = createRecountAssignment(updated, req.user!.id);
      recountAssignment = recount.assignment;
      if (recount.cancelled) await persistCountAssignmentUpdate(recount.cancelled);
      await persistCountAssignment(recountAssignment);
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `STOCK_COUNT_${status}`,
      entityType: 'StockCount',
      entityId: updated.id,
      metadata: {
        reviewReason,
        ...(status === 'APPROVED' ? { bookQty: updated.bookQty, physicalQuantity: updated.physicalQuantity, variance, movementId: updated.varianceMovementId } : {}),
        ...(status === 'RECOUNT' ? { recountAssignmentId: recountAssignment?.id } : {}),
      },
    }));
    void emitWebhookEvent({
      type: 'count.reviewed',
      entityId: updated.id,
      data: {
        countId: updated.id,
        status,
        itemId: updated.itemId,
        locationId: updated.locationId,
        physicalQuantity: updated.physicalQuantity,
        reviewReason,
      },
    });
    if (status === 'APPROVED') maybeEmitStockLow(updated.itemId, updated.locationId, updated.bookQty);
    await reconcileCampaignQuietly(reviewedCampaignId);
    return res.json({ success: true, count: { ...updated, variance }, recountAssignment });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stock count was not found.';
    return res.status(message.includes('not found') ? 404 : 400).json({ message });
  }
});

// ============================================
// COUNT ASSIGNMENTS
// ============================================

router.post('/count-assignments', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can assign stock counts.' });
  }

  const { locationId, storeUserId, itemIds, countDate, dueDate, priority, instructions } = req.body as {
    locationId?: string;
    storeUserId?: string;
    itemIds?: string[];
    countDate?: string;
    dueDate?: string;
    priority?: string;
    instructions?: string;
  };

  if (!locationId || !storeUserId || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ message: 'locationId, storeUserId and a non-empty itemIds array are required.' });
  }

  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign counts at the selected location.' });
  }

  const storeUser = findUserById(storeUserId);
  if (!storeUser || storeUser.role !== 'STORE_USER') {
    return res.status(400).json({ message: 'storeUserId must belong to an existing Store User.' });
  }
  if (!canAccessLocation({ role: storeUser.role, assignedLocationIds: storeUser.assignedLocationIds }, locationId)) {
    return res.status(400).json({ message: 'That Store User is not assigned to this location.' });
  }

  const knownItemIds = new Set(listItems().map((item) => item.id));
  const unknownItemId = itemIds.find((id) => !knownItemIds.has(id));
  if (unknownItemId) {
    return res.status(400).json({ message: `Item "${unknownItemId}" was not found.` });
  }
  const inactiveAssignItem = inactiveItemMessage(itemIds);
  if (inactiveAssignItem) return res.status(400).json({ message: inactiveAssignItem });

  let parsedDueDate: string | undefined;
  let parsedPriority;
  try {
    parsedDueDate = parseOptionalDueDate(dueDate);
    parsedPriority = parseCountPriority(priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }

  const createdAssignments = itemIds.map((itemId) => createCountAssignment({
    id: `assign-${Math.random().toString(36).slice(2, 10)}`,
    locationId,
    itemId,
    assignedToId: storeUserId,
    assignedById: req.user!.id,
    countDate: countDate ? new Date(countDate).toISOString() : new Date().toISOString(),
    dueDate: parsedDueDate,
    priority: parsedPriority,
    instructions,
  }));

  await Promise.all(createdAssignments.map((assignment) => persistCountAssignment(assignment)));
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COUNT_ASSIGNED',
    entityType: 'CountAssignment',
    entityId: createdAssignments[0].id,
    metadata: { locationId, storeUserId, itemIds, countDate: createdAssignments[0].countDate },
  }));

  return res.status(201).json({ success: true, assignments: createdAssignments });
});


router.patch('/count-assignments/:assignmentId', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'ADMIN_USER';
  const assignmentId = firstParam(req.params.assignmentId);
  const current = listCountAssignments().find((candidate) => candidate.id === assignmentId);
  if (!current) return res.status(404).json({ message: 'Count assignment was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), current.locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot update assignments at the selected location.' });
  }
  if (current.status === 'SUBMITTED' && !isAdmin) return res.status(409).json({ message: 'Submitted work is immutable for branch managers; an admin can modify the task metadata.' });
  const assignedToId = typeof req.body.assignedToId === 'string' ? req.body.assignedToId : current.assignedToId;
  const assignee = findUserById(assignedToId);
  if (!assignee || assignee.role !== 'STORE_USER' || !assignee.assignedLocationIds.includes(current.locationId)) {
    return res.status(400).json({ message: 'Assignee must be a Store User assigned to this location.' });
  }
  const countDate = req.body.countDate ? new Date(req.body.countDate) : new Date(current.countDate);
  if (Number.isNaN(countDate.getTime())) return res.status(400).json({ message: 'Count date is invalid.' });
  let dueDate = current.dueDate;
  let priority = current.priority;
  try {
    if (req.body.dueDate !== undefined) dueDate = parseOptionalDueDate(req.body.dueDate);
    if (req.body.priority !== undefined) priority = parseCountPriority(req.body.priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }
  const status = req.body.status === undefined ? current.status : String(req.body.status).toUpperCase();
  if (!['ASSIGNED', 'CANCELLED', 'SUBMITTED'].includes(status)) return res.status(400).json({ message: 'Assignments can be ASSIGNED, SUBMITTED or CANCELLED.' });
  if (current.status === 'SUBMITTED' && status !== 'SUBMITTED') return res.status(409).json({ message: 'An approved/submitted task cannot be reopened; create a recount instead.' });
  const updated = updateCountAssignment(assignmentId, {
    assignedToId,
    countDate: countDate.toISOString(),
    dueDate,
    priority,
    instructions: req.body.instructions === undefined ? current.instructions : String(req.body.instructions || '').trim() || undefined,
    status: status as 'ASSIGNED' | 'CANCELLED',
  });
  await persistCountAssignmentUpdate(updated);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_ASSIGNMENT_UPDATED', entityType: 'CountAssignment', entityId: updated.id, metadata: { assignedToId: updated.assignedToId, countDate: updated.countDate, status: updated.status } }));
  return res.json({ assignment: updated });
});

router.delete('/count-assignments/:assignmentId', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Only admins can delete count tasks.' });
  const assignmentId = firstParam(req.params.assignmentId);
  const current = listCountAssignments().find((candidate) => candidate.id === assignmentId);
  if (!current) return res.status(404).json({ message: 'Count assignment was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), current.locationId);
  } catch {
    return res.status(403).json({ message: 'This admin cannot delete a task at the selected location.' });
  }
  const removed = deleteCountAssignment(assignmentId);
  try {
    await persistCountAssignmentDelete(assignmentId);
  } catch (error) {
    createCountAssignment(removed);
    throw error;
  }
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_ASSIGNMENT_DELETED', entityType: 'CountAssignment', entityId: assignmentId, metadata: { status: current.status, countId: current.countId } }));
  publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [current.locationId] });
  return res.json({ success: true, assignmentId, preservedCountId: current.countId ?? null });
});
router.get('/count-assignments/mine', (req: Request, res: Response) => {
  if (req.user!.role !== 'STORE_USER') {
    return res.status(403).json({ message: 'Only store users have a count task list.' });
  }
  const assignments = listCountAssignmentsFor(req.user!.id).map((assignment) => {
    const item = listItems().find((candidate) => candidate.id === assignment.itemId);
    return { ...assignment, itemName: item?.name ?? assignment.itemId, itemCode: item?.code };
  });
  return res.json({ assignments });
});

// Blueprint v4 §37: the mobile app is task-first. This is the one call a
// phone needs to render its Work tab: the user's open count tasks (only
// items that still have counted-in stock at the location, with only the lots
// worth counting and no quantities, so the blind count stays blind) and the
// transfers waiting to be received at their branch. No full catalog.
router.get('/mobile/work', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const isStore = context.role === 'STORE_USER';
  const countTasks = isStore
    ? listCountAssignmentsFor(req.user!.id).flatMap((assignment) => {
        const item = listItems().find((candidate) => candidate.id === assignment.itemId);
        if (!item || !isOperationalItem(item) || !canAccessLocation(context, assignment.locationId)) return [];
        const lots = item.lots
          .filter((lot) => (lot.status ?? 'AVAILABLE') === 'AVAILABLE' && (findStockLedgerEntry(item.id, lot.id, assignment.locationId)?.onHand ?? 0) > 0)
          .map((lot) => ({ lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate ?? null }));
        // Nothing on the shelf to count: not an actionable task for a store user.
        if (!lots.length) return [];
        return [{
          assignmentId: assignment.id,
          locationId: assignment.locationId,
          countDate: assignment.countDate,
          dueDate: assignment.dueDate,
          priority: assignment.priority ?? 'NORMAL',
          instructions: assignment.instructions,
          campaignId: assignment.campaignId,
          recount: Boolean(assignment.parentCountId),
          item: {
            id: item.id, code: item.code, name: item.name, barcode: item.barcode, unit: item.unit,
            countMethod: item.countMethod ?? 'LOT_SCAN', decimalQuantity: Boolean(item.decimalQuantity) || item.countMethod === 'ITEM_WEIGHT',
          },
          lots,
        }];
      })
    : [];
  const receiveTasks = ['STORE_USER', 'BRANCH_MANAGER', 'ADMIN', 'ADMIN_USER'].includes(context.role)
    ? listTransfers()
        .filter((transfer) => ['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'PARTIAL_RECEIVED'].includes(transfer.status) && canAccessLocation(context, transfer.destinationLocationId))
        .map((transfer) => ({
          transferId: transfer.id,
          sourceLocationId: transfer.sourceLocationId,
          destinationLocationId: transfer.destinationLocationId,
          status: transfer.status,
          lineCount: transfer.lines.length,
          cartonCount: transfer.cartonCount,
          createdAt: transfer.createdAt,
        }))
    : [];
  return res.json({ countTasks, receiveTasks });
});

router.get('/count-assignments', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can view count assignments.' });
  }
  const context = accessContext(req.user!);
  const assignments = listCountAssignments()
    .filter((assignment) => assignment.status === 'ASSIGNED')
    .filter((assignment) => context.role !== 'BRANCH_MANAGER' || canAccessLocation(context, assignment.locationId));
  return res.json({ assignments });
});

function cycleCountPlanForLocation(locationId: string, now = new Date()) {
  return buildCycleCountPlan({
    locationId,
    items: listItems(),
    stock: listStockLedgerForLocation(locationId),
    assignments: listCountAssignments(),
    now,
  });
}

router.get('/cycle-counts/:locationId', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can view the cycle-count planner.' });
  }
  const locationId = firstParam(req.params.locationId);
  const location = listLocations().find((candidate) => candidate.id === locationId);
  if (!location) return res.status(404).json({ message: 'Location was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot manage counts at the selected location.' });
  }
  return res.json({ plan: cycleCountPlanForLocation(locationId) });
});

router.post('/cycle-counts/:locationId/assign', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can assign cycle counts.' });
  }
  const locationId = firstParam(req.params.locationId);
  const location = listLocations().find((candidate) => candidate.id === locationId);
  if (!location) return res.status(404).json({ message: 'Location was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign counts at the selected location.' });
  }

  const { storeUserId, classes, itemIds } = req.body as {
    storeUserId?: string;
    classes?: unknown;
    itemIds?: unknown;
  };
  if (!storeUserId) {
    return res.status(400).json({ message: 'storeUserId is required.' });
  }

  const storeUser = findUserById(storeUserId);
  if (!storeUser || storeUser.role !== 'STORE_USER') {
    return res.status(400).json({ message: 'storeUserId must belong to an existing Store User.' });
  }
  if (!canAccessLocation({ role: storeUser.role, assignedLocationIds: storeUser.assignedLocationIds }, locationId)) {
    return res.status(400).json({ message: 'That Store User is not assigned to this location.' });
  }

  let parsedClasses;
  try {
    parsedClasses = parseAbcClasses(classes);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid ABC classes.' });
  }

  const requestedItemIds = Array.isArray(itemIds)
    ? [...new Set(itemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : [];

  const plan = cycleCountPlanForLocation(locationId);
  if (requestedItemIds.length) {
    const known = new Set(plan.items.map((item) => item.itemId));
    const unknownItemId = requestedItemIds.find((id) => !known.has(id));
    if (unknownItemId) {
      return res.status(400).json({ message: `Item "${unknownItemId}" is not on the cycle-count plan for this location.` });
    }
  }

  const selected = selectEligibleCycleCountItems(plan.items, {
    classes: parsedClasses,
    itemIds: requestedItemIds,
  });
  if (selected.length === 0) {
    return res.status(400).json({ message: 'No eligible items remain for the selected ABC classes.' });
  }

  const createdAssignments = selected.map((item) => createCountAssignment({
    id: `assign-${Math.random().toString(36).slice(2, 10)}`,
    locationId,
    itemId: item.itemId,
    assignedToId: storeUserId,
    assignedById: req.user!.id,
    countDate: new Date().toISOString(),
    dueDate: item.dueDate,
    priority: item.priority,
    instructions: cycleCountInstructions(item.abcClass),
  }));

  await Promise.all(createdAssignments.map((assignment) => persistCountAssignment(assignment)));
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'CYCLE_COUNT_ASSIGNED',
    entityType: 'CountAssignment',
    entityId: createdAssignments[0].id,
    metadata: {
      locationId,
      storeUserId,
      classes: parsedClasses,
      itemIds: selected.map((item) => item.itemId),
    },
  }));

  return res.status(201).json({
    success: true,
    assignments: createdAssignments,
    plan: cycleCountPlanForLocation(locationId),
  });
});

// ============================================
// TRANSFERS
// ============================================

router.get('/transfers/list', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transfers = listTransfers().filter((transfer) =>
    canAccessLocation(context, transfer.sourceLocationId)
    || canAccessLocation(context, transfer.destinationLocationId),
  ).map((transfer) => ({
    ...transfer,
    // Carton labels and the transit flag (blueprint §17/§18) so a receiver can find a transfer by carton.
    cartons: activeCartons(listTransferCartons(transfer.id)).map((carton) => ({ packageId: carton.packageId, quantity: carton.quantity, weightKg: carton.weightKg })),
    delayed: isTransitDelayed({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
  }));
  return res.json({ transfers });
});

router.post('/transfers', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as TransferInput;

  try {
    if (!canCreateTransfer(context.role)) {
      return res.status(403).json({ message: 'This role cannot create transfer requests.' });
    }
    if (context.role === 'BRANCH_MANAGER' && !canAccessLocation(context, input.sourceLocationId)) {
      return res.status(403).json({ message: 'Branch managers can only create transfers from assigned locations.' });
    }
    if (context.role === 'STORE_USER') {
      if (!canAccessLocation(context, input.sourceLocationId)) {
        return res.status(403).json({ message: 'Store user can only request from an assigned location.' });
      }
      const destination = listLocations().find((location) => location.id === input.destinationLocationId);
      if (destination?.type !== 'warehouse') {
        return res.status(400).json({ message: 'Store transfer destination must be a warehouse.' });
      }
    }

    const cartonCount = parseCartonCount(input.cartonCount);
    const validated = validateTransferRequest(context.role, { ...input, cartonCount });
    const inactiveTransferItem = inactiveItemMessage(validated.lines.map((line) => line.itemId));
    if (inactiveTransferItem) return res.status(400).json({ message: inactiveTransferItem });
    const workflow = getActiveWorkflow();
    if (workflow.expiryBlocking) {
      const expired = validated.lines.filter((line) => {
        const item = listItems().find((entry) => entry.id === line.itemId);
        const lot = item?.lots.find((entry) => entry.id === line.lotId);
        if (!lot) return false;
        if (lot.status && lot.status !== 'AVAILABLE') return true;
        return Boolean(lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now());
      });
      if (expired.length) {
        return res.status(409).json({ message: 'Expired or quarantined lots cannot be transferred while expiry blocking is on.' });
      }
    }

    // Blueprint §7.2/§9: reserve before creating the request so a second
    // concurrent request against the same low-stock lot is rejected here
    // rather than discovering the shortfall later, one pick at a time.
    try {
      await reserveStockForTransfer(validated.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity,
      })));
    } catch (error) {
      if (error instanceof InsufficientStockError) return res.status(409).json({ message: error.message });
      throw error;
    }

    try {
      const saved = createTransferRequest({
        sourceLocationId: validated.sourceLocationId,
        destinationLocationId: validated.destinationLocationId,
        requestedBy: req.user!.id,
        role: context.role === 'WAREHOUSE_PICKER' || context.role === 'AUDITOR' ? 'ADMIN' : context.role,
        lines: validated.lines,
        cartonCount,
        photos: input.photos,
        notes: input.notes,
      });

      createTransferRecord({
        id: saved.id,
        sourceLocationId: saved.sourceLocationId,
        destinationLocationId: saved.destinationLocationId,
        requestedBy: saved.requestedBy,
        role: saved.role,
        status: saved.status,
        lines: saved.lines,
        cartonCount: saved.cartonCount,
        photos: saved.photos,
        notes: saved.notes,
        createdAt: saved.createdAt,
      });
      await persistTransfer(saved);
      await persistAudit(recordAudit({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'TRANSFER_REQUESTED',
        entityType: 'Transfer',
        entityId: saved.id,
      }));

      return res.status(201).json({ success: true, transfer: saved });
    } catch (error) {
      // The reservation above already committed; do not leave it stranded
      // against a transfer that was never actually created.
      void releaseReservedStock(validated.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity,
      })));
      throw error;
    }
  } catch (error) {
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Invalid transfer payload' });
  }
});

router.post('/replenishment-actions/transfer', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const sourceLocationId = String(req.body.sourceLocationId ?? '');
  const destinationLocationId = String(req.body.destinationLocationId ?? '');
  const itemId = String(req.body.itemId ?? '');
  const quantity = Number(req.body.quantity);
  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId || requestId.length > 191) return res.status(400).json({ message: 'A valid requestId is required.' });
  if (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId) return res.status(400).json({ message: 'Distinct source and destination locations are required.' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: 'Quantity must be positive.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, sourceLocationId) || !canAccessLocation(context, destinationLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const transferId = `replenishment-${createHash('sha1').update(requestId).digest('hex').slice(0, 24)}`;
  const existing = listTransfers().find((entry) => entry.id === transferId);
  if (existing) return res.json({ success: true, duplicate: true, transfer: existing });

  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const sourceStock = listStockLedgerForLocation(sourceLocationId);
  const lots = item.lots.map((lot) => ({
    lotId: lot.id,
    lotNo: lot.lotNo,
    expiryDate: lot.expiryDate,
    available: sourceStock.find((row) => row.itemId === itemId && row.lotId === lot.id)?.onHand ?? 0,
    status: (lot as any).status ?? 'AVAILABLE',
  }));
  const allocation = allocateLots(lots, quantity, getActiveWorkflow().allocationStrategy);
  if (allocation.shortage > 1e-8) return res.status(409).json({ message: `Source stock changed; ${allocation.shortage} units are no longer available.` });

  const transfer: TransferRecord = {
    id: transferId,
    sourceLocationId,
    destinationLocationId,
    requestedBy: req.user!.id,
    role: req.user!.role as Role,
    status: 'REQUESTED',
    lines: allocation.allocations.map((line) => ({ itemId, lotId: line.lotId, quantity: line.quantity })),
    notes: `Created from replenishment recommendation. Request: ${requestId}`,
    createdAt: new Date().toISOString(),
  };
  try {
    await reserveStockForTransfer(transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, locationId: sourceLocationId, quantity: line.quantity })));
    // Commit first so a database failure cannot leave a phantom transfer in
    // the process mirror. The deterministic ID makes request retries safe.
    await persistTransfer(transfer);
    createTransferRecord(transfer);
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role,
      action: 'REPLENISHMENT_TRANSFER_CREATED', entityType: 'Transfer', entityId: transfer.id,
      metadata: { requestId, sourceLocationId, destinationLocationId, itemId, quantity, strategy: 'FEFO' },
    }));
    return res.status(201).json({ success: true, duplicate: false, transfer });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create replenishment transfer.' });
  }
});

router.patch('/transfers/:transferId/status', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  const nextStatus = req.body.status as TransferRecord['status'];

  if (!transfer) {
    return res.status(404).json({ message: 'Transfer was not found.' });
  }

  const validStatuses = ['SUBMITTED', 'DRAFT', 'PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL', 'PICKED', 'READY_FOR_ADMIN', 'CONFIRMED', 'IN_TRANSIT', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED'];
  if (!validStatuses.includes(nextStatus)) {
    return res.status(400).json({ message: 'Invalid transfer status.' });
  }

  if (!canAccessLocation(context, transfer.sourceLocationId)
    && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }

  // Packing that was started must be finished (every line in a sealed carton) before the goods leave.
  if (nextStatus === 'DISPATCHED' && !transfer.packing && activeCartons(listTransferCartons(transfer.id)).length > 0) {
    return res.status(409).json({ message: 'Packing was started for this transfer. Complete it before dispatching.' });
  }

  try {
    validateTransferStatusChange(context.role, transfer.status, nextStatus);
    const wasTerminal = (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(transfer.status);
    const updated = updateTransferStatus(transfer.id, nextStatus);
    await persistTransferStatus(updated);
    // Release the request-time reservation the first time this transfer
    // reaches a terminal state (CONFIRMED is released separately at the
    // dedicated /confirm endpoint, alongside the actual stock decrement).
    if (!wasTerminal && (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(nextStatus) && nextStatus !== 'CONFIRMED') {
      void releaseReservedStock(transfer.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity,
      })));
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `TRANSFER_${nextStatus}`,
      entityType: 'Transfer',
      entityId: updated.id,
    }));
    void emitTransferUpdated(updated);
    return res.json({ success: true, transfer: updated });
  } catch (error) {
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Transfer status change denied.' });
  }
});

// ============================================
// PICKER TASKS
// ============================================

router.get('/picker-tasks', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Picker task access denied.' });
  }
  const tasks = listTransfers()
    .filter((transfer) => ['REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'].includes(transfer.status) && canAccessLocation(context, transfer.sourceLocationId))
    .map((transfer) => ({
      transferId: transfer.id,
      locationId: transfer.sourceLocationId,
      lines: transfer.lines,
      status: 'ASSIGNED',
    }));
  return res.json({ tasks });
});

// ============================================
// PICK WAVES (blueprint Module C / section 9.2)
// ============================================

const PICKABLE_TRANSFER_STATUSES = ['REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];

router.get('/pick-waves', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Pick wave access denied.' });
  }
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (locationId && !canAccessLocation(context, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const scope = context.role === 'ADMIN' || context.role === 'ADMIN_USER'
    ? (locationId ? { locationId } : {})
    : { locationId: { in: context.assignedLocationIds } };
  const waves = await prisma.pickWave.findMany({
    where: { ...scope, ...(status ? { status } : { status: { in: ['OPEN', 'IN_PROGRESS'] } }) },
    include: { location: { select: { id: true, code: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  }).catch(() => []);
  return res.json({ waves });
});

router.post('/pick-waves', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  const transferIds: string[] = Array.isArray(req.body.transferIds) ? req.body.transferIds.filter((id: unknown) => typeof id === 'string') : [];
  if (!locationId || transferIds.length < 2) {
    return res.status(400).json({ message: 'A location and at least two transfers are required to form a pick wave.' });
  }
  const transfers = listTransfers().filter((transfer) => transferIds.includes(transfer.id));
  if (transfers.length !== transferIds.length) return res.status(404).json({ message: 'One or more transfers were not found.' });
  const invalid = transfers.find((transfer) => transfer.sourceLocationId !== locationId || !PICKABLE_TRANSFER_STATUSES.includes(transfer.status));
  if (invalid) {
    return res.status(409).json({ message: `Transfer ${invalid.id} is not pickable from this location right now (status ${invalid.status}).` });
  }
  try {
    const wave = await prisma.pickWave.create({
      data: { locationId, transferIds, createdById: req.user!.id },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'PICK_WAVE_CREATED',
      entityType: 'PickWave', entityId: wave.id, metadata: { locationId, transferIds },
    }));
    return res.status(201).json({ wave });
  } catch {
    return res.status(503).json({ message: 'Pick waves are not available on this database yet.' });
  }
});

router.get('/pick-waves/:id', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Pick wave access denied.' });
  }
  const wave = await prisma.pickWave.findUnique({
    where: { id: firstParam(req.params.id) },
    include: { location: { select: { id: true, code: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
  }).catch(() => null);
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  if (!canAccessLocation(context, wave.locationId)) return res.status(403).json({ message: 'Location access denied.' });

  const transferIds = Array.isArray(wave.transferIds) ? (wave.transferIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  const transfers = listTransfers().filter((transfer) => transferIds.includes(transfer.id));
  const itemsById = new Map(listItems().map((item) => [item.id, item]));

  // Combine every member transfer's remaining pick quantity by item+lot,
  // keeping a per-destination breakdown so pack/dispatch still segregates
  // by transfer (blueprint: "combine... while keeping destination
  // segregation").
  type Combined = {
    itemId: string; itemCode?: string; itemName?: string; unit?: string;
    lotId: string; lotNo?: string; expiryDate?: string | null;
    totalRemainingQty: number;
    destinations: Array<{ transferId: string; destinationLocationId: string; remainingQty: number }>;
  };
  const combined = new Map<string, Combined>();
  for (const transfer of transfers) {
    const slips = await savedPickSlips(transfer.id);
    const picked = new Map<string, number>();
    for (const slip of slips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
      const key = `${line.itemId}|${line.lotId}`;
      picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
    for (const line of transfer.lines) {
      const remainingQty = Math.max(0, Number(line.quantity) - (picked.get(`${line.itemId}|${line.lotId}`) ?? 0));
      if (remainingQty <= 0) continue;
      const key = `${line.itemId}|${line.lotId}`;
      const item = itemsById.get(line.itemId);
      const lot = item?.lots.find((entry) => entry.id === line.lotId);
      const existing = combined.get(key) ?? {
        itemId: line.itemId, itemCode: item?.code, itemName: item?.name, unit: item?.unit ?? 'PCS',
        lotId: line.lotId, lotNo: lot?.lotNo, expiryDate: lot?.expiryDate, totalRemainingQty: 0, destinations: [],
      };
      existing.totalRemainingQty += remainingQty;
      existing.destinations.push({ transferId: transfer.id, destinationLocationId: transfer.destinationLocationId, remainingQty });
      combined.set(key, existing);
    }
  }

  const linesWithBins = await Promise.all([...combined.values()].map(async (line) => {
    const bin = await lastKnownBin(wave.locationId, line.itemId, line.lotId);
    return { ...line, binCode: bin?.code ?? null, sequenceKey: sequenceKeyForBin(bin) };
  }));
  linesWithBins.sort((a, b) => a.sequenceKey.localeCompare(b.sequenceKey));

  return res.json({
    wave,
    transfers: transfers.map((transfer) => ({ id: transfer.id, status: transfer.status, destinationLocationId: transfer.destinationLocationId })),
    lines: linesWithBins,
  });
});

router.patch('/pick-waves/:id', async (req: Request, res: Response) => {
  const wave = await prisma.pickWave.findUnique({ where: { id: firstParam(req.params.id) } }).catch(() => null);
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  const context = accessContext(req.user!);
  const isAdmin = context.role === 'ADMIN' || context.role === 'ADMIN_USER';
  const isAssignee = wave.assignedToId === req.user!.id;
  if (!isAdmin && !isAssignee) return res.status(403).json({ message: 'You do not have access to this pick wave.' });

  const data: Record<string, unknown> = {};
  if (isAdmin && req.body.assignedToId !== undefined) data.assignedToId = req.body.assignedToId || null;
  if (req.body.status !== undefined) {
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(req.body.status)) return res.status(400).json({ message: 'Invalid status.' });
    data.status = req.body.status;
    if (req.body.status === 'IN_PROGRESS' && !wave.startedAt) data.startedAt = new Date();
    if (req.body.status === 'COMPLETED') data.completedAt = new Date();
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: 'No updatable fields were provided.' });
  const updated = await prisma.pickWave.update({ where: { id: wave.id }, data });
  return res.json({ wave: updated });
});

// ============================================
// DASHBOARD & AUDIT
// ============================================

router.get('/dashboard', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const companyId = context.companyId ?? DEFAULT_COMPANY_ID;
  const summary = buildDashboardSummary({
    counts: listCounts().filter((count) => canAccessLocation(context, count.locationId)),
    transfers: listTransfers().filter((transfer) =>
      canAccessLocation(context, transfer.sourceLocationId) && canAccessLocation(context, transfer.destinationLocationId),
    ),
    items: itemsForCompany(companyId, listItems()),
  });
  return res.json({ dashboard: summary });
});

router.get('/audit', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Audit access denied.' });
  }
  return res.json({ events: listAuditEvents() });
});

// ============================================
// CSV EXPORT / IMPORT
// ============================================

router.get('/export/:type', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can export data.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const type = firstParam(req.params.type);

  if (type === 'stock') {
    const csv = [
      ['ID', 'Code', 'Name', 'Category', 'Unit', 'Lots'].join(','),
      ...listItems().map((item) => [
        item.id, item.code, item.name, item.category ?? '', item.unit ?? '',
        item.lots.map((lot) => `${lot.lotNo}(${lot.id})`).join(';'),
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`stock-export-${today}.csv`).send(csv);
  }

  if (type === 'counts') {
    const csv = [
      ['ID', 'Item', 'Lot', 'Location', 'Physical', 'Book', 'Variance', 'Status', 'Submitted By', 'Created'].join(','),
      ...listCounts().map((count) => [
        count.id, count.itemId, count.lotId, count.locationId, count.physicalQuantity,
        count.bookQty ?? 0, count.physicalQuantity - (count.bookQty ?? 0),
        count.status ?? 'PENDING_REVIEW', count.submittedBy, count.createdAt,
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`counts-export-${today}.csv`).send(csv);
  }

  if (type === 'transfers') {
    const csv = [
      ['ID', 'From', 'To', 'Item', 'Qty', 'Status', 'Requested By', 'Created'].join(','),
      ...listTransfers().map((transfer) => [
        transfer.id, transfer.sourceLocationId, transfer.destinationLocationId,
        transfer.lines.map((line) => line.itemId).join(';'),
        transfer.lines.reduce((sum, line) => sum + line.quantity, 0),
        transfer.status, transfer.requestedBy, transfer.createdAt,
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`transfers-export-${today}.csv`).send(csv);
  }

  return res.status(400).json({ message: 'Export type must be stock, counts or transfers.' });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

type StockUpdateMode = 'SET' | 'ADD' | 'REMOVE';

function stockImportId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value.trim().toLowerCase()).digest('hex').slice(0, 20)}`;
}

function validatedStockUpdateMode(value: unknown): StockUpdateMode {
  const mode = String(value ?? '').toUpperCase();
  if (!['SET', 'ADD', 'REMOVE'].includes(mode)) throw new Error('Update mode must be SET, ADD or REMOVE.');
  return mode as StockUpdateMode;
}

function stockUpdateDelta(mode: StockUpdateMode, quantity: number, current: number): number {
  if (!Number.isFinite(quantity)) throw new Error('Quantity must be a valid number.');
  // SET assigns an absolute closing balance, so it may set stock to zero or to
  // a negative on-hand (a legitimate exported closing-stock figure e.g. after
  // an oversell/reconciliation gap) - the ERP source of truth wins outright.
  // ADD/REMOVE are relative deltas from current stock, so they still require a
  // positive quantity and still cannot drive stock negative.
  if (mode === 'SET') return quantity - current;
  if (quantity <= 0) throw new Error('Quantity must be a valid positive number for ADD/REMOVE.');
  const delta = mode === 'ADD' ? quantity : -quantity;
  if (current + delta < 0) throw new Error(`Update would make stock negative (current ${current}, change ${delta}).`);
  return delta;
}

export function planStockUpdate(preview: StockImportPreview, mode: StockUpdateMode) {
  const errors = [...preview.errors];
  const prepared: Array<{ row: StockImportPreview['validRows'][number]; item: ReturnType<typeof listItems>[number]; location: LocationRecord; lotId: string; lotNo: string; expiryDate?: string | null; isNewLot: boolean; isNewItem: boolean; isNewLocation: boolean; currentQty: number; qtyDelta: number; resultingQty: number }> = [];
  const existingItems = listItems();
  const existingLocations = listLocations();
  const plannedItems = new Map<string, ReturnType<typeof listItems>[number]>();
  const plannedLocations = new Map<string, LocationRecord>();
  const newItemIds = new Set<string>();
  const newLocationIds = new Set<string>();
  if (preview.format !== 'invexa-expiry-stock') errors.push({ rowNumber: 0, message: 'Bulk stock update requires Branch Name, Item Code/Name, Lot Code and Quantity/Closing Stock columns.' });
  for (const row of aggregateOpeningStock(preview.validRows)) {
    const codeKey = row.code.trim().toLowerCase();
    const itemNameKey = row.itemName.trim().toLowerCase();
    let item = existingItems.find((candidate) => candidate.code.trim().toLowerCase() === codeKey)
      ?? existingItems.find((candidate) => candidate.name.trim().toLowerCase() === itemNameKey)
      ?? plannedItems.get(codeKey);
    let isNewItem = false;
    if (!item && mode === 'SET') {
      item = {
        id: stockImportId('item-erp', row.code),
        code: row.code,
        name: row.itemName,
        category: row.category,
        subcategory: row.subcategory,
        company: row.companyName,
        unit: row.unit,
        lots: [],
      };
      plannedItems.set(codeKey, item);
      newItemIds.add(item.id);
      isNewItem = true;
    } else if (item) {
      isNewItem = newItemIds.has(item.id);
    }
    const locationKey = row.locationName?.trim().toLowerCase() ?? '';
    let location = existingLocations.find((candidate) => candidate.name.trim().toLowerCase() === locationKey)
      ?? plannedLocations.get(locationKey);
    let isNewLocation = false;
    if (!location && mode === 'SET' && row.locationName) {
      const normalizedLocation = row.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '');
      location = {
        id: stockImportId('loc-erp', locationKey),
        name: row.locationName,
        type: normalizedLocation === 'hobasni' || normalizedLocation === 'basni' ? 'warehouse' : 'store',
      };
      plannedLocations.set(locationKey, location);
      newLocationIds.add(location.id);
      isNewLocation = true;
    } else if (location) {
      isNewLocation = newLocationIds.has(location.id);
    }
    if (!item) { errors.push({ rowNumber: row.rowNumber, message: `Unknown item: ${row.code || row.itemName}` }); continue; }
    if (!location) { errors.push({ rowNumber: row.rowNumber, message: `Unknown branch/location: ${row.locationName}` }); continue; }
    const lotNo = row.lotNo || 'LOT-DEFAULT';
    const existingLot = item.lots.find((candidate) => candidate.lotNo.trim().toLowerCase() === lotNo.trim().toLowerCase());
    const lotId = existingLot?.id ?? (mode === 'SET'
      ? stockImportId('lot-erp', `${item.id}|${lotNo}`)
      : `lot-update-${item.id}-${lotNo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 190));
    const currentQty = findStockLedgerEntry(item.id, lotId, location.id)?.onHand ?? 0;
    try {
      const qtyDelta = stockUpdateDelta(mode, Number(row.quantity), currentQty);
      prepared.push({ row, item, location, lotId, lotNo, expiryDate: row.expiryDate, isNewLot: !existingLot, isNewItem, isNewLocation, currentQty, qtyDelta, resultingQty: currentQty + qtyDelta });
    } catch (error) { errors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : 'Invalid stock quantity.' }); }
  }
  return { errors, prepared, newItems: newItemIds.size, newLocations: newLocationIds.size };
}

function stockUpdatePreviewResponse(preview: StockImportPreview, plan: ReturnType<typeof planStockUpdate>) {
  return { sheetName: preview.sheetName, headerRow: preview.headerRow, totalRows: preview.totalRows, validRows: plan.prepared.length, invalidRows: plan.errors.length, duplicateRows: preview.duplicateRows, newItems: plan.newItems, newLocations: plan.newLocations, branches: preview.branches, errors: plan.errors.slice(0, 100), sample: plan.prepared.slice(0, 20).map((entry) => ({ rowNumber: entry.row.rowNumber, itemCode: entry.item.code, itemName: entry.item.name, locationName: entry.location.name, lotNo: entry.lotNo, currentQty: entry.currentQty, qtyDelta: entry.qtyDelta, resultingQty: entry.resultingQty, willCreateItem: entry.isNewItem, willCreateLocation: entry.isNewLocation })) };
}

async function readUploadedStockFile(req: Request): Promise<StockImportPreview> {
  if (!req.file) throw new Error('No file uploaded.');
  if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname)) {
    throw new Error('Only .xlsx, .xls and .csv files are supported.');
  }
  return parseStockImport(req.file.buffer, req.file.originalname);
}

router.get('/imports/batches', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Import history access denied.' });
  }
  try {
    const batches = await listImportBatches(Number(req.query.limit ?? 100));
    // Blueprint v4 §10.1: a batch is reversible while it is POSTED and is not itself a reversal.
    return res.json({ batches: batches.map((batch) => ({ ...batch, reversible: batch.status === 'POSTED' && !String(batch.type).includes('REVERS') })) });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Import history is unavailable.' });
  }
});

router.get('/imports/history', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  return res.json({ movements: listDailyMovements().sort((a, b) => b.transactionAt.localeCompare(a.transactionAt)).slice(0, 500) });
});

router.get('/imports/:batchToken/errors', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'AUDITOR') return res.status(403).json({ message: 'Import access denied.' });
  const csv = await buildErrorCsv(batchToken);
  if (csv === undefined) return res.status(404).json({ message: 'Import batch was not found.' });
  if (String(req.query.format ?? 'csv').toLowerCase() === 'json') {
    return res.json({ batchToken, csv });
  }
  return res.type('text/csv').attachment(`import-${batchToken}-errors.csv`).send(csv);
});

router.get('/imports/:batchToken', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'AUDITOR') return res.status(403).json({ message: 'Import access denied.' });
  const preview = await buildBatchPreviewPayload(batchToken);
  if (!preview) return res.status(404).json({ message: 'Import batch was not found.' });
  return res.json(preview);
});

const RESERVED_IMPORT_PATHS = new Set(['batches', 'history', 'opening-stock', 'sales', 'purchases']);

router.post('/imports/:batchToken/abandon', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required to abandon an import.' });
  try {
    const batch = await getBatch(batchToken);
    if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
    if (batch.importedById !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only the importer or Main Admin can abandon this preview.' });
    }
    const updated = await transitionBatch(batch.id, 'FAILED', { abandonedBy: req.user!.id, abandonedAt: new Date().toISOString() });
    return res.json({ message: 'Preview abandoned. You can upload this file again.', batchToken: updated.id, status: updated.status });
  } catch (error) {
    if (error instanceof InvalidBatchTransitionError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to abandon import.' });
  }
});

router.post('/imports/:batchToken/commit', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required to commit imports.' });
  try {
    return await commitImportBatchToken(req, res, batchToken);
  } catch (error) {
    if (error instanceof InvalidBatchTransitionError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit import.' });
  }
});

router.post('/imports/:batchId/reverse', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only the Main Admin can reverse a posted import.' });
  }
  const batchId = firstParam(req.params.batchId);
  try {
    const result = await reverseImportBatch({
      batchId,
      actorId: req.user!.id,
      reason: typeof req.body.reason === 'string' ? req.body.reason : '',
    });
    if (!result.duplicate) {
      for (const line of result.plan) {
        adjustStockLedger(line.itemId, line.lotId, line.locationId, line.qtyDelta);
        recordDailyMovement({
          id: `reversal-memory-${batchId}-${line.itemId}-${line.lotId}-${line.locationId}`,
          dedupeKey: `reversal-memory:${batchId}:${line.itemId}:${line.lotId}:${line.locationId}`,
          itemId: line.itemId,
          lotId: line.lotId,
          locationId: line.locationId,
          movementType: 'ADJUSTMENT',
          qtyDelta: line.qtyDelta,
          transactionAt: new Date().toISOString(),
          sourceType: 'ADJUSTMENT',
          sourceReference: batchId,
          createdById: req.user!.id,
          metadata: { reversalBatchId: result.reversalBatchId, operation: 'IMPORT_REVERSAL' },
        });
      }
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: result.duplicate ? 'IMPORT_REVERSAL_RETRY' : 'IMPORT_REVERSED',
      entityType: 'ImportBatch',
      entityId: batchId,
      metadata: { reason: req.body.reason, reversalBatchId: result.reversalBatchId, reversedMovements: result.reversedMovements, duplicate: result.duplicate },
    }));
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import reversal failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('already') ? 409 : 400).json({ message });
  }
});

router.post('/imports/opening-stock/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can preview imports.' });
  }
  try {
    const preview = await readUploadedStockFile(req);
    const fileHash = computeFileHash(req.file!.buffer);
    const existing = await findDuplicateBatch({
      type: 'OPENING_STOCK',
      fileHash,
      branchId: null,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
    });
    if (existing) return duplicateFileResponse(res, existing.id);
    const staged = stageOpeningStock(preview);
    const batch = await createPreviewBatch({
      type: 'OPENING_STOCK',
      fileName: req.file!.originalname,
      sourceFormat: preview.format,
      importedById: req.user!.id,
      fileHash,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: preview.duplicateRows,
      metadata: {
        sheetName: preview.sheetName,
        headerRow: preview.headerRow,
        format: preview.format,
        snapshotAt: preview.snapshotAt,
        branches: preview.branches,
        mapping: preview.mapping,
        negativeQuantityRows: preview.negativeQuantityRows,
        fractionalQuantityRows: preview.fractionalQuantityRows,
      },
      rows: staged,
    });
    return res.json({ batchToken: batch.id, preview: { ...importPreviewResponse(preview), batchToken: batch.id, status: batch.status } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to read import file.' });
  }
});

router.post('/imports/opening-stock/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can commit imports.' });
  }
  try {
    const preview = await readUploadedStockFile(req);
    if (!preview.validRows.length) {
      return res.status(400).json({ message: 'No valid rows were found to import.', preview: importPreviewResponse(preview) });
    }

    if (preview.format === 'invexa-expiry-stock') {
      if (req.body.mode !== 'replace-current') {
        return res.status(400).json({ message: 'Confirm replace-current mode after reviewing the preview.' });
      }
      const result = await persistOpeningStockImport(preview, req.file!.originalname, req.user!.id, { companyId: req.companyId ?? DEFAULT_COMPANY_ID });
      await persistAudit(recordAudit({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'OPENING_STOCK_IMPORTED',
        entityType: 'ImportBatch',
        entityId: result.batchId,
        metadata: {
          fileName: req.file!.originalname,
          format: preview.format,
          totalRows: preview.totalRows,
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          branches: preview.branches,
          ...result,
        },
      }));
      return res.json({
        message: `Imported ${result.stockRows} branch/item/lot stock rows from ${preview.validRows.length} valid rows.`,
        result,
        preview: importPreviewResponse(preview),
      });
    }

    let created = 0;
    let updated = 0;
    const imported = [];
    for (const row of preview.validRows) {
      const result = upsertItemRecord({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit });
      await persistItem(result.item);
      imported.push(result.item);
      if (result.created) created += 1;
      else updated += 1;
    }
    return res.json({ message: `Imported ${imported.length} items (${created} new, ${updated} updated).`, imported, preview: importPreviewResponse(preview) });
  } catch (error) {
    return res.status(400).json({ message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
});

router.post('/stock-adjustments/manual', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const item = listItems().find((candidate) => candidate.id === req.body.itemId);
    const location = listLocations().find((candidate) => candidate.id === req.body.locationId);
    if (!item) return res.status(400).json({ message: 'Select a valid item.' });
    if (!location) return res.status(400).json({ message: 'Select a valid location.' });
    const reason = String(req.body.reason ?? '').trim();
    if (reason.length < 3) return res.status(400).json({ message: 'Enter a reason for this auditable stock update.' });
    const lotNo = String(req.body.lotNo ?? '').trim() || item.lots[0]?.lotNo || 'LOT-DEFAULT';
    const existingLot = item.lots.find((candidate) => candidate.lotNo.trim().toLowerCase() === lotNo.toLowerCase());
    const lotId = existingLot?.id ?? `lot-update-${item.id}-${lotNo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 190);
    const currentQty = findStockLedgerEntry(item.id, lotId, location.id)?.onHand ?? 0;
    const qtyDelta = stockUpdateDelta(mode, Number(req.body.quantity), currentQty);
    const requestId = String(req.body.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Blueprint §16.2: "manual stock adjustment -> dual control for
    // high-value category." Gated on the same requestId the client already
    // sends for idempotency, so resubmitting the identical form after
    // approval both finds the APPROVED request and proceeds.
    const adjustmentValue = (await estimateValueAtRisk(item.id, Math.abs(qtyDelta))) ?? 0;
    const adjustmentLocation = await prisma.location.findUnique({ where: { id: location.id }, select: { branchId: true } }).catch(() => null);
    const gate = await checkApprovalGate({
      triggerType: 'STOCK_ADJUSTMENT', entityType: 'StockAdjustment', entityId: requestId,
      category: item.category ?? null, branchId: adjustmentLocation?.branchId ?? null, value: adjustmentValue, requestedById: req.user!.id,
    });
    if (gate.blocked) return res.status(409).json({ message: gate.reason, approvalRequestId: gate.requestId, requiredApproverRole: gate.requiredApproverRole, requestId });

    const batchId = `adjust-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movement = { id: `move-${batchId}`, dedupeKey: `ADJUSTMENT|MANUAL|${requestId}`, itemId: item.id, lotId, locationId: location.id, movementType: `MANUAL_${mode}`, qtyDelta, transactionAt: new Date().toISOString(), sourceType: 'ADJUSTMENT' as const, sourceReference: requestId, importBatchId: batchId, createdById: req.user!.id, metadata: { reason, mode, requestedQuantity: Number(req.body.quantity), previousQty: currentQty, resultingQty: currentQty + qtyDelta } };
    const newLots = existingLot ? [] : [{ id: lotId, itemId: item.id, lotNo, expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate).toISOString() : null, attributes: { source: 'manual-stock-update' } }];
    const result = await persistDailyMovementImport({ batchId, importType: 'ADJUSTMENT', fileName: 'Manual stock update', importedBy: req.user!.id, totalRows: 1, invalidRows: 0, duplicateRows: 0, movements: [movement], lots: newLots, checkpoints: [] });
    if (newLots[0]) ensureLotRecord(item.id, lotNo, newLots[0].expiryDate, newLots[0].attributes, lotId);
    if (result.committedRows) { recordDailyMovement(movement); adjustStockLedger(item.id, lotId, location.id, qtyDelta); }
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_MANUALLY_UPDATED', entityType: 'StockLedger', entityId: `${item.id}|${lotId}|${location.id}`, metadata: movement.metadata }));
    return res.status(201).json({ message: result.committedRows ? `Stock updated from ${currentQty} to ${currentQty + qtyDelta}.` : 'This stock update was already applied.', itemId: item.id, lotId, locationId: location.id, previousQty: currentQty, qtyDelta, resultingQty: result.committedRows ? currentQty + qtyDelta : currentQty });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to update stock.' }); }
});

router.post('/stock-adjustments/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const preview = await readUploadedStockFile(req);
    const fileHash = computeFileHash(req.file!.buffer);
    const existing = await findDuplicateBatch({ type: `ADJUSTMENT_${mode}`, fileHash, branchId: null, sourceDateFrom: preview.snapshotAt, sourceDateTo: preview.snapshotAt });
    if (existing) return duplicateFileResponse(res, existing.id);
    const plan = planStockUpdate(preview, mode);
    const staged = stageStockAdjustment(preview, plan, mode);
    const batch = await createPreviewBatch({
      type: `ADJUSTMENT_${mode}`,
      fileName: req.file!.originalname,
      sourceFormat: preview.format,
      importedById: req.user!.id,
      fileHash,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: preview.duplicateRows,
      metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, format: preview.format, snapshotAt: preview.snapshotAt, mode, newItems: plan.newItems, newLocations: plan.newLocations, branches: preview.branches, mapping: preview.mapping },
      rows: staged,
    });
    return res.json({ batchToken: batch.id, preview: { ...stockUpdatePreviewResponse(preview, plan), batchToken: batch.id, status: batch.status } });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview stock update.' }); }
});

router.post('/stock-adjustments/import/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const preview = await readUploadedStockFile(req);
    const plan = planStockUpdate(preview, mode);
    if (plan.errors.length || !plan.prepared.length) return res.status(400).json({ message: 'Fix all invalid rows before confirming.', preview: stockUpdatePreviewResponse(preview, plan) });
    if (mode === 'SET') {
      const result = await persistOpeningStockImport(preview, req.file.originalname, req.user!.id, { companyId: req.companyId ?? DEFAULT_COMPANY_ID });
      await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: result.batchId, metadata: { fileName: req.file.originalname, mode, rows: result.stockRows, importedItems: result.importedItems, importedLots: result.importedLots, importedLocations: result.importedLocations } }));
      return res.status(201).json({ message: `Set exact stock for ${result.stockRows} branch/item/lot rows.`, batchId: result.batchId, committedRows: result.stockRows, ...result });
    }
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 24);
    const batchId = `adjust-import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const transactionAt = new Date().toISOString();
    const movements = plan.prepared.map((entry, index) => ({ id: `move-${batchId}-${index}`, dedupeKey: `ADJUSTMENT|${mode}|${fileHash}|${entry.item.id}|${entry.lotId}|${entry.location.id}`, itemId: entry.item.id, lotId: entry.lotId, locationId: entry.location.id, movementType: `BULK_${mode}`, qtyDelta: entry.qtyDelta, transactionAt, sourceType: 'ADJUSTMENT' as const, sourceReference: req.file!.originalname, importBatchId: batchId, createdById: req.user!.id, metadata: { sourceRow: entry.row.rowNumber, mode, previousQty: entry.currentQty, resultingQty: entry.resultingQty } }));
    const lots = plan.prepared.filter((entry) => entry.isNewLot).map((entry) => ({ id: entry.lotId, itemId: entry.item.id, lotNo: entry.lotNo, expiryDate: entry.expiryDate ?? null, attributes: { source: 'bulk-stock-update' } }));
    const result = await persistDailyMovementImport({ batchId, importType: 'ADJUSTMENT', fileName: req.file.originalname, importedBy: req.user!.id, totalRows: preview.totalRows, invalidRows: preview.errors.length, duplicateRows: preview.duplicateRows, movements, lots, checkpoints: [] });
    for (const lot of lots) ensureLotRecord(lot.itemId, lot.lotNo, lot.expiryDate, lot.attributes, lot.id);
    if (result.committedRows) for (const movement of movements) { recordDailyMovement(movement); adjustStockLedger(movement.itemId, movement.lotId!, movement.locationId, movement.qtyDelta); }
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: batchId, metadata: { fileName: req.file.originalname, mode, rows: result.committedRows, fileHash } }));
    return res.status(201).json({ message: result.committedRows ? `Updated ${result.committedRows} branch/item/lot stock rows.` : 'This exact file and mode were already applied; stock was not changed again.', batchId, committedRows: result.committedRows });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit stock update.' }); }
});

router.post('/import/items', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can import data.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const preview = await readUploadedStockFile(req);
    if (preview.format !== 'standard-items') {
      return res.status(400).json({ message: 'Opening-stock files require Preview and Confirm. Use /imports/opening-stock/preview first.' });
    }
    const imported = [];
    for (const row of preview.validRows) {
      const { item } = upsertItemRecord({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit });
      await persistItem(item);
      imported.push(item);
    }
    return res.json({ message: `Imported ${imported.length} items.`, imported, preview: importPreviewResponse(preview) });
  } catch (error) {
    return res.status(400).json({ message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
});

// ---------------------------------------------------------------------------
// Daily external ERP sync: purchases only enter H.O. Basni warehouse; sales
// leave their source branch and sales returns add stock back to that branch.
// ---------------------------------------------------------------------------
const normalName = (input: string) => input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const isOperationalAdmin = (role: string) => role === 'ADMIN' || role === 'ADMIN_USER';

function configuredPurchaseWarehouse() {
  const warehouses = listLocations().filter((location) => location.type === 'warehouse');
  const basni = warehouses.find((location) => /basni|hobasni|ho/.test(normalName(location.name)));
  return basni ?? (warehouses.length === 1 ? warehouses[0] : undefined);
}

function dailyItem(row: DailyStockRow) {
  const catalog = listItems();
  const code = row.itemCode ? catalog.find((item) => normalName(item.code) === normalName(row.itemCode!)) : undefined;
  if (code) return code;
  // ERP alias / barcode mapping (blueprint v4 §10); a row with a code never falls back to its name.
  if (row.itemCode) return resolveItemByIdentity(catalog, { code: row.itemCode }).item;
  const matched = catalog.filter((item) => normalName(item.name) === normalName(row.itemName));
  if (matched.length === 1) return matched[0];
  return matched.length === 0 ? resolveItemByIdentity(catalog, { name: row.itemName }).item : undefined;
}

function inactiveImportMessage(item: { code: string; status?: string }): string {
  return `Item ${item.code} is ${String(item.status ?? 'inactive').toLowerCase()} and cannot be imported.`;
}

function planDailyImport(preview: DailyImportPreview, importedBy: string) {
  const errors = [...preview.errors]; const warehouse = configuredPurchaseWarehouse(); const prepared: Array<{ row: DailyStockRow; item: ReturnType<typeof listItems>[number]; locationId: string; lotId: string; qtyDelta: number; newLot?: ReturnType<typeof ensureLotRecord> }> = [];
  if (preview.importType === 'PURCHASE' && !warehouse) errors.push({ rowNumber: 0, message: 'Set exactly one warehouse as H.O. Basni before importing purchases.' });
  for (const row of preview.validRows) {
    const item = dailyItem(row);
    if (!item) { errors.push({ rowNumber: row.rowNumber, message: row.itemCode ? `Unknown Item Code: ${row.itemCode}` : `Unknown or ambiguous Item Name: ${row.itemName}` }); continue; }
    if (!isOperationalItem(item)) { errors.push({ rowNumber: row.rowNumber, message: inactiveImportMessage(item) }); continue; }
    const location = preview.importType === 'PURCHASE' ? warehouse : matchImportLocation(row.locationName, listLocations());
    if (!location) { errors.push({ rowNumber: row.rowNumber, message: `Unknown ${preview.importType === 'PURCHASE' ? 'H.O. Basni warehouse' : 'sales branch'}: ${row.locationName}` }); continue; }
    if (preview.importType === 'PURCHASE' && location.type !== 'warehouse') { errors.push({ rowNumber: row.rowNumber, message: 'Purchase can be received only into H.O. Basni warehouse.' }); continue; }
    let lot = row.lotNo ? item.lots.find((entry) => normalName(entry.lotNo) === normalName(row.lotNo!)) : undefined;
    if (!lot && row.movementType === 'SALE_OUT') {
      const available = item.lots.map((entry) => ({ lot: entry, qty: listStockLedgerForLocation(location.id).find((stock) => stock.itemId === item.id && stock.lotId === entry.id)?.onHand ?? 0 })).filter((entry) => entry.qty > 0).sort((a, b) => new Date(a.lot.expiryDate ?? '9999-12-31').getTime() - new Date(b.lot.expiryDate ?? '9999-12-31').getTime());
      let remaining = row.quantity;
      for (const candidate of available) { if (remaining <= 0) break; const quantity = Math.min(remaining, candidate.qty); prepared.push({ row, item, locationId: location.id, lotId: candidate.lot.id, qtyDelta: -quantity }); remaining -= quantity; }
      if (remaining > 0) errors.push({ rowNumber: row.rowNumber, message: `${item.code} has insufficient stock at ${location.name}; ${remaining} cannot be deducted.` });
      continue;
    }
    let newLot: ReturnType<typeof ensureLotRecord> | undefined;
    if (!lot) {
      const lotNo = row.movementType === 'SALES_RETURN' ? `RETURN-${row.reference}` : (row.lotNo || 'LOT-DEFAULT');
      newLot = { id: `lot-sync-${item.id}-${normalName(lotNo)}`.slice(0, 180), itemId: item.id, lotNo, expiryDate: null, attributes: { source: row.movementType === 'SALES_RETURN' ? 'sales-return-import' : 'purchase-import' } };
      lot = newLot;
    }
    prepared.push({ row, item, locationId: location.id, lotId: lot.id, qtyDelta: row.movementType === 'SALE_OUT' ? -row.quantity : row.quantity, newLot });
  }
  return { errors, prepared, warehouse };
}

async function duplicateFileResponse(res: Response, existingId: string) {
  const existing = await getBatch(existingId);
  if (!existing) return res.status(409).json({ message: 'This file was already imported.' });
  const preview = await buildBatchPreviewPayload(existing.id);
  return res.status(409).json({
    message: duplicateConflictMessage(existing),
    batchToken: existing.id,
    status: existing.status,
    committedRows: existing.metadata?.committedRows ?? existing.validRows,
    preview,
  });
}

async function applyDailyLedger(movements: DailyMovementRecord[], lots: LotRecord[], checkpoints: Array<{ locationId: string; sourceType: 'SALES' | 'PURCHASE'; syncedThroughAt: string; lastImportBatchId: string }>, committedRows: number) {
  if (!committedRows) return;
  for (const lot of lots) ensureLotRecord(lot.itemId, lot.lotNo, lot.expiryDate, lot.attributes, lot.id);
  for (const movement of movements) {
    recordDailyMovement(movement);
    if (movement.lotId) adjustStockLedger(movement.itemId, movement.lotId, movement.locationId, movement.qtyDelta);
  }
  for (const checkpoint of checkpoints) upsertSyncCheckpoint(checkpoint);
}

function checkpointsFor(importType: 'SALES' | 'PURCHASE', batchId: string, movements: DailyMovementRecord[]) {
  const latestByLocation = new Map<string, string>();
  for (const movement of movements) {
    latestByLocation.set(movement.locationId, [latestByLocation.get(movement.locationId), movement.transactionAt].filter(Boolean).sort().at(-1)!);
  }
  return [...latestByLocation.entries()].map(([locationId, syncedThroughAt]) => ({ locationId, sourceType: importType, syncedThroughAt, lastImportBatchId: batchId }));
}

async function commitImportBatchToken(req: Request, res: Response, batchToken: string) {
  const batch = await getBatch(batchToken);
  if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
  if (batch.importedById !== req.user!.id && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only the importer or Main Admin can commit this preview.' });
  }
  if (batch.status === 'POSTED') {
    return res.status(409).json({
      message: `Batch ${batch.id} is already posted.`,
      batchToken: batch.id,
      status: batch.status,
      committedRows: batch.metadata?.committedRows ?? batch.validRows,
    });
  }
  if (batch.status !== 'PREVIEWED' && batch.status !== 'VALIDATED') {
    return res.status(400).json({ message: `Batch ${batch.id} cannot be committed from ${batch.status}.` });
  }
  const counts = await countRowsByStatus(batch.id);
  if (counts.INVALID > 0 || counts.VALID === 0) {
    return res.status(400).json({ message: 'Fix all invalid or unmapped rows before confirming.', invalidRows: counts.INVALID, validRows: counts.VALID });
  }
  if (batch.status === 'PREVIEWED') await transitionBatch(batch.id, 'VALIDATED');
  const validRows = await listRows(batch.id, 'VALID');

  if (batch.type === 'SALES' || batch.type === 'PURCHASE') {
    const importType = batch.type;
    const { movements, lots } = movementsFromStagedDailyRows(batch.id, req.user!.id, importType, validRows);
    const checkpoints = checkpointsFor(importType, batch.id, movements);
    const persisted = await persistDailyMovementImport({
      batchId: batch.id,
      importType,
      fileName: batch.fileName,
      importedBy: req.user!.id,
      totalRows: batch.totalRows,
      invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows,
      transactionFrom: batch.sourceDateFrom ?? undefined,
      transactionTo: batch.sourceDateTo ?? undefined,
      movements,
      lots,
      checkpoints,
      fileHash: batch.fileHash ?? undefined,
      branchId: batch.branchId,
      sourceFormat: batch.sourceFormat,
      metadata: batch.metadata ?? undefined,
    });
    await applyDailyLedger(movements, lots, checkpoints, persisted.committedRows);
    // Movements dated before an existing count make that count's book quantity stale.
    await applyLateMovementsQuietly(movements, req.user!.id);
    await transitionBatch(batch.id, 'POSTED', { committedRows: persisted.committedRows });
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `${importType}_IMPORT_COMMITTED`,
      entityType: 'ImportBatch',
      entityId: batch.id,
      metadata: { fileName: batch.fileName, rows: persisted.committedRows, batchToken: batch.id },
    }));
    return res.status(201).json({
      message: `${importType === 'PURCHASE' ? 'Purchase received into H.O. Basni' : 'Sales and sales returns'} committed: ${persisted.committedRows} stock movements.`,
      batchId: batch.id,
      batchToken: batch.id,
      committedRows: persisted.committedRows,
    });
  }

  if (batch.type === 'OPENING_STOCK' || batch.type === 'ADJUSTMENT_SET') {
    const preview = openingPreviewFromStagedRows(batch, validRows);
    if (batch.type === 'OPENING_STOCK' && preview.format === 'invexa-expiry-stock' && req.body?.mode && req.body.mode !== 'replace-current') {
      return res.status(400).json({ message: 'Confirm replace-current mode after reviewing the preview.' });
    }
    if (preview.format === 'standard-items' && batch.type === 'OPENING_STOCK') {
      let created = 0;
      let updated = 0;
      const imported = [];
      for (const row of preview.validRows) {
        const result = upsertItemRecord({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit });
        await persistItem(result.item);
        imported.push(result.item);
        if (result.created) created += 1;
        else updated += 1;
      }
      await transitionBatch(batch.id, 'POSTED', { committedRows: imported.length });
      return res.json({ message: `Imported ${imported.length} items (${created} new, ${updated} updated).`, imported, batchToken: batch.id, committedRows: imported.length });
    }
    const result = await persistOpeningStockImport(preview, batch.fileName, req.user!.id, { batchId: batch.id, fileHash: batch.fileHash ?? undefined, branchId: batch.branchId, companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    await transitionBatch(batch.id, 'POSTED', { committedRows: result.stockRows });
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: batch.type === 'OPENING_STOCK' ? 'OPENING_STOCK_IMPORTED' : 'STOCK_UPDATE_FILE_IMPORTED',
      entityType: 'ImportBatch',
      entityId: result.batchId,
      metadata: { fileName: batch.fileName, rows: result.stockRows, batchToken: batch.id, ...result },
    }));
    return res.status(201).json({
      message: batch.type === 'OPENING_STOCK'
        ? `Imported ${result.stockRows} branch/item/lot stock rows from ${preview.validRows.length} valid rows.`
        : `Set exact stock for ${result.stockRows} branch/item/lot rows.`,
      result,
      batchId: result.batchId,
      batchToken: batch.id,
      committedRows: result.stockRows,
    });
  }

  if (batch.type === 'ADJUSTMENT_ADD' || batch.type === 'ADJUSTMENT_REMOVE') {
    const mode = batch.type === 'ADJUSTMENT_ADD' ? 'ADD' : 'REMOVE';
    const fileHash = batch.fileHash ?? computeFileHash(Buffer.from(batch.id));
    const transactionAt = new Date().toISOString();
    const movements: DailyMovementRecord[] = [];
    const lots: LotRecord[] = [];
    validRows.forEach((row, index) => {
      const mapped = row.mappedData ?? {};
      const lotId = String(mapped.lotId ?? '');
      const itemId = String(mapped.itemId ?? '');
      const locationId = String(mapped.locationId ?? '');
      if (!lotId || !itemId || !locationId) return;
      if (mapped.isNewLot) {
        lots.push({
          id: lotId,
          itemId,
          lotNo: String(mapped.lotNo ?? 'LOT-DEFAULT'),
          expiryDate: typeof mapped.expiryDate === 'string' ? mapped.expiryDate : null,
          attributes: { source: 'bulk-stock-update' },
        });
      }
      movements.push({
        id: `move-${batch.id}-${index}`,
        dedupeKey: `ADJUSTMENT|${mode}|${fileHash}|${itemId}|${lotId}|${locationId}`,
        itemId,
        lotId,
        locationId,
        movementType: `BULK_${mode}`,
        qtyDelta: Number(mapped.qtyDelta),
        transactionAt,
        sourceType: 'ADJUSTMENT',
        sourceReference: batch.fileName,
        importBatchId: batch.id,
        createdById: req.user!.id,
        metadata: { sourceRow: row.rowNumber, mode, previousQty: mapped.currentQty, resultingQty: mapped.resultingQty },
      });
    });
    const persisted = await persistDailyMovementImport({
      batchId: batch.id,
      importType: batch.type,
      fileName: batch.fileName,
      importedBy: req.user!.id,
      totalRows: batch.totalRows,
      invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows,
      movements,
      lots,
      checkpoints: [],
      fileHash,
      branchId: batch.branchId,
      sourceFormat: batch.sourceFormat,
    });
    await applyDailyLedger(movements, lots, [], persisted.committedRows);
    await transitionBatch(batch.id, 'POSTED', { committedRows: persisted.committedRows });
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: batch.id, metadata: { fileName: batch.fileName, mode, rows: persisted.committedRows, fileHash } }));
    return res.status(201).json({
      message: persisted.committedRows ? `Updated ${persisted.committedRows} branch/item/lot stock rows.` : 'This exact file and mode were already applied; stock was not changed again.',
      batchId: batch.id,
      batchToken: batch.id,
      committedRows: persisted.committedRows,
    });
  }

  return res.status(400).json({ message: `Unsupported import type ${batch.type}.` });
}

async function previewDailyImport(req: Request, res: Response, importType: 'SALES' | 'PURCHASE') {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for daily imports.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const warehouse = configuredPurchaseWarehouse();
    const fileHash = computeFileHash(req.file.buffer);
    const preview = await parseDailyStockImport(req.file.buffer, req.file.originalname, importType, { purchaseLocationName: warehouse?.name ?? 'H.O BASNI', purchaseTime: String(req.body.purchaseTime || '12:00') });
    const existing = await findDuplicateBatch({
      type: importType,
      fileHash,
      branchId: importType === 'PURCHASE' ? warehouse?.id ?? null : null,
      sourceDateFrom: preview.transactionFrom ?? null,
      sourceDateTo: preview.transactionTo ?? null,
    });
    if (existing) return duplicateFileResponse(res, existing.id);
    const plan = planDailyImport(preview, req.user!.id);
    const staged = stageDailyImport(preview, plan);
    const batch = await createPreviewBatch({
      type: importType,
      fileName: req.file.originalname,
      sourceFormat: 'daily-erp-export',
      importedById: req.user!.id,
      fileHash,
      branchId: importType === 'PURCHASE' ? warehouse?.id ?? null : null,
      sourceDateFrom: preview.transactionFrom ?? null,
      sourceDateTo: preview.transactionTo ?? null,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: staged.filter((row) => row.status === 'DUPLICATE').length,
      metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, mapping: preview.mapping, purchaseWarehouse: warehouse?.name },
      rows: staged,
    });
    return res.json({
      batchToken: batch.id,
      preview: {
        ...preview,
        batchToken: batch.id,
        status: batch.status,
        validRows: batch.validRows,
        invalidRows: batch.invalidRows,
        duplicateRows: batch.duplicateRows,
        errors: plan.errors.concat(preview.errors).slice(0, 100),
        sample: plan.prepared.slice(0, 20).map((entry) => ({
          ...entry.row,
          itemCode: entry.item.code,
          locationId: entry.locationId,
          qtyDelta: entry.qtyDelta,
          lotNo: entry.item.lots?.find((lot) => lot.id === entry.lotId)?.lotNo ?? entry.row.lotNo,
        })),
      },
    });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview import.' }); }
}

async function commitDailyImport(req: Request, res: Response, importType: 'SALES' | 'PURCHASE') {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for daily imports.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const warehouse = configuredPurchaseWarehouse(); const preview = await parseDailyStockImport(req.file.buffer, req.file.originalname, importType, { purchaseLocationName: warehouse?.name ?? 'H.O BASNI', purchaseTime: String(req.body.purchaseTime || '12:00') }); const plan = planDailyImport(preview, req.user!.id);
    if (plan.errors.length || !plan.prepared.length) return res.status(400).json({ message: 'Fix all invalid or unmapped rows before confirming.', errors: plan.errors.slice(0, 100) });
    const batchId = `imp-${importType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movements = plan.prepared.map((entry, index) => ({ id: `move-${batchId}-${index}`, dedupeKey: `${entry.row.dedupeKey}|${entry.lotId}`, itemId: entry.item.id, lotId: entry.lotId, locationId: entry.locationId, movementType: entry.row.movementType, qtyDelta: entry.qtyDelta, transactionAt: entry.row.transactionAt, sourceType: importType, sourceReference: entry.row.reference, importBatchId: batchId, createdById: req.user!.id, metadata: { lineNo: entry.row.lineNo, sourceItemName: entry.row.itemName, rate: entry.row.rate, amount: entry.row.amount, timeAssumed: entry.row.timeAssumed, rowSource: entry.row.rowSource } }));
    const latestByLocation = new Map<string, string>(); for (const movement of movements) latestByLocation.set(movement.locationId, [latestByLocation.get(movement.locationId), movement.transactionAt].filter(Boolean).sort().at(-1)!);
    const checkpoints = [...latestByLocation.entries()].map(([locationId, syncedThroughAt]) => ({ locationId, sourceType: importType, syncedThroughAt, lastImportBatchId: batchId }));
    const persisted = await persistDailyMovementImport({ batchId, importType, fileName: req.file.originalname, importedBy: req.user!.id, totalRows: preview.totalRows, invalidRows: preview.errors.length, duplicateRows: preview.duplicateRows, transactionFrom: preview.transactionFrom, transactionTo: preview.transactionTo, movements, lots: plan.prepared.flatMap((entry) => entry.newLot ? [entry.newLot] : []), checkpoints });
    for (const entry of plan.prepared) if (entry.newLot) ensureLotRecord(entry.newLot.itemId, entry.newLot.lotNo, entry.newLot.expiryDate, entry.newLot.attributes, entry.newLot.id);
    for (const movement of movements) { recordDailyMovement(movement); adjustStockLedger(movement.itemId, movement.lotId!, movement.locationId, movement.qtyDelta); }
    for (const checkpoint of checkpoints) upsertSyncCheckpoint(checkpoint);
    await applyLateMovementsQuietly(movements, req.user!.id);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: `${importType}_IMPORT_COMMITTED`, entityType: 'ImportBatch', entityId: batchId, metadata: { fileName: req.file.originalname, rows: persisted.committedRows, transactionFrom: preview.transactionFrom, transactionTo: preview.transactionTo, purchaseWarehouse: warehouse?.name } }));
    return res.status(201).json({ message: `${importType === 'PURCHASE' ? 'Purchase received into H.O. Basni' : 'Sales and sales returns'} committed: ${persisted.committedRows} stock movements.`, batchId, committedRows: persisted.committedRows });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit import.' }); }
}

router.post('/imports/sales/preview', upload.single('file'), (req, res) => previewDailyImport(req, res, 'SALES'));
router.post('/imports/sales/commit', upload.single('file'), (req, res) => commitDailyImport(req, res, 'SALES'));
router.post('/imports/purchases/preview', upload.single('file'), (req, res) => previewDailyImport(req, res, 'PURCHASE'));
router.post('/imports/purchases/commit', upload.single('file'), (req, res) => commitDailyImport(req, res, 'PURCHASE'));

router.get('/sync-status', (req: Request, res: Response) => {
  const checkpoints = listSyncCheckpoints();
  return res.json({ locations: listLocations().map((location) => ({ locationId: location.id, locationName: location.name, salesSyncedThrough: checkpoints.find((entry) => entry.locationId === location.id && entry.sourceType === 'SALES')?.syncedThroughAt ?? null, purchaseSyncedThrough: checkpoints.find((entry) => entry.locationId === location.id && entry.sourceType === 'PURCHASE')?.syncedThroughAt ?? null })) });
});

// ---------------------------------------------------------------------------
// Warehouse transfer import, lot-aware picker sessions and bulk stock take
// ---------------------------------------------------------------------------

function exactItemMatch(itemCode?: string, itemName?: string) {
  // Code, barcode or ERP alias when a code is given (never falling back to
  // the name); otherwise a unique name or alias.
  return resolveItemByIdentity(listItems(), itemCode ? { code: itemCode } : { name: itemName }).item;
}

function transferImportPlan(preview: Awaited<ReturnType<typeof parseTransferImport>>, sourceLocationId: string, destinationLocationId: string, mergeDuplicates: boolean) {
  const errors = [...preview.errors];
  const sourceLedger = listStockLedgerForLocation(sourceLocationId);
  const destination = listLocations().find((location) => location.id === destinationLocationId);
  const rows = mergeDuplicates
    ? [...preview.validRows.reduce((map, row) => {
        const key = (row.itemCode || row.itemName || '').trim().toLowerCase();
        const existing = map.get(key);
        if (existing) existing.requestedQty += row.requestedQty;
        else map.set(key, { ...row });
        return map;
      }, new Map<string, (typeof preview.validRows)[number]>()).values()]
    : preview.validRows;
  const mapped = [];
  for (const row of rows) {
    if (row.destinationStore && destination && ![destination.id, destination.name].some((value) => value.trim().toLowerCase() === row.destinationStore!.trim().toLowerCase())) {
      errors.push({ rowNumber: row.rowNumber, message: `Destination Store ${row.destinationStore} does not match selected destination ${destination.name}.` });
      continue;
    }
    const item = exactItemMatch(row.itemCode, row.itemName);
    if (!item) {
      errors.push({ rowNumber: row.rowNumber, message: row.itemCode ? `Unknown Item Code: ${row.itemCode}` : `Item Name is unknown or ambiguous: ${row.itemName}` });
      continue;
    }
    if (!isOperationalItem(item)) {
      errors.push({ rowNumber: row.rowNumber, message: inactiveImportMessage(item) });
      continue;
    }
    const lots = item.lots.map((lot) => ({
      lotId: lot.id,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate,
      available: sourceLedger.find((entry) => entry.itemId === item.id && entry.lotId === lot.id)?.onHand ?? 0,
      status: lot.status ?? 'AVAILABLE',
    }));
    const workflow = getActiveWorkflow();
    if (workflow.expiryBlocking && lots.every((lot) => lot.status !== 'AVAILABLE' || (lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now()))) {
      errors.push({ rowNumber: row.rowNumber, message: `${item.code} has no allocatable lots while expiry blocking is on.` });
      continue;
    }
    const allocated = allocateLots(lots, row.requestedQty, workflow.allocationStrategy);
    if (allocated.shortage > 0) {
      errors.push({ rowNumber: row.rowNumber, message: `${item.code} has ${row.requestedQty - allocated.shortage} available; ${row.requestedQty} requested.` });
      continue;
    }
    mapped.push({ ...row, item, allocations: allocated.allocations, totalAvailable: lots.reduce((sum, lot) => sum + lot.available, 0) });
  }
  return { mapped, errors };
}

router.post('/transfers/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can import transfers.' });
  if (!req.file || !req.body.sourceLocationId || !req.body.destinationLocationId) return res.status(400).json({ message: 'File, source and destination are required.' });
  try {
    const preview = await parseTransferImport(req.file.buffer, req.file.originalname);
    const plan = transferImportPlan(preview, req.body.sourceLocationId, req.body.destinationLocationId, req.body.mergeDuplicates !== 'false');
    return res.json({ preview: {
      sheetName: preview.sheetName, headerRow: preview.headerRow, totalRows: preview.totalRows,
      validRows: plan.mapped.length, invalidRows: plan.errors.length, duplicateRows: preview.duplicateRows,
      mapping: preview.mapping, rows: plan.mapped.slice(0, 50).map(({ item, allocations, ...row }) => ({ ...row, itemId: item.id, itemCode: item.code, itemName: item.name, allocations })),
      errors: plan.errors.slice(0, 100),
    } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview transfer.' });
  }
});

router.post('/transfers/import/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can import transfers.' });
  if (!req.file || !req.body.sourceLocationId || !req.body.destinationLocationId) return res.status(400).json({ message: 'File, source and destination are required.' });
  if (req.body.sourceLocationId === req.body.destinationLocationId) return res.status(400).json({ message: 'Source and destination must differ.' });
  try {
    const preview = await parseTransferImport(req.file.buffer, req.file.originalname);
    const plan = transferImportPlan(preview, req.body.sourceLocationId, req.body.destinationLocationId, req.body.mergeDuplicates !== 'false');
    if (plan.errors.length || !plan.mapped.length) return res.status(400).json({ message: 'Fix all unmapped or insufficient-stock rows before confirming.', errors: plan.errors.slice(0, 100) });
    const transfer: TransferRecord = {
      id: `transfer-${Math.random().toString(36).slice(2, 10)}`,
      sourceLocationId: req.body.sourceLocationId,
      destinationLocationId: req.body.destinationLocationId,
      requestedBy: req.user!.id,
      role: 'ADMIN',
      status: 'PENDING_PICK',
      lines: plan.mapped.flatMap(({ item, allocations }) => allocations.map((allocation) => ({ itemId: item.id, lotId: allocation.lotId, quantity: allocation.quantity }))),
      notes: `Imported from ${req.file.originalname}`,
      createdAt: new Date().toISOString(),
    };
    createTransferRecord(transfer);
    await persistTransfer(transfer);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_IMPORTED', entityType: 'Transfer', entityId: transfer.id, metadata: { fileName: req.file.originalname, sourceLocationId: transfer.sourceLocationId, destinationLocationId: transfer.destinationLocationId, rows: preview.totalRows, duplicateRows: preview.duplicateRows, mergeDuplicates: req.body.mergeDuplicates !== 'false' } }));
    return res.status(201).json({ message: `Transfer ${transfer.id} released to picker with ${transfer.lines.length} FEFO lot allocations.`, transfer });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to import transfer.' });
  }
});

async function savedPickSlips(transferId: string) {
  if (databaseEnabled) return loadTransferPickSlips(transferId);
  return listAuditEvents().filter((event) => event.entityType === 'Transfer' && event.entityId === transferId && event.action === 'PICK_SLIP_SAVED');
}

router.get('/picker/transfers/:transferId', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((entry) => entry.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role) || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker access denied.' });
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const itemsById = new Map(listItems().map((item) => [item.id, item]));
  const slips = await savedPickSlips(transferId);
  const picked = new Map<string, number>();
  for (const slip of slips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`;
    picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
  }
  const lines = transfer.lines.map((line, index) => {
    const item = itemsById.get(line.itemId);
    const lot = item?.lots.find((entry) => entry.id === line.lotId);
    const pickedQty = picked.get(`${line.itemId}|${line.lotId}`) ?? 0;
    return {
      lineId: `${transfer.id}:${index}`, itemId: line.itemId, itemCode: item?.code, itemName: item?.name,
      unit: item?.unit ?? 'PCS', pickMethod: item?.pickMethod ?? 'LOT_SCAN', lotStatus: lot?.status ?? 'AVAILABLE', requestedQty: line.quantity, pickedQty, remainingQty: Math.max(0, line.quantity - pickedQty),
      lotId: line.lotId, lotNo: lot?.lotNo, expiryDate: lot?.expiryDate,
      lotAvailable: ledger.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId)?.onHand ?? 0,
    };
  });
  return res.json({ transfer: { ...transfer, lines }, pickSlips: slips.map((event) => event.metadata) });
});

// Blueprint v4 §15: what a KG pick would take, lot by lot, before it is confirmed.
async function pooledPickState(transfer: TransferRecord, itemId: string) {
  const item = listItems().find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Item was not found.');
  if (!isPooledPick(item)) throw new Error(`${item.code} is picked by scanning its lot, not by weight.`);
  const requestedTotal = transfer.lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
  if (!(requestedTotal > 0)) throw new Error('This item is not part of the transfer.');
  const priorSlips = await savedPickSlips(transfer.id);
  const pickedByLot = new Map<string, number>();
  for (const slip of priorSlips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    if (line.itemId === itemId) pickedByLot.set(line.lotId, (pickedByLot.get(line.lotId) ?? 0) + Number(line.quantity ?? 0));
  }
  const pickedTotal = [...pickedByLot.values()].reduce((sum, value) => sum + value, 0);
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const lots = item.lots.map((lot) => ({
    lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate, status: lot.status,
    available: Math.max(0, (ledger.find((entry) => entry.itemId === itemId && entry.lotId === lot.id)?.onHand ?? 0) - (pickedByLot.get(lot.id) ?? 0)),
  }));
  return { item, remaining: Math.max(0, Math.round((requestedTotal - pickedTotal) * 1000) / 1000), lots };
}

router.post('/picker/transfers/:transferId/allocation-preview', async (req: Request, res: Response) => {
  const transfer = listTransfers().find((entry) => entry.id === firstParam(req.params.transferId));
  const context = accessContext(req.user!);
  if (!transfer || !['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role) || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  try {
    const quantity = Number(req.body?.quantity);
    const state = await pooledPickState(transfer, String(req.body?.itemId ?? ''));
    if (Number.isFinite(quantity) && quantity > state.remaining + 1e-8) throw new Error(`Only ${state.remaining} is still to be picked for this item.`);
    const { allocations, shortfall } = allocatePick({ requested: quantity, lots: state.lots, strategy: state.item.allocationStrategy ?? 'FEFO' });
    return res.json({ itemId: state.item.id, unit: state.item.unit ?? 'KG', requested: quantity, remaining: state.remaining, strategy: state.item.allocationStrategy ?? 'FEFO', allocations, shortfall });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview this pick.' });
  }
});

router.post('/picker/transfers/:transferId/pick-slips', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((entry) => entry.id === transferId);
  const context = accessContext(req.user!);
  if (!transfer || context.role !== 'WAREHOUSE_PICKER' || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  const prior = await savedPickSlips(transferId);
  // Retry-safe (blueprint §38): the same request id returns the slip it already saved.
  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim().slice(0, 191) : '';
  if (requestId) {
    const saved = prior.find((event) => event.metadata?.requestId === requestId && event.metadata?.pickerId === req.user!.id);
    if (saved) return res.status(200).json({ message: 'This pick slip was already saved.', duplicate: true, pickSlip: saved.metadata, transfer });
  }
  if (!['PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL'].includes(transfer.status)) return res.status(400).json({ message: `Transfer cannot be picked while ${transfer.status}.` });
  let lines: any[] = Array.isArray(req.body.lines) ? req.body.lines : [];
  const exceptions = Array.isArray(req.body.exceptions) ? req.body.exceptions : [];
  if (!lines.length && !exceptions.length) return res.status(400).json({ message: 'At least one picked line or exception is required.' });
  const itemMap = new Map(listItems().map((item) => [item.id, item]));
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const priorPicked = new Map<string, number>();
  for (const slip of prior) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`; priorPicked.set(key, (priorPicked.get(key) ?? 0) + Number(line.quantity ?? 0));
  }
  try {
    // A KG line carries only item + weight: the server chooses the lots (FIFO/FEFO), the picker never splits them.
    const expanded: any[] = [];
    for (const line of lines) {
      const item = itemMap.get(line.itemId);
      if (item && isPooledPick(item) && !line.lotId) {
        const state = await pooledPickState(transfer, line.itemId);
        const pending = expanded.filter((row) => row.itemId === line.itemId).reduce((sum, row) => sum + row.quantity, 0);
        const { allocations, shortfall } = allocatePick({
          requested: Number(line.quantity), strategy: item.allocationStrategy ?? 'FEFO',
          lots: state.lots.map((lot) => ({ ...lot, available: Math.max(0, lot.available - expanded.filter((row) => row.lotId === lot.lotId).reduce((sum, row) => sum + row.quantity, 0)) })),
        });
        if (shortfall > 0) throw new Error(`Only ${Math.round((Number(line.quantity) - shortfall) * 1000) / 1000} of ${item.code} is available in pickable lots. Report it as No Stock or pick less.`);
        if (pending + Number(line.quantity) > state.remaining + 1e-8) throw new Error(`${item.code} exceeds remaining requested quantity.`);
        for (const allocation of allocations) expanded.push({ itemId: line.itemId, lotId: allocation.lotId, quantity: allocation.quantity, inputMethod: 'MANUAL', allocated: true });
      } else {
        expanded.push(line);
      }
    }
    lines = expanded;

    const runningLot = new Map(priorPicked);
    const runningItem = new Map<string, number>();
    for (const [key, quantity] of priorPicked) runningItem.set(key.split('|')[0], (runningItem.get(key.split('|')[0]) ?? 0) + quantity);
    for (const line of lines) {
      const requested = transfer.lines.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId);
      const item = itemMap.get(line.itemId);
      const lot = item?.lots.find((entry) => entry.id === line.lotId);
      const pooled = Boolean(item && isPooledPick(item));
      if (!item || !lot || (!requested && !pooled)) throw new Error('Picked item/lot is not part of this transfer.');
      const quantity = Number(line.quantity);
      validatePickInput({ unit: item.unit, quantity, inputMethod: line.inputMethod, scanCode: line.scanCode, itemCode: item.code, lotNo: lot.lotNo });
      const lotKey = `${line.itemId}|${line.lotId}`;
      const alreadyLot = runningLot.get(lotKey) ?? 0;
      if (pooled) {
        const total = transfer.lines.filter((entry) => entry.itemId === line.itemId).reduce((sum, entry) => sum + entry.quantity, 0);
        if ((runningItem.get(line.itemId) ?? 0) + quantity > total + 1e-8) throw new Error(`${item.code} exceeds remaining requested quantity.`);
      } else if (alreadyLot + quantity > requested!.quantity + 1e-8) {
        throw new Error(`${item.code}/${lot.lotNo} exceeds remaining requested quantity.`);
      }
      const onHand = ledger.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId)?.onHand ?? 0;
      // Blueprint §15: never a zero, blocked or expired lot - and stock already picked on this transfer is spoken for.
      if (!isPickableLot({ status: lot.status, available: onHand - alreadyLot, expiryDate: lot.expiryDate })) {
        throw new Error(`${item.code}/${lot.lotNo} cannot be picked: it is blocked, expired or has no stock left.`);
      }
      if (quantity > onHand - alreadyLot + 1e-8) throw new Error(`${item.code}/${lot.lotNo} exceeds available stock.`);
      runningLot.set(lotKey, alreadyLot + quantity);
      runningItem.set(line.itemId, (runningItem.get(line.itemId) ?? 0) + quantity);
    }
    for (const exception of exceptions) {
      if (!PICK_EXCEPTION_REASONS.includes(exception.reason)) throw new Error('Exception reason must be No Stock, Wrong Item or Damaged Item.');
      if (!Number.isFinite(Number(exception.quantity)) || Number(exception.quantity) <= 0) throw new Error('Exception quantity must be greater than zero.');
    }
    const slipId = `pick-${Math.random().toString(36).slice(2, 10)}`;
    const metadata = { id: slipId, requestId: requestId || undefined, pickerId: req.user!.id, startedAt: req.body.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), lines: lines.map((line: any) => ({ ...line, quantity: Number(line.quantity) })), exceptions: exceptions.map((entry: any) => ({ ...entry, quantity: Number(entry.quantity), recordedAt: new Date().toISOString() })) };
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'PICK_SLIP_SAVED', entityType: 'Transfer', entityId: transfer.id, metadata }));

    // Blueprint WF-12 (Warehouse Exception): a picker-flagged No Stock,
    // Wrong Item or Damaged Item exception opens an owned Exception Inbox
    // case for supervisor resolution instead of silently dropping the line.
    const PICK_EXCEPTION_TYPE: Record<string, 'MISSING_STOCK' | 'WRONG_ITEM' | 'DAMAGE'> = {
      NO_STOCK: 'MISSING_STOCK', WRONG_ITEM: 'WRONG_ITEM', DAMAGED_ITEM: 'DAMAGE',
      'No Stock': 'MISSING_STOCK', 'Wrong Item': 'WRONG_ITEM', 'Damaged Item': 'DAMAGE',
    };
    for (const exception of exceptions) {
      const item = itemMap.get(exception.itemId);
      const itemLabel = item ? `${item.code} - ${item.name}` : exception.itemId ?? 'item';
      void createExceptionCase({
        type: PICK_EXCEPTION_TYPE[exception.reason] ?? 'TRANSFER_DISCREPANCY',
        title: `${String(exception.reason).replaceAll('_', ' ').toLowerCase()}: ${itemLabel}`,
        description: `Reported while picking transfer ${transfer.id}.`,
        itemId: exception.itemId ?? null, lotId: exception.lotId ?? null, locationId: transfer.sourceLocationId,
        quantity: Number(exception.quantity) || null, sourceDocument: transfer.id,
        reportedById: req.user!.id,
      });
    }

    const nextStatus: TransferRecord['status'] = req.body.finished ? 'READY_FOR_ADMIN' : (lines.length ? 'PARTIAL' : 'PICKING');
    const updated = updateTransferStatus(transfer.id, nextStatus);
    await persistTransferStatus(updated);
    void emitTransferUpdated(updated);
    return res.status(201).json({ message: `Pick slip ${slipId} saved.`, pickSlip: metadata, transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save pick slip.' });
  }
});

router.post('/transfers/:transferId/confirm', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can confirm transfer-out.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((entry) => entry.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  if (!['READY_FOR_ADMIN', 'PARTIAL'].includes(transfer.status)) return res.status(400).json({ message: `Transfer must be ready for admin review, not ${transfer.status}.` });
  const allocations = new Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }>();
  for (const slip of await savedPickSlips(transferId)) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`;
    const existing = allocations.get(key) ?? { itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: 0 };
    existing.quantity += Number(line.quantity ?? 0); allocations.set(key, existing);
  }
  if (!allocations.size) return res.status(400).json({ message: 'No accepted pick quantities are available to confirm.' });

  // Blueprint §16.2: "transfer > ₹1 lakh -> regional manager approval."
  // Gate before touching stock - a confirmed allocation's total value
  // decides whether a configured ApprovalRule blocks this attempt.
  const totalValue = (await Promise.all(
    [...allocations.values()].map((allocation) => estimateValueAtRisk(allocation.itemId, allocation.quantity)),
  )).reduce((sum, value) => sum + (value ?? 0), 0);
  const sourceLocation = await prisma.location.findUnique({ where: { id: transfer.sourceLocationId }, select: { branchId: true } }).catch(() => null);
  const gate = await checkApprovalGate({
    triggerType: 'TRANSFER_CONFIRM', entityType: 'Transfer', entityId: transfer.id,
    branchId: sourceLocation?.branchId ?? null, value: totalValue, requestedById: req.user!.id,
  });
  if (gate.blocked) return res.status(409).json({ message: gate.reason, approvalRequestId: gate.requestId, requiredApproverRole: gate.requiredApproverRole });

  try {
    await persistConfirmedPickAllocations(transfer.id, [...allocations.values()]);
    for (const allocation of allocations.values()) adjustStockLedger(allocation.itemId, allocation.lotId, allocation.locationId, -allocation.quantity);
    const updated = updateTransferStatus(transfer.id, 'CONFIRMED');
    // Stock has just physically left the source (decremented above); the
    // request-time reservation for this transfer's full original quantity
    // is no longer needed, picked-in-full or not.
    void releaseReservedStock(transfer.lines.map((line) => ({
      itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity,
    })));
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_CONFIRMED', entityType: 'Transfer', entityId: transfer.id, metadata: { allocations: [...allocations.values()] } }));
    void emitTransferUpdated(updated);
    return res.json({ message: 'Transfer confirmed and lot-level stock deducted.', transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to confirm transfer.' });
  }
});

router.get('/transfers/:transferId/export.xls', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Transfer export is restricted to admins and auditors.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((entry) => entry.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const itemMap = new Map(listItems().map((item) => [item.id, item]));
  const slips = await savedPickSlips(transfer.id);
  const picked = new Map<string, number>();
  const exceptionMap = new Map<string, string[]>();
  for (const slip of slips) {
    for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
      const key = `${line.itemId}|${line.lotId}`;
      picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
    for (const exception of ((slip.metadata?.exceptions as any[]) ?? [])) {
      const key = `${exception.itemId}|${exception.lotId}`;
      const label = `${exception.reason} (${exception.quantity})${exception.note ? ` - ${exception.note}` : ''}`;
      exceptionMap.set(key, [...(exceptionMap.get(key) ?? []), label]);
    }
  }
  const headers = ['Transfer ID', 'Status', 'Source', 'Destination', 'Item Code', 'Item Name', 'Unit', 'Requested Qty', 'Picked Qty', 'Lot', 'Expiry Date', 'Exceptions'];
  const rows = transfer.lines.map((line) => {
    const item = itemMap.get(line.itemId); const lot = item?.lots.find((entry) => entry.id === line.lotId); const key = `${line.itemId}|${line.lotId}`;
    return [transfer.id, transfer.status, transfer.sourceLocationId, transfer.destinationLocationId, item?.code, item?.name, item?.unit, line.quantity, picked.get(key) ?? 0, lot?.lotNo, lot?.expiryDate, (exceptionMap.get(key) ?? []).join('; ')];
  });
  const xmlRows = [headers, ...rows].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`).join('');
  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Transfer"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${transfer.id}-pick-report.xls"`);
  return res.send(workbook);
});

router.post('/stock-takes/preview-by-filters', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can prepare bulk stock take.' });
  const { locationId, category = 'all', subcategory = 'all', company = 'all', search = '' } = req.body;
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot prepare a stock take at the selected location.' });
  }
  const ledger = listStockLedgerForLocation(locationId);
  const quantityByItem = new Map<string, number>();
  for (const row of ledger) quantityByItem.set(row.itemId, (quantityByItem.get(row.itemId) ?? 0) + row.onHand);
  const all = listItems().filter((item) =>
    (category === 'all' || item.category === category)
    && (subcategory === 'all' || item.subcategory === subcategory)
    && (company === 'all' || item.company === company)
    && (!search || `${item.code} ${item.name}`.toLowerCase().includes(String(search).toLowerCase())),
  );
  const items = all.filter((item) => (quantityByItem.get(item.id) ?? 0) > 0).map((item) => ({ ...item, availableStock: quantityByItem.get(item.id) ?? 0 }));
  return res.json({ items, matchingCount: items.length, excludedZeroStock: all.length - items.length, filters: { categories: [...new Set(listItems().map((item) => item.category).filter(Boolean))], subcategories: [...new Set(listItems().map((item) => item.subcategory).filter(Boolean))], companies: [...new Set(listItems().map((item) => item.company).filter(Boolean))] } });
});

router.post('/stock-takes/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can import stock-take lists.' });
  if (!req.file || !req.body.locationId) return res.status(400).json({ message: 'File and locationId are required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), req.body.locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot import a stock take at the selected location.' });
  }
  try {
    const { rows } = await readTabularFile(req.file.buffer, req.file.originalname);
    const header = rows.findIndex((row) => row.some((cell) => ['itemcode', 'itemname'].includes(String(cell ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''))));
    if (header < 0) throw new Error('Item Code or Item Name header was not found.');
    const normalized = rows[header].map((cell) => String(cell ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const codeIndex = normalized.indexOf('itemcode'); const nameIndex = normalized.indexOf('itemname');
    const ledger = listStockLedgerForLocation(req.body.locationId); const seen = new Set<string>(); const items = []; const errors = [];
    for (let index = header + 1; index < rows.length; index += 1) {
      const code = codeIndex >= 0 ? String(rows[index][codeIndex] ?? '').trim() : '';
      const name = nameIndex >= 0 ? String(rows[index][nameIndex] ?? '').trim() : '';
      if (!code && !name) continue;
      const item = exactItemMatch(code || undefined, name || undefined);
      if (!item) { errors.push({ rowNumber: index + 1, message: code ? `Unknown Item Code: ${code}` : `Unknown or ambiguous Item Name: ${name}` }); continue; }
      if (!isOperationalItem(item)) { errors.push({ rowNumber: index + 1, message: inactiveImportMessage(item) }); continue; }
      if (seen.has(item.id)) continue; seen.add(item.id);
      const availableStock = ledger.filter((row) => row.itemId === item.id).reduce((sum, row) => sum + row.onHand, 0);
      if (availableStock <= 0) { errors.push({ rowNumber: index + 1, message: `${item.code} excluded because available stock is zero.` }); continue; }
      items.push({ ...item, availableStock });
    }
    return res.json({ preview: { items, validRows: items.length, invalidRows: errors.length, errors: errors.slice(0, 100) } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview stock-take import.' });
  }
});

router.post('/stock-takes/bulk-assign', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can assign stock takes.' });
  const { locationId, storeUserId, itemIds, countDate, dueDate, priority, instructions, filterSnapshot } = req.body;
  if (!locationId || !storeUserId || !Array.isArray(itemIds) || !itemIds.length) return res.status(400).json({ message: 'Location, Store User and selected items are required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign stock takes at the selected location.' });
  }
  const user = findUserById(storeUserId);
  if (!user || user.role !== 'STORE_USER' || !user.assignedLocationIds.includes(locationId)) return res.status(400).json({ message: 'Selected Store User is not assigned to this location.' });
  let parsedDueDate: string | undefined;
  let parsedPriority;
  try {
    parsedDueDate = parseOptionalDueDate(dueDate);
    parsedPriority = parseCountPriority(priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }
  const ledger = listStockLedgerForLocation(locationId); const deduped = [...new Set(itemIds)]; const excluded = []; const eligible = [];
  for (const itemId of deduped) {
    const available = ledger.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.onHand, 0);
    if (available <= 0 || inactiveItemMessage([itemId])) excluded.push(itemId); else eligible.push(itemId);
  }
  const assignments = eligible.map((itemId) => createCountAssignment({ id: `assign-${Math.random().toString(36).slice(2, 10)}`, locationId, itemId, assignedToId: storeUserId, assignedById: req.user!.id, countDate: countDate ? new Date(countDate).toISOString() : new Date().toISOString(), dueDate: parsedDueDate, priority: parsedPriority, instructions }));
  await Promise.all(assignments.map(persistCountAssignment));
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_TAKE_BULK_ASSIGNED', entityType: 'CountAssignment', entityId: assignments[0]?.id ?? 'none', metadata: { locationId, storeUserId, itemIds: eligible, excludedZeroStock: excluded, filterSnapshot } }));
  return res.status(201).json({ message: `Assigned ${assignments.length} in-stock items.`, assignments, excludedZeroStock: excluded });
});

// ---------------------------------------------------------------------------
// Transfer label printing and reprint audit
// ---------------------------------------------------------------------------

router.get('/transfers/reprint-audit/all', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can view reprint audit.' });
  }
  const auditLog = getReprintAudit();
  return res.json({ auditLog, totalEntries: auditLog.length });
});

router.get('/transfers/:transferId/reprint-audit', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can view reprint audit.' });
  }
  const transferId = firstParam(req.params.transferId);
  if (!listTransfers().some((record) => record.id === transferId)) {
    return res.status(404).json({ message: 'Transfer not found.' });
  }
  return res.json({ transferId, auditLog: getReprintAudit(transferId) });
});

router.get('/transfers/:transferId/label', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) {
    return res.status(404).json({ message: 'Transfer not found.' });
  }

  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }

  const html = generateThermalTransferLabel({
    transfer,
    itemNames: new Map(listItems().map((item) => [item.id, item.name])),
    locationNames: new Map(listLocations().map((location) => [location.id, location.name])),
    printedBy: req.user!.name ?? req.user!.email,
    printTime: new Date().toISOString(),
  });

  recordReprint({ transferId, printedBy: req.user!.id, printTime: new Date().toISOString() });
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'TRANSFER_LABEL_PRINTED',
    entityType: 'Transfer',
    entityId: transferId,
  }));

  return res.type('text/html').status(200).send(html);
});

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

router.post('/transfers/:transferId/receive', async (req: Request, res: Response) => {
  if (!canReceiveTransfer(req.user!.role)) return res.status(403).json({ message: 'Only operational admins and destination store users can receive transfers.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer not found.' });
  if (!canAccessLocation(accessContext(req.user!), transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Receiving is limited to the assigned destination.' });
  }

  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId || requestId.length > 191) return res.status(400).json({ message: 'A valid requestId is required for retry-safe receiving.' });

  // A retry (client timeout, offline outbox) of a receipt that already went
  // through answers with the recorded result - before the status gate, because
  // that receipt may itself have completed the transfer.
  const prior = await findReceiptByRequestId(requestId).catch(() => null);
  if (prior) {
    if (prior.transferId !== transferId) return res.status(409).json({ message: 'This requestId was already used for a different transfer.' });
    return res.json({
      success: true, duplicate: true, transfer,
      receipt: { requestId, receiptId: prior.receiptId, transferId, receivedAt: prior.receivedAt, receivedBy: prior.receivedBy, receivedQty: prior.receivedQty, damagedQty: prior.damagedQty, shortageQty: prior.shortageQty, excessQty: prior.excessQty, status: prior.status, notes: prior.notes ?? '' },
    });
  }
  if (!isReceivableStatus(transfer.status)) {
    return res.status(400).json({ message: 'Only dispatched, in-transit or partially received transfers can be received.' });
  }
  // The same request twice at once must not both post: the second waits for the client's next retry.
  if (!beginReceiptRequest(requestId)) return res.status(409).json({ message: 'This receipt is already being processed. Retry in a moment.' });
  try {
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : '';
  let receiptLines: ReceiptLineInput[];
  if (Array.isArray(req.body.lines)) {
    receiptLines = req.body.lines.map((line: any) => ({
      lineId: typeof line.lineId === 'string' ? line.lineId : undefined,
      itemId: String(line.itemId ?? ''),
      lotId: String(line.lotId ?? ''),
      receivedQty: Number(line.receivedQty),
      damagedQty: Number(line.damagedQty ?? 0),
      shortageQty: Number(line.shortageQty ?? 0),
      excessQty: Number(line.excessQty ?? 0),
    }));
  } else if (transfer.lines.length === 1) {
    receiptLines = [{
      itemId: transfer.lines[0].itemId,
      lotId: transfer.lines[0].lotId,
      receivedQty: Number(req.body.receivedQty),
      damagedQty: Number(req.body.damagedQty ?? 0),
      shortageQty: Number(req.body.shortageQty ?? 0),
      excessQty: Number(req.body.excessQty ?? 0),
    }];
  } else {
    return res.status(400).json({ message: 'Multi-lot transfers require a separate receipt line for every item and lot.' });
  }

  const damagedLines = receiptLines.filter((line) => line.damagedQty > 0);
  if (damagedLines.length > 0) {
    const destinationLocation = await prisma.location.findUnique({ where: { id: transfer.destinationLocationId }, select: { branchId: true } }).catch(() => null);
    for (const line of damagedLines) {
      const gate = await requireEvidenceForDamage({
        transferId: transfer.id, triggerType: 'TRANSFER_RECEIVE_DAMAGE', itemId: line.itemId,
        branchId: destinationLocation?.branchId ?? null, damagedQty: line.damagedQty,
      });
      if (gate.blocked) return res.status(400).json({ message: gate.reason });
    }
  }

  {
    const { listMemoryQcTemplates, listMemoryQcInspections } = await import('../lib/qc-inspection.js');
    const templates = databaseEnabled
      ? await prisma.qcChecklistTemplate.findMany({ where: { active: true } }).catch(() => listMemoryQcTemplates().filter((row) => row.active))
      : listMemoryQcTemplates().filter((row) => row.active);
    const inspections = databaseEnabled
      ? await prisma.qcInspection.findMany({ where: { sourceDocument: transferId } }).catch(() => listMemoryQcInspections())
      : listMemoryQcInspections().filter((row) => row.sourceDocument === transferId);
    const bodyInspections = Array.isArray(req.body.qcInspections) ? req.body.qcInspections : [];
    const itemsById = new Map(listItems().map((item) => [item.id, item]));
    const qc = assertReceiptQcComplete(
      receiptLines.map((line) => ({
        lineId: line.lineId,
        itemId: line.itemId,
        itemCategory: itemsById.get(line.itemId)?.category ?? null,
        receivedQty: line.receivedQty,
        hasInspection: inspections.some((inspection) => inspection.itemId === line.itemId && (inspection.sourceLineId === line.lineId || !line.lineId))
          || bodyInspections.some((inspection: { itemId?: string; lineId?: string }) => inspection.itemId === line.itemId || (line.lineId && inspection.lineId === line.lineId)),
      })),
      templates,
    );
    if (qc.ok === false) return res.status(400).json({ message: qc.message, itemId: qc.itemId, lineId: qc.lineId, code: 'QC_REQUIRED' });
    // Blueprint v4 §25: an inspection that failed sends the goods to quarantine
    // (the QC_FAIL exception case already exists), never to sellable stock.
    const recorded: InspectionLike[] = [
      ...(inspections as unknown as InspectionLike[]),
      ...bodyInspections.map((entry: { itemId?: string; lineId?: string; results?: Record<string, QcCheckResult> }) => ({ itemId: entry.itemId ?? null, sourceLineId: entry.lineId ?? null, results: entry.results ?? null })),
    ];
    receiptLines = quarantineFailedLines(receiptLines, (line) => verdictForLine(recorded, { itemId: line.itemId, lineId: line.lineId })).lines;
  }

  try {
    const persisted = await persistTransferReceipt({
      requestId, transferId, destinationLocationId: transfer.destinationLocationId,
      receivedById: req.user!.id, notes, lines: receiptLines,
    });

    let status: TransferRecord['status'];
    let summary: { receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number; complete?: boolean; hasDiscrepancy?: boolean };
    if (persisted) {
      status = persisted.status;
      summary = persisted;
      // Mirror committed database state only after the transaction succeeds.
      updateTransferStatus(transfer.id, status);
      updateTransferReceiptProgress(transfer.id, persisted.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
        receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty),
      })));
      if (!persisted.duplicate) for (const line of receiptLines) {
        if (line.receivedQty > 0) adjustStockLedger(line.itemId, line.lotId, transfer.destinationLocationId, line.receivedQty);
        if (line.damagedQty > 0) adjustQuarantineLedger(line.itemId, line.lotId, transfer.destinationLocationId, line.damagedQty);
        if (Number(line.excessQty ?? 0) > 0) adjustQuarantineLedger(line.itemId, line.lotId, transfer.destinationLocationId, Number(line.excessQty));
      }
    } else {
      summary = validateReceiptLines(transfer.lines, receiptLines);
      status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
      updateTransferStatus(transfer.id, status);
      const nextLines = transfer.lines.map((line) => {
        const input = receiptLines.find((candidate) => candidate.itemId === line.itemId && candidate.lotId === line.lotId);
        return {
          ...line,
          receivedQty: Number(line.receivedQty ?? 0) + Number(input?.receivedQty ?? 0),
          damagedQty: Number(line.damagedQty ?? 0) + Number(input?.damagedQty ?? 0),
          shortageQty: Number(line.shortageQty ?? 0) + Number(input?.shortageQty ?? 0),
          excessQty: Number(line.excessQty ?? 0) + Number(input?.excessQty ?? 0),
        };
      });
      updateTransferReceiptProgress(transfer.id, nextLines);
      for (const input of receiptLines) {
        if (input.receivedQty > 0) adjustStockLedger(input.itemId, input.lotId, transfer.destinationLocationId, input.receivedQty);
        if (input.damagedQty > 0) adjustQuarantineLedger(input.itemId, input.lotId, transfer.destinationLocationId, input.damagedQty);
        if (Number(input.excessQty ?? 0) > 0) adjustQuarantineLedger(input.itemId, input.lotId, transfer.destinationLocationId, Number(input.excessQty));
      }
    }

    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role,
      action: status === 'RECEIVED' ? 'TRANSFER_RECEIVED' : 'TRANSFER_PARTIALLY_RECEIVED',
      entityType: 'Transfer', entityId: transferId,
      metadata: { requestId, receivedQty: summary.receivedQty, damagedQty: summary.damagedQty, shortageQty: summary.shortageQty, excessQty: summary.excessQty, lines: receiptLines, duplicate: persisted?.duplicate ?? false },
    }));

    // Blueprint Module H: a damaged or short receiving line is a discrepancy
    // case, not an invisible balance correction. Open an owned Exception
    // Inbox case per affected line so QC/quarantine disposition is tracked
    // to closure. Best-effort only - never fail a successful receipt.
    if (!persisted?.duplicate) {
      for (const line of receiptLines) {
        const item = listItems().find((candidate) => candidate.id === line.itemId);
        const itemLabel = item ? `${item.code} - ${item.name}` : line.itemId;
        // Blueprint Module B / section 8.3: good stock that just landed on
        // hand still needs to be physically put away into a bin. Open a
        // putaway task with a suggested bin rather than leaving newly
        // received stock sitting at the dock indefinitely.
        if (line.receivedQty > 0) {
          void createPutawayTask({
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.receivedQty, sourceDocument: transferId, sourceLineId: line.lineId,
          });
          void persistBinStockDelta({
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            binId: STAGING_BIN_ID, qtyDelta: line.receivedQty,
          });
        }
        if (line.damagedQty > 0) {
          void createExceptionCase({
            type: 'DAMAGE',
            title: `Damaged receipt: ${itemLabel}`,
            description: `${line.damagedQty} units received damaged against transfer ${transferId}.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.damagedQty, sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
          });
        }
        if (line.shortageQty > 0) {
          void createExceptionCase({
            type: 'SHORT_RECEIPT',
            title: `Short receipt: ${itemLabel}`,
            description: `${line.shortageQty} units short against transfer ${transferId}.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.shortageQty, sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
          });
        }
        if (Number(line.excessQty ?? 0) > 0) {
          // Blueprint: "excess receipt... never silently absorb." The
          // quantity is already held in quarantine; this case requires an
          // explicit accept (posts to onHand) or reject (returned/destroyed)
          // decision before it can become sellable.
          void createExceptionCase({
            type: 'EXCESS_RECEIPT',
            title: `Excess receipt: ${itemLabel}`,
            description: `${line.excessQty} units received beyond the requested quantity on transfer ${transferId}. Accept or reject.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: Number(line.excessQty), sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
          });
        }
      }
    }

    const nextTransfer = listTransfers().find((record) => record.id === transferId);
    if (nextTransfer) void emitTransferUpdated(nextTransfer);
    rememberReceipt({
      requestId, transferId, receiptId: persisted?.receiptId, status: status as 'RECEIVED' | 'PARTIAL_RECEIVED', receivedBy: req.user!.id,
      receivedAt: new Date().toISOString(), receivedQty: summary.receivedQty, damagedQty: summary.damagedQty, shortageQty: summary.shortageQty, excessQty: summary.excessQty, notes,
    });
    return res.json({
      success: true, duplicate: persisted?.duplicate ?? false,
      transfer: nextTransfer,
      receipt: { requestId, receiptId: persisted?.receiptId, transferId, receivedAt: new Date().toISOString(), receivedBy: req.user!.id, ...summary, status, notes },
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to process receipt.' });
  }
  } finally {
    endReceiptRequest(requestId);
  }
});

router.post('/items/:itemId/photos', upload.single('photo'), async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  if (!listItems().some((candidate) => candidate.id === itemId)) {
    return res.status(404).json({ message: 'Item was not found.' });
  }
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'STORE_USER' && req.user!.role !== 'WAREHOUSE_PICKER') {
    return res.status(403).json({ message: 'Item photo upload access denied.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Photo file is required.' });
  try { evidenceMime(req.file.buffer); }
  catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid photo.' }); }
  try {
    const photo = await saveItemPhoto(itemId, req.user!.id, req.file.originalname, req.file.buffer, req.body?.primary === 'true');
    return res.status(201).json({ success: true, photo });
  } catch {
    return res.status(503).json({ message: 'Photo was not saved. Check database storage and retry.' });
  }
});

router.get('/items/:itemId/photos', async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  if (!listItems().some((candidate) => candidate.id === itemId)) {
    return res.status(404).json({ message: 'Item was not found.' });
  }
  try { return res.json({ photos: await listItemPhotos(itemId) }); }
  catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

router.get('/items/:itemId/photos/:photoId', async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  try {
    const photo = await readItemPhoto(itemId, firstParam(req.params.photoId));
    if (!photo) return res.status(404).json({ message: 'Photo was not found.' });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.type(photo.mimeType).send(Buffer.from(photo.contents));
  } catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

router.delete('/items/:itemId/photos/:photoId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  try {
    await deleteItemPhoto(itemId, firstParam(req.params.photoId));
    return res.json({ success: true });
  } catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

router.post('/transfers/:transferId/evidence', upload.single('evidence'), async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'STORE_USER', 'WAREHOUSE_PICKER'].includes(context.role)
      || (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId))) {
    return res.status(403).json({ message: 'Transfer evidence upload access denied.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Evidence file is required.' });
  try { evidenceMime(req.file.buffer); }
  catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid photo.' }); }
  try {
    const evidence = await saveTransferEvidence(transferId, req.user!.id, req.file.originalname, req.file.buffer);
    return res.status(201).json({ success: true, evidence });
  } catch {
    return res.status(503).json({ message: 'Photo was not saved. Check database storage and retry.' });
  }
});

router.get('/transfers/:transferId/evidence', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }
  try { return res.json({ evidence: await listTransferEvidence(transferId) }); }
  catch { return res.status(503).json({ message: 'Evidence storage unavailable.' }); }
});

router.get('/transfers/:transferId/evidence/:evidenceId', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }
  try {
    const evidence = await readTransferEvidence(transferId, firstParam(req.params.evidenceId));
    if (!evidence) return res.status(404).json({ message: 'Photo was not found.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment');
    return res.type(evidence.mimeType).send(Buffer.from(evidence.contents));
  } catch { return res.status(503).json({ message: 'Evidence storage unavailable.' }); }
});

// ---------------------------------------------------------------------------
// Picker tasks
// ---------------------------------------------------------------------------

router.post('/picker-tasks', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can assign picker tasks.' });
  }
  try {
    const task = buildPickerTask({
      transferId: req.body.transferId,
      locationId: req.body.locationId,
      lines: req.body.lines,
      assignedPickerId: req.body.assignedPickerId ?? req.user!.id,
      role: 'WAREHOUSE_PICKER',
    });
    return res.status(201).json({ success: true, task });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to build picker task.' });
  }
});

router.post('/picker-tasks/complete', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transfer = listTransfers().find((record) => record.id === req.body.transferId);
  if (context.role !== 'WAREHOUSE_PICKER' || !transfer || !canAccessLocation(context, transfer.sourceLocationId)) {
    return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  }

  try {
    const result = completePickerTask({
      transferId: req.body.transferId,
      pickerId: req.user!.id,
      role: 'WAREHOUSE_PICKER',
      pickedQty: Number(req.body.pickedQty),
    });

    const updated = updateTransferStatus(transfer.id, 'PICKED');
    await persistTransferStatus(updated);
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'TRANSFER_PICKED',
      entityType: 'Transfer',
      entityId: updated.id,
    }));
    void emitTransferUpdated(updated);
    return res.json({ success: true, result, transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to complete picker task.' });
  }
});

// ---------------------------------------------------------------------------
// Expiry dashboard and reports
// ---------------------------------------------------------------------------

router.get('/expiry-dashboard', (req: Request, res: Response) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
  const context = accessContext(req.user!);
  if ((!locationId || locationId === 'all') && !['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(context.role)) {
    return res.status(403).json({ message: 'All-location expiry data requires Admin or Auditor access.' });
  }
  if (locationId && locationId !== 'all' && !canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'Expiry location access denied.' });
  }
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';

  const dashboard = buildExpiryDashboard(listItems(), listStockLedgerForLocation(locationId ?? 'all'));

  if (filter === 'expired') dashboard.allExpiringItems = dashboard.expiredItems;
  else if (filter === 'this-month') dashboard.allExpiringItems = dashboard.expiringThisMonth;
  else if (filter === 'next-month') dashboard.allExpiringItems = dashboard.expiringNextMonth;

  if (locationId && locationId !== 'all') {
    const atLocation = <T extends { locationId: string }>(rows: T[]) => rows.filter((row) => row.locationId === locationId);
    dashboard.expiredItems = atLocation(dashboard.expiredItems);
    dashboard.expiringThisMonth = atLocation(dashboard.expiringThisMonth);
    dashboard.expiringNextMonth = atLocation(dashboard.expiringNextMonth);
    dashboard.allExpiringItems = atLocation(dashboard.allExpiringItems);
  }

  return res.json({ dashboard });
});

router.get('/reports/variance/:locationId', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Variance reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }

  const itemMap = new Map(listItems().map((item) => [item.id, item]));

  // The ledger stores only on-hand, so book-vs-physical comes from the counts,
  // each of which captured the book quantity at the moment it was submitted.
  const latestCountPerLot = new Map<string, CountRecord>();
  for (const count of listCounts()) {
    if (count.locationId !== locationId) continue;
    const key = `${count.itemId}:${count.lotId}`;
    const existing = latestCountPerLot.get(key);
    if (!existing || count.createdAt > existing.createdAt) {
      latestCountPerLot.set(key, count);
    }
  }

  const details = [...latestCountPerLot.values()].map((count) => {
    const variance = count.physicalQuantity - count.bookQty;
    return {
      itemId: count.itemId,
      itemName: itemMap.get(count.itemId)?.name ?? count.itemId,
      bookQuantity: count.bookQty,
      physicalQuantity: count.physicalQuantity,
      variance,
      variancePercent: count.bookQty > 0 ? Number(((variance / count.bookQty) * 100).toFixed(2)) : 0,
      status: variance === 0 ? 'MATCH' : variance > 0 ? 'OVERAGE' : 'SHORTAGE',
    };
  });

  const totalBookQuantity = details.reduce((sum, row) => sum + row.bookQuantity, 0);
  const totalVariance = details.reduce((sum, row) => sum + row.variance, 0);

  return res.json({
    report: {
      locationId,
      totalItems: details.length,
      matchingItems: details.filter((row) => row.status === 'MATCH').length,
      overageItems: details.filter((row) => row.status === 'OVERAGE').length,
      shortageItems: details.filter((row) => row.status === 'SHORTAGE').length,
      totalBookQuantity,
      totalPhysicalQuantity: details.reduce((sum, row) => sum + row.physicalQuantity, 0),
      totalVariance,
      overallVariancePercent: totalBookQuantity > 0 ? Number(((totalVariance / totalBookQuantity) * 100).toFixed(2)) : 0,
      details,
    },
  });
});

router.get('/reports/:locationId', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }
  return res.json({
    report: buildReportSummary({ locationId, counts: listCounts(), transfers: listTransfers() }),
  });
});

export default router;
