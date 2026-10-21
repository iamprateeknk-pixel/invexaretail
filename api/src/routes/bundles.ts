// Virtual bundles/kits. A bundle item owns no stock of its own; its
// availability is derived from its components (lib/bundle-availability.ts).
// DB-only, like routes/branches.ts - there is no in-memory mirror.
import { type Request, type Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { assertItemOwnedByTenant, ItemNotFoundError } from '../lib/repositories/item-repository.js';
import { bundleAvailability, validateBundleDefinition } from '../lib/bundle-availability.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

const companyOf = (req: Request) => req.companyId ?? DEFAULT_COMPANY_ID;

function tenantContextFor(req: Request): TenantContext {
  return { companyId: companyOf(req), tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as TenantContext['role'] };
}

const ADMIN_ROLES = ['ADMIN', 'ADMIN_USER'];

// Sellable stock per component: on hand minus reserved, at one location when given, else company-wide.
async function availableByItem(companyId: string, itemIds: string[], locationId?: string): Promise<Map<string, number>> {
  const rows = await prisma.stockLedger.findMany({
    where: { itemId: { in: itemIds }, ...(locationId ? { locationId } : { companyId }) },
    select: { itemId: true, onHand: true, reserved: true },
  });
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + Number(row.onHand) - Number(row.reserved));
  return totals;
}

router.get('/items/:itemId/bundle', async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  const companyId = companyOf(req);
  try {
    await assertItemOwnedByTenant(tenantContextFor(req), itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
  const locationId = typeof req.query.locationId === 'string' && req.query.locationId ? req.query.locationId : undefined;
  if (locationId && !(await prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true } }))) return res.status(404).json({ message: 'Location not found.' });
  const rows = await prisma.itemBundleComponent.findMany({
    where: { bundleItemId: itemId, companyId },
    include: { component: { select: { id: true, code: true, name: true, unit: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const components = rows.map((row) => ({ itemId: row.componentItemId, code: row.component.code, name: row.component.name, unit: row.component.unit, quantity: Number(row.quantity) }));
  const available = await availableByItem(companyId, components.map((component) => component.itemId), locationId);
  return res.json({ itemId, isBundle: components.length > 0, components, ...bundleAvailability(components, available), locationId: locationId ?? null });
});

router.put('/items/:itemId/bundle', async (req: Request, res: Response) => {
  if (!ADMIN_ROLES.includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  const companyId = companyOf(req);
  const ctx = tenantContextFor(req);
  const input: Array<{ itemId: string; quantity: number }> = Array.isArray(req.body?.components)
    ? req.body.components.map((row: { itemId?: unknown; quantity?: unknown }) => ({ itemId: String(row.itemId ?? ''), quantity: Number(row.quantity) }))
    : [];
  try {
    await assertItemOwnedByTenant(ctx, itemId);
    // Every component must be this company's own item; a foreign id is indistinguishable from a missing one.
    for (const component of input) await assertItemOwnedByTenant(ctx, component.itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
  const nested = await prisma.itemBundleComponent.findMany({ where: { bundleItemId: { in: input.map((c) => c.itemId) }, companyId }, select: { bundleItemId: true } });
  // An item that is already a component elsewhere cannot become a bundle, otherwise nesting returns through the back door.
  const usedAsComponent = await prisma.itemBundleComponent.count({ where: { componentItemId: itemId, companyId } });
  const problem = validateBundleDefinition(itemId, input, new Set(nested.map((row) => row.bundleItemId)));
  if (problem) return res.status(400).json({ message: problem.message, code: problem.code });
  if (usedAsComponent > 0) return res.status(409).json({ message: 'This item is a component of another bundle, so it cannot be a bundle itself.', code: 'NESTED_BUNDLE' });
  await prisma.$transaction([
    prisma.itemBundleComponent.deleteMany({ where: { bundleItemId: itemId, companyId } }),
    prisma.itemBundleComponent.createMany({
      data: input.map((component) => ({ bundleItemId: itemId, componentItemId: component.itemId, quantity: new Prisma.Decimal(component.quantity), companyId })),
    }),
  ]);
  return res.json({ itemId, components: input });
});

router.delete('/items/:itemId/bundle', async (req: Request, res: Response) => {
  if (!ADMIN_ROLES.includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  try {
    await assertItemOwnedByTenant(tenantContextFor(req), itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
  await prisma.itemBundleComponent.deleteMany({ where: { bundleItemId: itemId, companyId: companyOf(req) } });
  return res.json({ itemId, removed: true });
});

export default router;
