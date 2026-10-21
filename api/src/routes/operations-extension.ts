import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { recordAudit } from '../lib/audit.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { listItems, listLocations } from '../lib/repository.js';
import { createOrderWithReservation } from '../lib/orders.js';
import { createConnector, findConnector, listConnectors, mapMarketplaceOrder, markConnectorIngested, validateNormalizedOrder, type ConnectorPlatform } from '../lib/connectors.js';
import { findPlan, listTenants, provisionTenant, SAAS_PLANS, tenantAllows } from '../lib/saas.js';
import { mobileHomeForRole } from '../lib/mobile-role.js';
import { createCompany, createEnhancedUser, findUserByEmail } from '../lib/enterprise-repository.js';
import { hashPassword, validatePassword } from '../lib/otp-auth.js';
import { isKnownDefaultPassword } from '../lib/production-guard.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { requireAdmin, requirePlatformOperator } from './opext-shared.js';
import collabRouter from './opext-collab.ts';
import serialsRouter from './opext-serials.ts';
import webhooksRouter from './opext-webhooks.ts';
import { webhookDeliveriesRouter } from './opext-webhooks.ts';
import rulesRouter from './opext-rules.ts';
import expiryRouter from './opext-expiry.ts';
import binsRouter from './opext-bins.ts';
import { binStockRouter } from './opext-bins.ts';
import qcExceptionsRouter from './opext-qc-exceptions.ts';
import jobsRouter from './opext-jobs.ts';
import intelligenceRouter from './opext-intelligence.ts';
import ordersRouter from './opext-orders.ts';
import returnsRouter from './opext-returns.ts';
import { createPutawayTask } from '../lib/putaway.js';

const router = Router();

router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

router.use(jobsRouter);

router.use(collabRouter);

router.use(expiryRouter);

router.use(intelligenceRouter);

router.use(webhooksRouter);

router.use(binsRouter);

router.use(serialsRouter);

router.use(ordersRouter);

router.use(returnsRouter);

router.use(rulesRouter);

router.use(qcExceptionsRouter);

router.use(binStockRouter);

router.get('/mobile/home', async (req, res) => {
  return res.json({ home: mobileHomeForRole(req.user!.role) });
});

router.get('/saas/plans', async (_req, res) => {
  return res.json({ plans: SAAS_PLANS });
});

router.get('/saas/tenants', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  return res.json({ tenants: listTenants(), entitlements: SAAS_PLANS });
});

router.post('/saas/onboard', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  try {
    const companyName = String(req.body.companyName ?? '').trim();
    const adminName = String(req.body.adminName ?? '').trim();
    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const planCode = String(req.body.planCode ?? 'starter');
    // No default password: a tenant admin created with a value that is public in the
    // repository can be taken over by anyone who knows the sign-in email.
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) return res.status(400).json({ message: passwordCheck.message ?? 'A strong temporary password is required.' });
    if (isKnownDefaultPassword(password)) return res.status(400).json({ message: 'That password is publicly known. Choose a different temporary password.' });
    const { tenant, subscription } = provisionTenant({ companyName, adminName, adminEmail, planCode });
    if (findUserByEmail(adminEmail)) {
      return res.status(409).json({ message: 'An account with that admin email already exists.', tenant, subscription });
    }
    const selectedPlan = findPlan(planCode);
    if (!selectedPlan) return res.status(400).json({ message: 'Unknown or inactive plan.' });
    const plan = planCode === 'enterprise' ? 'enterprise' : planCode === 'growth' ? 'pro' : 'free';
    const company = createCompany({
      name: companyName, email: adminEmail, plan, industry: 'retail',
    });
    const user = createEnhancedUser({
      companyId: tenant.id,
      email: adminEmail,
      name: adminName,
      role: 'ADMIN',
      branchIds: [],
      locationIds: [],
      passwordHash: hashPassword(password),
      status: 'active',
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'TENANT_PROVISIONED',
      entityType: 'Tenant', entityId: tenant.id,
      metadata: { planCode, adminEmail, companyId: company.id, userId: user.id },
    }));
    return res.status(201).json({ tenant, subscription, company, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to provision tenant.' });
  }
});

router.get('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tenantId = req.user!.companyId ?? 'default-company';
  if (databaseEnabled) {
    const rows = await prisma.marketplaceConnector.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    return res.json({ connectors: rows.length ? rows : listConnectors(tenantId) });
  }
  return res.json({ connectors: listConnectors(tenantId) });
});

