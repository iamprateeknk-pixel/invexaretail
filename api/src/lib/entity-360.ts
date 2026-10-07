import { prisma } from './db.js';
import { listAuditEvents } from './audit.js';
import { listUsersByCompany } from './enterprise-repository.js';

// Release checklist (Web UX): "Item/Lot/Location/Transfer/Count/User 360 patterns and activity timelines".
// One read model for investigations: what the thing is, what it is connected to, and what happened to it,
// in one answer - so nobody has to search three modules by hand. Strictly read-only and company scoped:
// every lookup filters by the caller's company, and a foreign id is indistinguishable from a missing one
// (null -> 404). Item 360 is the existing stock-detail page (lib/stock-detail-service.ts).

export const ENTITY_360_TYPES = ['lot', 'location', 'transfer', 'count', 'user'] as const;
export type Entity360Type = (typeof ENTITY_360_TYPES)[number];

export type Entity360 = {
  type: Entity360Type;
  id: string;
  title: string;
  subtitle: string;
  summary: Array<{ label: string; value: string }>;
  related: Array<{ kind: string; id: string; label: string; detail?: string }>;
  timeline: Array<{ at: string; kind: string; title: string; detail?: string }>;
};

export type Entity360Caller = { companyId: string; role: string };

const OPEN_EXCEPTION = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] as never[];
const TERMINAL_TRANSFER = ['RECEIVED', 'PARTIAL_RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED'] as never[];
const MAX_TIMELINE = 60;
const USER_VIEW_ROLES = ['ADMIN', 'ADMIN_USER', 'AUDITOR', 'BRANCH_MANAGER'];

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : '');
const num = (value: unknown) => String(Math.round(Number(value ?? 0) * 1000) / 1000);

function sortTimeline(entries: Entity360['timeline']): Entity360['timeline'] {
  return entries.filter((entry) => entry.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_TIMELINE);
}

/** Audit events about this entity, but only ones written by people of the caller's own company (or the system). */
function auditFor(companyId: string, match: (event: ReturnType<typeof listAuditEvents>[number]) => boolean): Entity360['timeline'] {
  const own = new Set(listUsersByCompany(companyId).map((user) => user.id));
  return listAuditEvents()
    .filter((event) => match(event) && (own.has(event.actorId) || ['system', 'connector', 'SYSTEM'].includes(event.actorId)))
    .map((event) => ({ at: event.createdAt ?? '', kind: 'audit', title: String(event.action), detail: event.actorRole ? `by ${event.actorRole}` : undefined }));
}

