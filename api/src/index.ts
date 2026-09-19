import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import 'dotenv/config';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import enterpriseAuthRouter from './routes/enterprise-auth.js';
import enterpriseManagementRouter from './routes/enterprise-management.js';
import enterpriseAnalyticsRouter from './routes/enterprise-analytics.js';
import coreRouter from './routes/core.js';
import catalogProcurementRouter from './routes/catalog-procurement.js';
import operationsExtensionRouter from './routes/operations-extension.js';
import eventsRouter, { publishMutationEvents } from './routes/events.js';
import campaignsRouter from './routes/campaigns.js';
import itemMasterRouter from './routes/item-master.js';
import transferLogisticsRouter from './routes/transfer-logistics.js';
import importControlCenterRouter from './routes/import-control-center.js';
import { controlRouter, studioRouter, syncRouter } from './routes/control-plane.js';
import { isAllowedOrigin, resolveAllowedOrigins } from './lib/cors-origins.js';
import { buildPlatformMeta } from './lib/platform.js';
import { extractToken } from './routes/enterprise-auth.js';
import { controlPlane } from './lib/saas/control-plane.js';
import { DEFAULT_TENANT_ID, enforceOperationalCompanyScope } from './lib/saas/tenant-scope.js';
import { enforceOperationalKillSwitches } from './lib/saas/kill-switch.js';
import { enforcePlanLimits, enforceSuspendedCompany, enforceApiUsage } from './lib/saas/company-access.js';
import { enforcePlanEntitlements } from './lib/saas/entitlements.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const startedAt = Date.now();
const release = process.env.APP_VERSION ?? process.env.GITHUB_SHA?.slice(0, 12) ?? 'unknown';
let startupHydration: Promise<void> = Promise.resolve();
let authHydration: Promise<void> = Promise.resolve();
let repositoryHydrationState: 'starting' | 'ready' | 'failed' = 'starting';

// Behind the host's reverse proxy every request otherwise looks like it comes
// from the proxy, which would put all callers in one rate-limit bucket. One
// hop only, so a spoofed X-Forwarded-For cannot pose as another client.
app.set('trust proxy', 1);

// Security: CORS with origin validation. Production website origins are always
// included so a Hostinger ALLOWED_ORIGINS typo cannot block login.
const allowedOrigins = resolveAllowedOrigins(process.env.ALLOWED_ORIGINS);
const corsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    callback(null, isAllowedOrigin(origin, allowedOrigins));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Invexa-Signature'],
  maxAge: 3600,
};
app.use(cors(corsOptions));

