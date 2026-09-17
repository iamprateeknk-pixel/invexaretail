// Unmounted Phase 1 Prisma blueprint. Live expiry, lot, and import routes
// are served from operations-extension and core. This file is kept as a
// sketch for branches, stock movements, work assignments, import center,
// and lot allocation — it is not mounted from index.ts.
//
// Original coverage: branch management (section 11), the database-backed
// stock accounting engine (section 6), the universal work assignment
// engine (section 14), expiry alerts (section 18), Import Center controls
// (section 12), and the lot allocation engine (section 17).
import { type Request, type Response, Router } from 'express';

import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import {
  assertValidBatchTransition,
  InvalidBatchTransitionError,
  buildImportErrorReport,
  errorReportToCsv,
  type ImportBatchStatus,
} from '../lib/import-center.js';
import {
  allocateLots,
  ManualAllocationRequiresReasonError,
  LotNotAllocatableError,
  ManualAllocationExceedsAvailableError,
  type AllocationStrategy,
  type FefoLot,
} from '../lib/warehouse-workflow.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

const ADMIN_ROLES = ['ADMIN', 'ADMIN_USER'];

function requireAdmin(req: Request, res: Response): boolean {
  if (!ADMIN_ROLES.includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

function canAccessLocation(req: Request, locationId: string): boolean {
  return ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role) || (req.user!.locationIds ?? []).includes(locationId);
}

// ============================================================================
// BRANCH MANAGEMENT (section 11)
// ============================================================================

router.get('/branches', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' }, include: { locations: true } });
  return res.json({ branches });
});

router.post('/branches', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!code || !name) return res.status(400).json({ message: 'Branch code and name are required.' });

  const existing = await prisma.branch.findUnique({ where: { code } });
  if (existing) return res.status(409).json({ message: `Branch code ${code} already exists.` });

  const branch = await prisma.branch.create({
    data: {
      code,
      name,
      type: req.body.type || 'WAREHOUSE',
      address: req.body.address || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      managerId: req.body.managerId || null,
      workingHours: req.body.workingHours || null,
    },
  });
  return res.status(201).json({ branch });
});

router.patch('/branches/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const branch = await prisma.branch.findUnique({ where: { id: req.params.id } });
  if (!branch) return res.status(404).json({ message: 'Branch not found.' });

  // Branch code is immutable after first transaction (blueprint 11); display
  // name and operational fields remain editable.
  const { code: _ignoredCode, ...rest } = req.body;
  const updated = await prisma.branch.update({
    where: { id: branch.id },
    data: {
      name: rest.name ?? undefined,
      address: rest.address ?? undefined,
      phone: rest.phone ?? undefined,
      email: rest.email ?? undefined,
      managerId: rest.managerId ?? undefined,
      workingHours: rest.workingHours ?? undefined,
      status: rest.status ?? undefined,
    },
  });
  return res.json({ branch: updated });
});

router.post('/branches/:id/archive', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const branch = await prisma.branch.findUnique({ where: { id: req.params.id }, include: { locations: true } });
  if (!branch) return res.status(404).json({ message: 'Branch not found.' });

  const locationIds = branch.locations.map((l) => l.id);
  const [activeStock, openTransfers, pendingWork] = await Promise.all([
    locationIds.length
      ? prisma.stockBalance.count({ where: { locationId: { in: locationIds }, onHand: { gt: 0 } } })
      : Promise.resolve(0),
    locationIds.length
      ? prisma.transfer.count({
          where: {
            OR: [{ sourceLocationId: { in: locationIds } }, { destinationLocationId: { in: locationIds } }],
            status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED'] },
          },
        })
      : Promise.resolve(0),
    locationIds.length
      ? prisma.workAssignment.count({ where: { locationId: { in: locationIds }, status: { notIn: ['CLOSED', 'CANCELLED'] } } })
      : Promise.resolve(0),
  ]);

  if (activeStock > 0 || openTransfers > 0 || pendingWork > 0) {
    return res.status(409).json({
      message: 'Cannot archive: branch has active stock, open transfers, or pending tasks.',
      blockers: { activeStock, openTransfers, pendingWork },
    });
  }

  const archived = await prisma.branch.update({ where: { id: branch.id }, data: { status: 'ARCHIVED' } });
  return res.json({ branch: archived });
});