async function lot360(caller: Entity360Caller, id: string): Promise<Entity360 | null> {
  const lot = await prisma.lot.findFirst({ where: { id, item: { companyId: caller.companyId } }, include: { item: true } });
  if (!lot) return null;
  const [ledger, movements, exceptions, lines] = await Promise.all([
    prisma.stockLedger.findMany({ where: { lotId: id, companyId: caller.companyId }, include: { location: { select: { id: true, name: true } } } }),
    prisma.stockMovement.findMany({ where: { lotId: id, companyId: caller.companyId }, orderBy: { timestamp: 'desc' }, take: MAX_TIMELINE, include: { location: { select: { name: true } } } }),
    prisma.exceptionCase.findMany({ where: { lotId: id, companyId: caller.companyId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.transferLine.findMany({ where: { lotId: id, transfer: { companyId: caller.companyId } }, include: { transfer: { select: { id: true, status: true, createdAt: true } } }, take: 20, orderBy: { createdAt: 'desc' } }),
  ]);
  const sum = (field: 'onHand' | 'reserved' | 'quarantine') => ledger.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  return {
    type: 'lot', id, title: `Lot ${lot.lotNo}`, subtitle: `${lot.item.code} - ${lot.item.name}`,
    summary: [
      { label: 'Status', value: String(lot.status) }, { label: 'Expiry', value: lot.expiryDate ? iso(lot.expiryDate).slice(0, 10) : 'none' },
      { label: 'On hand', value: num(sum('onHand')) }, { label: 'Reserved', value: num(sum('reserved')) }, { label: 'Quarantine', value: num(sum('quarantine')) },
    ],
    related: [
      { kind: 'item', id: lot.itemId, label: `${lot.item.code} - ${lot.item.name}` },
      ...ledger.map((row) => ({ kind: 'location', id: row.locationId, label: row.location.name, detail: `${num(row.onHand)} on hand` })),
      ...exceptions.map((row) => ({ kind: 'exception', id: row.id, label: row.title, detail: String(row.status) })),
      ...lines.map((row) => ({ kind: 'transfer', id: row.transferId, label: `Transfer ${row.transferId}`, detail: String(row.transfer.status) })),
    ],
    timeline: sortTimeline([
      ...movements.map((row) => ({ at: iso(row.timestamp), kind: 'movement', title: `${row.movementType} ${Number(row.qtyDelta) > 0 ? '+' : ''}${num(row.qtyDelta)}`, detail: row.location?.name })),
      ...exceptions.map((row) => ({ at: iso(row.createdAt), kind: 'exception', title: row.title, detail: String(row.status) })),
      ...auditFor(caller.companyId, (event) => event.entityId === id),
    ]),
  };
}

async function location360(caller: Entity360Caller, id: string): Promise<Entity360 | null> {
  const location = await prisma.location.findFirst({ where: { id, companyId: caller.companyId } });
  if (!location) return null;
  const [totals, rows, transfers, exceptions, movements] = await Promise.all([
    prisma.stockLedger.aggregate({ where: { locationId: id, companyId: caller.companyId }, _sum: { onHand: true, reserved: true, quarantine: true } }),
    prisma.stockLedger.count({ where: { locationId: id, companyId: caller.companyId, onHand: { gt: 0 } } }),
    prisma.transfer.findMany({ where: { companyId: caller.companyId, status: { notIn: TERMINAL_TRANSFER }, OR: [{ sourceLocationId: id }, { destinationLocationId: id }] }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.exceptionCase.findMany({ where: { locationId: id, companyId: caller.companyId, status: { in: OPEN_EXCEPTION } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.stockMovement.findMany({ where: { locationId: id, companyId: caller.companyId }, orderBy: { timestamp: 'desc' }, take: MAX_TIMELINE, include: { item: { select: { code: true } } } }),
  ]);
  return {
    type: 'location', id, title: location.name, subtitle: `${location.type} ${location.code}`,
    summary: [
      { label: 'Stocked lines', value: String(rows) }, { label: 'On hand', value: num(totals._sum.onHand) },
      { label: 'Reserved', value: num(totals._sum.reserved) }, { label: 'Quarantine', value: num(totals._sum.quarantine) },
      { label: 'Open transfers', value: String(transfers.length) }, { label: 'Open exceptions', value: String(exceptions.length) },
    ],
    related: [
      ...transfers.map((row) => ({ kind: 'transfer', id: row.id, label: `Transfer ${row.id}`, detail: String(row.status) })),
      ...exceptions.map((row) => ({ kind: 'exception', id: row.id, label: row.title, detail: String(row.priority) })),
    ],
    timeline: sortTimeline([
      ...movements.map((row) => ({ at: iso(row.timestamp), kind: 'movement', title: `${row.movementType} ${Number(row.qtyDelta) > 0 ? '+' : ''}${num(row.qtyDelta)}`, detail: row.item?.code })),
      ...auditFor(caller.companyId, (event) => event.entityId === id),
    ]),
  };
}

async function transfer360(caller: Entity360Caller, id: string): Promise<Entity360 | null> {
  const transfer = await prisma.transfer.findFirst({
    where: { id, companyId: caller.companyId },
    include: { lines: { include: { item: { select: { code: true, name: true } }, lot: { select: { lotNo: true } } } }, requestedBy: { select: { id: true, name: true } } },
  });
  if (!transfer) return null;
  const [exceptions, places] = await Promise.all([
    prisma.exceptionCase.findMany({ where: { sourceDocument: id, companyId: caller.companyId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.location.findMany({ where: { id: { in: [transfer.sourceLocationId, transfer.destinationLocationId] }, companyId: caller.companyId }, select: { id: true, name: true } }),
  ]);
  const placeName = (locationId: string) => places.find((place) => place.id === locationId)?.name ?? locationId;
  const total = (field: 'requestedQty' | 'pickedQty' | 'receivedQty' | 'damagedQty' | 'shortageQty') => transfer.lines.reduce((sum, line) => sum + Number(line[field] ?? 0), 0);
  return {
    type: 'transfer', id, title: `Transfer ${id}`, subtitle: `${String(transfer.status).replaceAll('_', ' ')} - requested by ${transfer.requestedBy.name}`,
    summary: [
      { label: 'Status', value: String(transfer.status) }, { label: 'Requested', value: num(total('requestedQty')) }, { label: 'Picked', value: num(total('pickedQty')) },
      { label: 'Received', value: num(total('receivedQty')) }, { label: 'Damaged', value: num(total('damagedQty')) }, { label: 'Short', value: num(total('shortageQty')) },
    ],
    related: [
      { kind: 'location', id: transfer.sourceLocationId, label: placeName(transfer.sourceLocationId), detail: 'Source' },
      { kind: 'location', id: transfer.destinationLocationId, label: placeName(transfer.destinationLocationId), detail: 'Destination' },
      ...transfer.lines.map((line) => ({ kind: 'lot', id: line.lotId, label: `${line.item.code} - ${line.item.name}`, detail: `lot ${line.lot.lotNo}, ${num(line.requestedQty)} requested` })),
      ...exceptions.map((row) => ({ kind: 'exception', id: row.id, label: row.title, detail: String(row.status) })),
    ],
    timeline: sortTimeline([
      { at: iso(transfer.createdAt), kind: 'created', title: 'Transfer requested', detail: transfer.requestedBy.name },
      { at: iso(transfer.updatedAt), kind: 'status', title: `Status: ${String(transfer.status)}` },
      ...exceptions.map((row) => ({ at: iso(row.createdAt), kind: 'exception', title: row.title, detail: String(row.status) })),
      ...auditFor(caller.companyId, (event) => event.entityId === id),
    ]),
  };
}

async function count360(caller: Entity360Caller, id: string): Promise<Entity360 | null> {
  const count = await prisma.stockCount.findFirst({
    where: { id, companyId: caller.companyId },
    include: { item: { select: { code: true, name: true } }, lot: { select: { lotNo: true } }, location: { select: { id: true, name: true } }, submittedBy: { select: { name: true } } },
  });
  if (!count) return null;
  const variance = Number(count.physicalQty) - Number(count.bookQty);
  return {
    type: 'count', id, title: `Count of ${count.item.code}`, subtitle: `${count.item.name} at ${count.location.name}`,
    summary: [
      { label: 'Review', value: String(count.reviewStatus) }, { label: 'Counted', value: num(count.physicalQty) }, { label: 'Book', value: num(count.bookQty) },
      { label: 'Variance', value: `${variance > 0 ? '+' : ''}${num(variance)}` }, { label: 'Reason', value: count.reasonCode ?? 'none' }, { label: 'Late movement', value: count.reconciliationRequired ? 'yes - reconcile' : 'no' },
    ],
    related: [
      { kind: 'lot', id: count.lotId, label: `Lot ${count.lot.lotNo}` },
      { kind: 'location', id: count.locationId, label: count.location.name },
      ...(count.parentCountId ? [{ kind: 'count', id: count.parentCountId, label: 'Original count (this is a recount)' }] : []),
    ],
    timeline: sortTimeline([
      { at: iso(count.countDate), kind: 'count', title: 'Count submitted', detail: count.submittedBy.name },
      ...(count.approvedAt ? [{ at: iso(count.approvedAt), kind: 'review', title: `Review: ${String(count.reviewStatus)}`, detail: count.reviewReason ?? undefined }] : []),
      ...auditFor(caller.companyId, (event) => event.entityId === id),
    ]),
  };
}

async function user360(caller: Entity360Caller, id: string): Promise<Entity360 | null> {
  if (!USER_VIEW_ROLES.includes(caller.role)) return null;
  const user = await prisma.user.findFirst({ where: { id, companyId: caller.companyId }, select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true } });
  if (!user) return null;
  const [owned, assignments] = await Promise.all([
    prisma.exceptionCase.findMany({ where: { ownerId: id, companyId: caller.companyId, status: { in: OPEN_EXCEPTION } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.countAssignment.findMany({ where: { assignedToId: id, status: 'ASSIGNED', location: { companyId: caller.companyId } }, take: 20, include: { item: { select: { code: true } }, location: { select: { name: true } } } }),
  ]);
  return {
    type: 'user', id, title: user.name, subtitle: `${user.role} - ${user.email}`,
    summary: [
      { label: 'Status', value: String(user.status) }, { label: 'Role', value: String(user.role) },
      { label: 'Last sign-in', value: user.lastLoginAt ? iso(user.lastLoginAt) : 'never' },
      { label: 'Open exceptions owned', value: String(owned.length) }, { label: 'Open count tasks', value: String(assignments.length) },
    ],
    related: [
      ...owned.map((row) => ({ kind: 'exception', id: row.id, label: row.title, detail: String(row.priority) })),
      ...assignments.map((row) => ({ kind: 'count-task', id: row.id, label: `${row.item.code} at ${row.location.name}` })),
    ],
    timeline: sortTimeline(auditFor(caller.companyId, (event) => event.actorId === id)),
  };
}

const LOADERS: Record<Entity360Type, (caller: Entity360Caller, id: string) => Promise<Entity360 | null>> = {
  lot: lot360, location: location360, transfer: transfer360, count: count360, user: user360,
};

export function isEntity360Type(value: string): value is Entity360Type {
  return (ENTITY_360_TYPES as readonly string[]).includes(value);
}

export async function getEntity360(caller: Entity360Caller, type: Entity360Type, id: string): Promise<Entity360 | null> {
  return LOADERS[type](caller, id);
}