// Security: Helmet with strict CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(morgan('dev'));
app.use(express.json({
  limit: '2mb',
  verify(req: Request, _res: Response, buf: Buffer) {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()
    ? req.headers['x-request-id'].trim().slice(0, 128)
    : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Rate limiting: General API
app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));

// The auth router applies its own per-endpoint limiters. Adding a second one
// here made every attempt count twice, so a user hit 429 after two or three
// tries instead of five.

// Health checks
// Hostinger and people often open the API domain without a path. Keep the
// root useful and return 200 instead of the framework's generic 404.
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'retail-inventory-api',
    release,
    status: 'running',
    endpoints: {
      health: '/health',
      readiness: '/ready',
      metadata: '/meta',
      api: '/api/v1',
      control: '/control/v1',
      studio: '/studio/v1',
      sync: '/sync/v1',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (_req: Request, res: Response) => {
  const { databaseEnabled } = await import('./lib/persistence.js');
  res.json({
    ok: true,
    service: 'retail-inventory-api',
    release,
    persistence: databaseEnabled ? 'database' : 'memory',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// Public, non-sensitive contract for web and mobile clients. It lets clients
// identify a deployed release and available workflows without guessing from
// the database response or relying on a hard-coded app version.
app.get('/meta', (_req: Request, res: Response) => {
  res.json(buildPlatformMeta(release));
});

// Reports how many users startup actually loaded. SELECT 1 alone succeeds
// even when the schema is wrong, so it cannot distinguish a healthy database
// from one carrying the older lowercase tables — and that difference is the
// whole reason logins return 401.
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const { databaseEnabled } = await import('./lib/persistence.js');
    if (!databaseEnabled) {
      const status = repositoryHydrationState === 'ready' ? 200 : 503;
      return res.status(status).json({
        ok: status === 200,
        persistence: 'memory',
        release,
        repository: { ready: repositoryHydrationState === 'ready', state: repositoryHydrationState },
      });
    }

    const { prisma } = await import('./lib/db.js');
    const { enhancedUsers } = await import('./lib/enterprise-repository.js');
    await prisma.$queryRaw`SELECT 1`;

    if (enhancedUsers.length === 0) {
      return res.status(503).json({
        ok: false,
        persistence: 'database',
        users: 0,
        hint: 'Connected, but no users are loaded, so every login returns 401. The User table is missing or empty — import invexaretail-database.sql, or run npm run db:seed, then restart.',
      });
    }

    const repositoryReady = repositoryHydrationState === 'ready';
    return res.status(repositoryReady ? 200 : 503).json({
      ok: repositoryReady,
      persistence: 'database',
      release,
      users: enhancedUsers.length,
      repository: { ready: repositoryReady, state: repositoryHydrationState },
    });
  } catch (error) {
    const { safeDatabaseError } = await import('./lib/db.js');
    const safe = safeDatabaseError(error);
    return res.status(503).json({
      ok: false,
      persistence: 'database',
      hint: safe.hint,
      code: safe.code,
    });
  }
});

// ============================================
// ENTERPRISE ROUTES
// ============================================
// Shared hosting requires listen() almost immediately after startup. Requests
// still wait for durable MySQL hydration, so the browser never receives seed
// branches or seed items during a restart.
app.use('/api/v1', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Login only depends on the User table. A legacy inventory table must not
    // lock every administrator out while its additive migration is repaired.
    await (req.path.startsWith('/auth/') ? authHydration : startupHydration);
    next();
  } catch (error) {
    res.status(503).json({ message: 'Inventory is starting. Please retry in a moment.' });
  }
});

app.use('/api/v1', extractToken, (req: Request, res: Response, next: NextFunction) => {
  if (!req.companyId) return next();
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const candidates = [req.params.companyId, req.query.companyId, body.companyId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && candidate !== req.companyId) {
      controlPlane.auditEvent({
        actorUserId: req.userId ?? 'unknown',
        actorType: 'company',
        tenantId: DEFAULT_TENANT_ID,
        companyId: req.companyId,
        sessionId: null,
        action: 'COMPANY_SCOPE_DENIED',
        entityType: 'request',
        entityId: candidate,
        before: { requested: candidate },
        after: { locked: req.companyId },
      });
      return res.status(403).json({ error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
    }
  }
  next();
});

app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
app.use('/api/v1', enforceOperationalKillSwitches);
app.use('/api/v1', enforceSuspendedCompany);
app.use('/api/v1', enforcePlanEntitlements);
app.use('/api/v1', enforcePlanLimits);
app.use('/api/v1', enforceApiUsage);

app.use('/control/v1', controlRouter);
app.use('/studio/v1', studioRouter);
app.use('/sync/v1', syncRouter);

app.use('/api/v1/auth', enterpriseAuthRouter);
app.use('/api/v1/admin', enterpriseManagementRouter);
app.use('/api/v1/analytics', enterpriseAnalyticsRouter);

// Blueprint v4 §11: live event stream + payload-free mutation events. The
// publisher must sit before every router that owns a mutating route.
app.use('/api/v1', eventsRouter);
app.use('/api/v1', campaignsRouter);
app.use('/api/v1', itemMasterRouter);
app.use('/api/v1', importControlCenterRouter);
app.use('/api/v1', publishMutationEvents);
app.use('/api/v1', transferLogisticsRouter);

// Mounted last so the prefixed routers above keep priority over its paths.
app.use('/api/v1', coreRouter);
app.use('/api/v1', catalogProcurementRouter);

app.post('/api/v1/webhooks/marketplaces/:connectorId', async (req: Request, res: Response) => {
  try {
    const { findConnector, mapMarketplaceOrder, markConnectorIngested, validateNormalizedOrder, verifyConnectorSignature } = await import('./lib/connectors.js');
    const { prisma } = await import('./lib/db.js');
    const { databaseEnabled } = await import('./lib/persistence.js');
    const { createOrderWithReservation } = await import('./lib/orders.js');
    const { listItems, listLocations } = await import('./lib/repository.js');
    const connectorId = String(req.params.connectorId ?? '');
    const connector = findConnector(connectorId)
      ?? (databaseEnabled ? await prisma.marketplaceConnector.findUnique({ where: { id: connectorId } }) : null);
    if (!connector || connector.status === 'PAUSED') {
      res.status(404).json({ message: 'Connector not found.' });
      return;
    }
    const raw = JSON.stringify(req.body ?? {});
    const signature = typeof req.headers['x-invexa-signature'] === 'string' ? req.headers['x-invexa-signature'] : '';
    if (!verifyConnectorSignature(connector.webhookSecret, raw, signature)) {
      res.status(401).json({ message: 'Invalid connector signature.' });
      return;
    }
    const mapped = mapMarketplaceOrder(connector.platform as 'AMAZON' | 'FLIPKART' | 'WEBSITE' | 'CUSTOM', req.body ?? {});
    const invalid = validateNormalizedOrder(mapped);
    if (invalid) {
      res.status(400).json({ message: invalid });
      return;
    }
    const lines = [];
    for (const line of mapped.lines) {
      const item = (databaseEnabled ? await prisma.item.findFirst({ where: { OR: [{ code: line.sku }, { id: line.sku }] } }) : null)
        ?? listItems().find((entry) => entry.code === line.sku || entry.id === line.sku);
      if (item) lines.push({ itemId: item.id, quantity: line.quantity });
    }
    if (!lines.length) {
      res.status(409).json({ message: 'No matching SKUs for this marketplace order.' });
      return;
    }
    const locations = databaseEnabled
      ? await prisma.location.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, type: true } })
      : listLocations().map((location) => ({ id: location.id, name: location.name, type: location.type }));
    const order = await createOrderWithReservation({
      channel: mapped.channel,
      externalReference: mapped.externalReference,
      customerName: mapped.customerName,
      notes: mapped.notes,
      createdById: 'connector',
      allowSplit: true,
      candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
      lines,
    });
    markConnectorIngested(connector.id);
    res.status(order.duplicate ? 200 : 201).json({ order, duplicate: Boolean(order.duplicate) });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to ingest marketplace order.' });
  }
});