// ============================================================================
// STOCK ACCOUNTING ENGINE (section 6) - database-backed movement posting
// ============================================================================

const NEGATIVE_STOCK_POLICIES = ['BLOCK', 'WARN', 'ALLOW'] as const;
type NegativeStockPolicy = (typeof NEGATIVE_STOCK_POLICIES)[number];

async function resolveNegativeStockPolicy(locationId: string): Promise<NegativeStockPolicy> {
  const config = await prisma.workflowConfiguration.findFirst({
    where: { type: 'STOCK_POSTING', scopeId: locationId },
  });
  const value = config?.negativeStockRule;
  return (NEGATIVE_STOCK_POLICIES as readonly string[]).includes(value ?? '')
    ? (value as NegativeStockPolicy)
    : 'BLOCK';
}

/**
 * Posts one stock movement with optimistic-locking retries against
 * StockBalance.version, so two concurrent posts to the same item/lot/
 * location cannot silently double-deduct each other's write.
 */
async function postStockMovement(input: {
  itemId: string;
  lotId: string | null;
  locationId: string;
  movementType: string;
  qtyDelta: number;
  actor: string;
  sourceDocument?: string;
  sourceLineId?: string;
  correlationId?: string;
  reason?: string;
}): Promise<{ movement: Awaited<ReturnType<typeof prisma.stockMovement.create>>; balance: { onHand: number } }> {
  const policy = await resolveNegativeStockPolicy(input.locationId);
  const correlationId = input.correlationId ?? `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await prisma.stockBalance.findUnique({
      where: { itemId_lotId_locationId: { itemId: input.itemId, lotId: input.lotId ?? '', locationId: input.locationId } },
    }).catch(() => null);

    const beforeBalance = current?.onHand ?? 0;
    const afterBalance = beforeBalance + input.qtyDelta;

    if (afterBalance < 0) {
      if (policy === 'BLOCK') {
        const err = new Error(
          `Movement blocked: posting ${input.qtyDelta} would take stock to ${afterBalance} for item ${input.itemId}.`,
        );
        err.name = 'NegativeStockBlockedError';
        throw err;
      }
      if (policy === 'WARN') {
        console.warn(`Negative stock warning: item ${input.itemId} location ${input.locationId} -> ${afterBalance}`);
      }
    }

    try {
      const movement = await prisma.$transaction(async (tx) => {
        const created = await tx.stockMovement.create({
          data: {
            itemId: input.itemId,
            lotId: input.lotId,
            locationId: input.locationId,
            movementType: input.movementType as never,
            qtyDelta: input.qtyDelta,
            beforeBalance,
            afterBalance,
            sourceDocument: input.sourceDocument,
            sourceLineId: input.sourceLineId,
            actor: input.actor,
            timestamp: new Date(),
            correlationId,
            reason: input.reason,
          },
        });

        if (current) {
          // updateMany's affected-row count is the authoritative check: 0
          // rows means another writer changed this balance between our read
          // and our write, so we throw to roll back this whole transaction
          // (including the movement insert above) rather than leave an
          // orphaned movement with no matching balance change, then retry
          // the outer loop from a fresh read.
          const { count } = await tx.stockBalance.updateMany({
            where: { id: current.id, version: current.version },
            data: { onHand: afterBalance, available: afterBalance - current.reserved, version: { increment: 1 } },
          });
          if (count === 0) throw new Error('OPTIMISTIC_LOCK_LOST');
        } else {
          // A unique-constraint violation here means two concurrent requests
          // both saw no existing balance row and raced to create it;
          // retrying reads the now-existing row and takes the update path.
          await tx.stockBalance.create({
            data: {
              itemId: input.itemId,
              lotId: input.lotId,
              locationId: input.locationId,
              onHand: afterBalance,
              available: afterBalance,
            },
          });
        }

        return created;
      });

      return { movement, balance: { onHand: afterBalance } };
    } catch {
      continue;
    }
  }

  throw new Error('Failed to post stock movement after concurrent-write retries; please retry the request.');
}

router.get('/stock-movements', async (req, res) => {
  const { itemId, locationId } = req.query;
  if (typeof locationId === 'string' && !canAccessLocation(req, locationId)) {
    return res.status(403).json({ message: 'Location access denied.' });
  }
  const movements = await prisma.stockMovement.findMany({
    where: {
      itemId: typeof itemId === 'string' ? itemId : undefined,
      locationId: typeof locationId === 'string' ? locationId : undefined,
    },
    orderBy: { timestamp: 'desc' },
    take: 200,
  });
  return res.json({ movements });
});

router.post('/stock-movements', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { itemId, lotId, locationId, movementType, qtyDelta, sourceDocument, sourceLineId, reason } = req.body;
  if (!itemId || !locationId || !movementType || typeof qtyDelta !== 'number' || qtyDelta === 0) {
    return res.status(400).json({ message: 'itemId, locationId, movementType and a non-zero qtyDelta are required.' });
  }
  try {
    const result = await postStockMovement({
      itemId,
      lotId: lotId ?? null,
      locationId,
      movementType,
      qtyDelta,
      actor: req.user!.id,
      sourceDocument,
      sourceLineId,
      reason,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error && error.name === 'NegativeStockBlockedError') {
      return res.status(409).json({ message: error.message });
    }
    throw error;
  }
});

router.post('/stock-movements/:id/reverse', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const original = await prisma.stockMovement.findUnique({ where: { id: req.params.id } });
  if (!original) return res.status(404).json({ message: 'Movement not found.' });

  const alreadyReversed = await prisma.stockMovement.findFirst({ where: { metadata: { path: '$.reversalOf', equals: original.id } } }).catch(() => null);
  if (alreadyReversed) return res.status(409).json({ message: 'This movement has already been reversed.' });

  const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Manual reversal';
  const result = await postStockMovement({
    itemId: original.itemId,
    lotId: original.lotId,
    locationId: original.locationId,
    movementType: original.movementType,
    qtyDelta: -original.qtyDelta,
    actor: req.user!.id,
    sourceDocument: original.sourceDocument ?? undefined,
    sourceLineId: original.sourceLineId ?? undefined,
    correlationId: original.correlationId ?? undefined,
    reason,
  });
  await prisma.stockMovement.update({ where: { id: result.movement.id }, data: { metadata: { reversalOf: original.id } } });
  return res.status(201).json(result);
});

router.get('/stock-balance', async (req, res) => {
  const { itemId, locationId } = req.query;
  if (typeof locationId === 'string' && !canAccessLocation(req, locationId)) {
    return res.status(403).json({ message: 'Location access denied.' });
  }
  const balances = await prisma.stockBalance.findMany({
    where: {
      itemId: typeof itemId === 'string' ? itemId : undefined,
      locationId: typeof locationId === 'string' ? locationId : undefined,
    },
  });
  return res.json({ balances });
});

// ============================================================================
// UNIVERSAL WORK / ASSIGNMENT ENGINE (section 14)
// ============================================================================

router.get('/work-assignments', async (req, res) => {
  const mine = req.query.mine === 'true';
  const where = mine
    ? { assignedToId: req.user!.id }
    : ADMIN_ROLES.includes(req.user!.role)
      ? {}
      : { assignedToId: req.user!.id };
  const assignments = await prisma.workAssignment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return res.json({ assignments });
});

router.get('/work-assignments/:id', async (req, res) => {
  const assignment = await prisma.workAssignment.findUnique({
    where: { id: req.params.id },
    include: { workComments: true, workAttachments: true },
  });
  if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
  if (assignment.assignedToId !== req.user!.id && !ADMIN_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ message: 'You do not have access to this assignment.' });
  }
  return res.json({ assignment });
});

router.post('/work-assignments', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title || !req.body.type || !req.body.assignedToId) {
    return res.status(400).json({ message: 'type, title and assignedToId are required.' });
  }
  const assignment = await prisma.workAssignment.create({
    data: {
      type: req.body.type,
      reference: req.body.reference || null,
      title,
      description: req.body.description || null,
      branchId: req.body.branchId || null,
      locationId: req.body.locationId || null,
      assignedToId: req.body.assignedToId,
      createdById: req.user!.id,
      priority: req.body.priority || 'NORMAL',
      dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
      slaMinutes: req.body.slaMinutes ?? null,
      instructions: req.body.instructions || null,
      checklist: req.body.checklist ?? null,
      items: req.body.items ?? null,
    },
  });
  return res.status(201).json({ assignment });
});

const ASSIGNMENT_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'CLOSED', 'CANCELLED', 'PAUSED'];

router.patch('/work-assignments/:id', async (req, res) => {
  const assignment = await prisma.workAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });

  const isOwner = assignment.assignedToId === req.user!.id;
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);
  if (!isOwner && !isAdmin) return res.status(403).json({ message: 'You do not have access to this assignment.' });

  // Admin-only fields: reassign, extend due date, change priority, cancel.
  const adminOnlyFields = ['assignedToId', 'dueAt', 'priority', 'instructions', 'items'];
  if (!isAdmin && adminOnlyFields.some((field) => req.body[field] !== undefined)) {
    return res.status(403).json({ message: 'Only Admin can reassign, reschedule, reprioritize or edit items.' });
  }

  const data: Record<string, unknown> = {};
  if (req.body.status !== undefined) {
    if (!ASSIGNMENT_STATUSES.includes(req.body.status)) return res.status(400).json({ message: 'Invalid status.' });
    data.status = req.body.status;
    if (req.body.status === 'IN_PROGRESS' && !assignment.startedAt) data.startedAt = new Date();
    if (req.body.status === 'SUBMITTED') data.submittedAt = new Date();
    if (req.body.status === 'CLOSED') data.closedAt = new Date();
  }
  if (isAdmin) {
    if (req.body.assignedToId !== undefined) data.assignedToId = req.body.assignedToId;
    if (req.body.dueAt !== undefined) data.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
    if (req.body.priority !== undefined) data.priority = req.body.priority;
    if (req.body.instructions !== undefined) data.instructions = req.body.instructions;
    if (req.body.items !== undefined) data.items = req.body.items;
  }
  if (req.body.progress !== undefined) data.progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));

  const updated = await prisma.workAssignment.update({ where: { id: assignment.id }, data });
  return res.json({ assignment: updated });
});

router.post('/work-assignments/:id/comments', async (req, res) => {
  const assignment = await prisma.workAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
  if (assignment.assignedToId !== req.user!.id && !ADMIN_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ message: 'You do not have access to this assignment.' });
  }
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty.' });
  const comment = await prisma.workComment.create({
    data: { workAssignmentId: assignment.id, authorId: req.user!.id, body },
  });
  return res.status(201).json({ comment });
});

// ============================================================================
// EXPIRY MANAGEMENT (section 18)
// ============================================================================

router.get('/expiry-alerts', async (req, res) => {
  const { locationId, status } = req.query;
  if (typeof locationId === 'string' && !canAccessLocation(req, locationId)) {
    return res.status(403).json({ message: 'Location access denied.' });
  }
  const alerts = await prisma.expiryAlert.findMany({
    where: {
      locationId: typeof locationId === 'string' ? locationId : undefined,
      status: typeof status === 'string' ? (status as never) : undefined,
    },
    include: { item: true, lot: true },
    orderBy: { expiryDate: 'asc' },
    take: 300,
  });
  return res.json({ alerts });
});

router.patch('/expiry-alerts/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const alert = await prisma.expiryAlert.findUnique({ where: { id: req.params.id } });
  if (!alert) return res.status(404).json({ message: 'Expiry alert not found.' });

  const status = req.body.status;
  const validStatuses = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'RESOLVED_BY_TRANSFER', 'RESOLVED_BY_WRITE_OFF'];
  if (status && !validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status.' });

  const updated = await prisma.expiryAlert.update({
    where: { id: alert.id },
    data: {
      status: status ?? undefined,
      recommendedAction: req.body.recommendedAction ?? undefined,
      acknowledgedAt: status === 'ACKNOWLEDGED' ? new Date() : undefined,
      resolvedAt: status && status.startsWith('RESOLVED') ? new Date() : undefined,
    },
  });
  return res.json({ alert: updated });
});

// ============================================================================
// IMPORT CENTER (section 12)
// ============================================================================

router.get('/import-templates', async (req, res) => {
  const { type } = req.query;
  const templates = await prisma.importTemplate.findMany({
    where: { importType: typeof type === 'string' ? type : undefined },
    orderBy: { name: 'asc' },
  });
  return res.json({ templates });
});

router.post('/import-templates', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const importType = typeof req.body.importType === 'string' ? req.body.importType.trim() : '';
  const columnMapping = req.body.columnMapping;
  if (!name || !importType || !columnMapping || typeof columnMapping !== 'object') {
    return res.status(400).json({ message: 'name, importType and columnMapping are required.' });
  }
  const template = await prisma.importTemplate.upsert({
    where: { name_importType: { name, importType } },
    create: { name, importType, columnMapping, createdById: req.user!.id },
    update: { columnMapping },
  });
  return res.status(201).json({ template });
});

router.delete('/import-templates/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await prisma.importTemplate.delete({ where: { id: req.params.id } }).catch(() => null);
  return res.status(204).send();
});

// Import history: filter by type, date range, user and status (blueprint 12.2).
router.get('/import-batches', async (req, res) => {
  const { type, status, importedById, from, to } = req.query;
  const batches = await prisma.importBatch.findMany({
    where: {
      type: typeof type === 'string' ? type : undefined,
      status: typeof status === 'string' ? status : undefined,
      // Non-admins only ever see their own import history; branchId isn't
      // filtered against locationIds here since those are different id
      // spaces (Location vs Branch) and batches don't reliably carry one yet.
      importedById: ADMIN_ROLES.includes(req.user!.role)
        ? (typeof importedById === 'string' ? importedById : undefined)
        : req.user!.id,
      importedAt: {
        gte: typeof from === 'string' ? new Date(from) : undefined,
        lte: typeof to === 'string' ? new Date(to) : undefined,
      },
    },
    orderBy: { importedAt: 'desc' },
    take: 200,
  });
  return res.json({ batches });
});

router.get('/import-batches/:id/errors', async (req, res) => {
  const batch = await prisma.importBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) return res.status(404).json({ message: 'Import batch not found.' });

  const rows = await prisma.importRow.findMany({
    where: { importBatchId: batch.id, errors: { not: null } },
    orderBy: { rowNumber: 'asc' },
  });
  const errors = rows
    .map((row) => {
      const rowErrors = Array.isArray(row.errors) ? (row.errors as unknown[]) : [];
      const message = rowErrors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ');
      return message ? { rowNumber: row.rowNumber, message } : null;
    })
    .filter((e): e is { rowNumber: number; message: string } => e !== null);

  const report = buildImportErrorReport(errors);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import-${batch.id}-errors.csv"`);
    return res.send(errorReportToCsv(report));
  }
  return res.json({ report });
});