router.post('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.body.name ?? '').trim();
  const platform = String(req.body.platform ?? '').toUpperCase() as ConnectorPlatform;
  if (!name || !['AMAZON', 'FLIPKART', 'WEBSITE', 'CUSTOM'].includes(platform)) {
    return res.status(400).json({ message: 'name and platform (AMAZON, FLIPKART, WEBSITE, CUSTOM) are required.' });
  }
  const tenantId = req.user!.companyId ?? 'default-company';
  const webhookSecret = String(req.body.webhookSecret ?? `whsec_${Math.random().toString(36).slice(2, 14)}`);
  const memory = createConnector({ name, platform, webhookSecret, tenantId, channel: req.body.channel });
  if (databaseEnabled) {
    const row = await prisma.marketplaceConnector.create({
      data: { id: memory.id, name, platform, channel: memory.channel, webhookSecret, tenantId, status: 'ACTIVE' },
    }).catch(() => memory);
    return res.status(201).json({ connector: { ...row, webhookSecret } });
  }
  return res.status(201).json({ connector: memory });
});

router.post('/connectors/:id/ingest', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memoryConnector = findConnector(req.params.id);
  const connector = (memoryConnector && memoryConnector.tenantId === (req.companyId ?? DEFAULT_COMPANY_ID) ? memoryConnector : undefined)
    ?? (databaseEnabled ? await prisma.marketplaceConnector.findFirst({ where: { id: req.params.id, tenantId: req.companyId ?? DEFAULT_COMPANY_ID } }) : null);
  if (!connector) return res.status(404).json({ message: 'Connector not found.' });
  if (!tenantAllows(req.user!.companyId ?? 'default-company', 'connectors') && !tenantAllows('default-company', 'connectors')) {
    return res.status(403).json({ message: 'Marketplace connectors are not on the current plan.' });
  }
  const payloads = Array.isArray(req.body.orders) ? req.body.orders : [req.body];
  const created = [];
  const duplicates = [];
  const errors = [];
  for (const payload of payloads) {
    const mapped = mapMarketplaceOrder(connector.platform as ConnectorPlatform, payload && typeof payload === 'object' ? payload : {});
    const invalid = validateNormalizedOrder(mapped);
    if (invalid) { errors.push({ reference: mapped.externalReference, message: invalid }); continue; }
    const lines = [];
    for (const line of mapped.lines) {
      const memoryItem = listItems().find((entry) => entry.code === line.sku || entry.id === line.sku);
      const item = !databaseEnabled
        ? memoryItem
        : await prisma.item.findFirst({ where: { OR: [{ code: line.sku }, { id: line.sku }], companyId: req.companyId ?? DEFAULT_COMPANY_ID } }).catch(() => null) ?? memoryItem;
      if (!item) { errors.push({ reference: mapped.externalReference, message: `Unknown SKU ${line.sku}` }); continue; }
      lines.push({ itemId: item.id, quantity: line.quantity });
    }
    if (!lines.length) continue;
    try {
      const locations = databaseEnabled
        ? await prisma.location.findMany({ where: { status: 'ACTIVE', companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true, name: true, type: true } })
        : listLocations().map((location) => ({ id: location.id, name: location.name, type: location.type }));
      const order = await createOrderWithReservation({
        channel: mapped.channel,
        externalReference: mapped.externalReference,
        customerName: mapped.customerName,
        notes: mapped.notes,
        createdById: req.user!.id,
        companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        allowSplit: true,
        candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
        lines,
      });
      if (order.duplicate) duplicates.push(order); else created.push(order);
    } catch (error) {
      errors.push({ reference: mapped.externalReference, message: error instanceof Error ? error.message : 'Unable to reserve order.' });
    }
  }
  markConnectorIngested(connector.id);
  if (databaseEnabled) {
    await prisma.marketplaceConnector.update({ where: { id: connector.id }, data: { lastIngestedAt: new Date() } }).catch(() => undefined);
  }
  // A payload the platform already delivered is not an error: it is acknowledged with the order it produced.
  return res.status(created.length ? 201 : duplicates.length ? 200 : 409).json({ orders: created, duplicates, errors });
});

router.use(webhookDeliveriesRouter);

export default router;