app.use('/api/v1', operationsExtensionRouter);

// Last-resort boundary for unexpected errors. Route handlers may return
// user-friendly validation messages, but uncaught failures must never leak
// database details or stack traces to web/mobile clients.
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId ?? 'unknown';
  console.error('Unhandled API error', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    error: error instanceof Error ? error.message : String(error),
  });
  if (res.headersSent) return;
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
});

// Hydrate database on startup
const hydrateDatabase = async () => {
  try {
    const { hydrateAuthUsers } = await import('./lib/persistence.js');
    const loaded = await hydrateAuthUsers();
    console.log('Database connected successfully');
    if (loaded === 0) {
      console.error('⚠️  The User table is empty. Every login will fail with 401 until it has rows.');
      console.error('    Import invexaretail-database.sql, or run: npm run db:seed');
    } else {
      console.log(`✅ ${loaded} users loaded successfully`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The repo carries two older schemas that create a lowercase `users`
    // table. Prisma queries `User`, and MySQL on Linux is case-sensitive, so
    // importing one of those leaves logins failing with a bare 401.
    if (/doesn't exist|Unknown table|no such table/i.test(message)) {
      console.error('⚠️  The database is missing the tables this API expects.');
      console.error('    Prisma needs `User`, `Location`, `Item`, `Lot`, `StockLedger`,');
      console.error('    `StockCount`, `CountAssignment`, `Transfer`, `TransferLine`, `AuditLog`.');
      console.error('    A lowercase `users` table comes from database/schema.sql, which belongs');
      console.error('    to a different design and does not work with this API.');
      console.error('    Import invexaretail-database.sql, or run: npm run db:migrate && npm run db:seed');
      console.error(`    (${message})`);
    } else {
      console.error('Database connection failed:', error);
    }
  }
};

// The core inventory routes read from the in-memory repository, which serves
// seed data until this replaces it with the database contents.
const hydrateRepository = async () => {
  const { databaseEnabled, hydrateRepositoryFromDatabase, hydrateAuditFromDatabase, hydrateCompanyProfile } = await import('./lib/persistence.js');
  if (!databaseEnabled) {
    console.log('DATABASE_URL is not set; serving inventory from seed data instead of Hostinger MySQL.');
    const { seedEnhancedUsersForMemoryMode } = await import('./lib/enterprise-repository.js');
    const { seedUsers } = await import('./lib/seed.js');
    const { hashPassword } = await import('./lib/otp-auth.js');
    seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    return;
  }
  const { ensureDailySyncSchema } = await import('./lib/runtime-schema.js');
  await ensureDailySyncSchema();
  await hydrateRepositoryFromDatabase();
  try {
    const { hydrateControlPlaneFromStore } = await import('./lib/saas/persistence.js');
    const saas = await hydrateControlPlaneFromStore();
    if (saas === 'restored') console.log('✅ SaaS control plane restored from ControlPlaneState');
    else if (saas === 'seeded') console.log('✅ SaaS control plane seed saved to ControlPlaneState');
  } catch (error) {
    console.warn('SaaS control plane could not be hydrated; continuing with in-memory seed.', error instanceof Error ? error.message : error);
  }
  const { replaceAuditEvents } = await import('./lib/audit.js');
  // Company profile and audit history enhance the admin screens, but neither
  // may block login or branch hydration when an older Hostinger database has
  // not yet received those optional tables.
  try {
    await hydrateCompanyProfile();
  } catch (error) {
    console.warn('Company profile could not be hydrated; continuing with the default profile.', error instanceof Error ? error.message : error);
  }
  try {
    replaceAuditEvents(await hydrateAuditFromDatabase());
  } catch (error) {
    console.warn('Audit history could not be hydrated; continuing without historical audit entries.', error instanceof Error ? error.message : error);
  }
  try {
    const { hydrateCampaignsFromDatabase } = await import('./lib/campaign-persistence.js');
    await hydrateCampaignsFromDatabase();
  } catch (error) {
    console.warn('Stock-take campaigns could not be hydrated; continuing without them.', error instanceof Error ? error.message : error);
  }
  console.log('✅ Inventory repository hydrated from database');
};

// Bind the HTTP port immediately for Hostinger, then keep API requests behind
// the hydration promise until MySQL branches, users and stock are available.
const startServer = () => {
  authHydration = hydrateDatabase();
  startupHydration = (async () => {
    await authHydration;
    await hydrateRepository();
    repositoryHydrationState = 'ready';
    const { startCampaignScheduler } = await import('./lib/campaign-scheduler.js');
    startCampaignScheduler();
    const { startOrderScheduler } = await import('./lib/order-scheduler.js');
    startOrderScheduler();
  })();
  startupHydration.catch((error) => {
    repositoryHydrationState = 'failed';
    console.error('Unable to hydrate database after startup:', error);
  });
  const server = app.listen(port, () => {
    console.log(`Retail Inventory API listening on port ${port}`);
  });

  // Let Hostinger stop/restart the process without cutting off an in-flight
  // database operation or leaving Prisma connections open.
  const shutdown = (signal: string) => {
    console.log(`${signal} received; closing the API server.`);
    server.close(async () => {
      try {
        const { flushControlPlanePersist } = await import('./lib/saas/persistence.js');
        await flushControlPlanePersist();
      } catch (error) {
        console.warn('SaaS control plane state could not be flushed on shutdown.', error instanceof Error ? error.message : error);
      }
      try {
        const { prisma } = await import('./lib/db.js');
        await prisma.$disconnect();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

startServer();

export { app };