// Advances a batch through Draft -> Previewed -> Validated -> Posted -> Reversed.
// Posted history is never edited in place; a POSTED batch cannot be re-posted.
router.patch('/import-batches/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const batch = await prisma.importBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) return res.status(404).json({ message: 'Import batch not found.' });

  const nextStatus = req.body.status as ImportBatchStatus | undefined;
  if (!nextStatus) return res.status(400).json({ message: 'status is required.' });

  try {
    assertValidBatchTransition(batch.status as ImportBatchStatus, nextStatus);
  } catch (error) {
    if (error instanceof InvalidBatchTransitionError) {
      return res.status(409).json({ message: error.message });
    }
    throw error;
  }

  const updated = await prisma.importBatch.update({ where: { id: batch.id }, data: { status: nextStatus } });
  return res.json({ batch: updated });
});

// ============================================================================
// LOT ALLOCATION ENGINE (section 17)
// ============================================================================

// Suggests (but does not reserve) a FEFO/FIFO allocation for an item at a
// location, so a transfer/pick screen can show the split before committing.
router.get('/lot-allocation/preview', async (req, res) => {
  const { itemId, locationId, strategy } = req.query;
  const quantity = Number(req.query.quantity);
  if (typeof itemId !== 'string' || typeof locationId !== 'string' || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'itemId, locationId and a positive quantity are required.' });
  }
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });

  const balances = await prisma.stockBalance.findMany({
    where: { itemId, locationId, lotId: { not: null } },
    include: { lot: true },
  });
  const lots: FefoLot[] = balances
    .filter((b) => b.lot)
    .map((b) => ({
      lotId: b.lot!.id,
      lotNo: b.lot!.lotNo,
      expiryDate: b.lot!.expiryDate?.toISOString() ?? null,
      available: b.available,
      createdAt: b.lot!.createdAt.toISOString(),
      status: b.lot!.status as FefoLot['status'],
    }));

  const requestedStrategy: AllocationStrategy = strategy === 'FIFO' ? 'FIFO' : 'FEFO';
  const result = allocateLots(lots, quantity, requestedStrategy);
  return res.json(result);
});

// Posts an authorized manual override allocation (blueprint 17: "authorized
// override requires reason"). Validation only here — committing the
// allocation to a transfer line/reservation is the transfer workflow's job.
router.post('/lot-allocation/manual', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { itemId, locationId, quantity, manualLines, overrideReason } = req.body;
  if (!itemId || !locationId || typeof quantity !== 'number' || !Array.isArray(manualLines)) {
    return res.status(400).json({ message: 'itemId, locationId, quantity and manualLines are required.' });
  }

  const balances = await prisma.stockBalance.findMany({
    where: { itemId, locationId, lotId: { not: null } },
    include: { lot: true },
  });
  const lots: FefoLot[] = balances
    .filter((b) => b.lot)
    .map((b) => ({ lotId: b.lot!.id, lotNo: b.lot!.lotNo, available: b.available, status: b.lot!.status as FefoLot['status'] }));

  try {
    const result = allocateLots(lots, quantity, 'MANUAL', { manualLines, overrideReason });
    return res.json(result);
  } catch (error) {
    if (
      error instanceof ManualAllocationRequiresReasonError ||
      error instanceof LotNotAllocatableError ||
      error instanceof ManualAllocationExceedsAvailableError
    ) {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }
});

router.patch('/lots/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const validStatuses = ['AVAILABLE', 'EXPIRED', 'BLOCKED', 'QUARANTINE'];
  if (!validStatuses.includes(req.body.status)) return res.status(400).json({ message: 'Invalid lot status.' });
  const lot = await prisma.lot.update({ where: { id: req.params.id }, data: { status: req.body.status } }).catch(() => null);
  if (!lot) return res.status(404).json({ message: 'Lot not found.' });
  return res.json({ lot });
});

export default router;
