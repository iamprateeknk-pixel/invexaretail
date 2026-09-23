"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const node_crypto_1 = require("node:crypto");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const enterprise_auth_js_1 = __importDefault(require("./routes/enterprise-auth.js"));
const enterprise_management_js_1 = __importDefault(require("./routes/enterprise-management.js"));
const enterprise_analytics_js_1 = __importDefault(require("./routes/enterprise-analytics.js"));
const core_js_1 = __importDefault(require("./routes/core.js"));
const catalog_procurement_js_1 = __importDefault(require("./routes/catalog-procurement.js"));
const operations_extension_js_1 = __importDefault(require("./routes/operations-extension.js"));
const events_js_1 = __importStar(require("./routes/events.js"));
const campaigns_js_1 = __importDefault(require("./routes/campaigns.js"));
const item_master_js_1 = __importDefault(require("./routes/item-master.js"));
const transfer_logistics_js_1 = __importDefault(require("./routes/transfer-logistics.js"));
const command_center_js_1 = __importDefault(require("./routes/command-center.js"));
const request_metrics_js_1 = require("./lib/request-metrics.js");
const import_control_center_js_1 = __importDefault(require("./routes/import-control-center.js"));
const control_plane_js_1 = require("./routes/control-plane.js");
const cors_origins_js_1 = require("./lib/cors-origins.js");
const platform_js_1 = require("./lib/platform.js");
const enterprise_auth_js_2 = require("./routes/enterprise-auth.js");
const control_plane_js_2 = require("./lib/saas/control-plane.js");
const tenant_scope_js_1 = require("./lib/saas/tenant-scope.js");
const kill_switch_js_1 = require("./lib/saas/kill-switch.js");
const company_access_js_1 = require("./lib/saas/company-access.js");
const entitlements_js_1 = require("./lib/saas/entitlements.js");
const db_js_1 = require("./lib/db.js");
if (process.env.REQUIRE_DATABASE === 'true' && !(0, db_js_1.resolveDatabaseUrl)()) {
    throw new Error('DATABASE_URL is required when REQUIRE_DATABASE=true; refusing unsafe memory-mode startup.');
}
const app = (0, express_1.default)();
exports.app = app;
const port = Number(process.env.PORT ?? 4000);
const startedAt = Date.now();
const release = process.env.APP_VERSION ?? process.env.GITHUB_SHA?.slice(0, 12) ?? 'unknown';
let startupHydration = Promise.resolve();
let authHydration = Promise.resolve();
let repositoryHydrationState = 'starting';
let repositoryRefreshedAt = 0;
let repositoryRefreshInFlight = null;
// Behind the host's reverse proxy every request otherwise looks like it comes
// from the proxy, which would put all callers in one rate-limit bucket. One
// hop only, so a spoofed X-Forwarded-For cannot pose as another client.
app.set('trust proxy', 1);
// Security: CORS with origin validation. Production website origins are always
// included so a Hostinger ALLOWED_ORIGINS typo cannot block login.
const allowedOrigins = (0, cors_origins_js_1.resolveAllowedOrigins)(process.env.ALLOWED_ORIGINS);
const corsOptions = {
    origin(origin, callback) {
        callback(null, (0, cors_origins_js_1.isAllowedOrigin)(origin, allowedOrigins));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Invexa-Signature', 'If-Last-Event-ID', 'Last-Event-ID'],
    maxAge: 3600,
};
app.use((0, cors_1.default)(corsOptions));
// Security: Helmet with strict CSP
app.use((0, helmet_1.default)({
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
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({
    limit: '2mb',
    verify(req, _res, buf) {
        req.rawBody = buf.toString('utf8');
    },
}));
app.use((req, res, next) => {
    const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()
        ? req.headers['x-request-id'].trim().slice(0, 128)
        : (0, node_crypto_1.randomUUID)();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
});
app.use(request_metrics_js_1.requestMetricsMiddleware);
// Rate limiting: General API
app.use('/api', (0, express_rate_limit_1.default)({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
// The auth router applies its own per-endpoint limiters. Adding a second one
// here made every attempt count twice, so a user hit 429 after two or three
// tries instead of five.
// Health checks
// Hostinger and people often open the API domain without a path. Keep the
// root useful and return 200 instead of the framework's generic 404.
app.get('/', (_req, res) => {
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
app.get('/health', async (_req, res) => {
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
app.get('/meta', (_req, res) => {
    res.json((0, platform_js_1.buildPlatformMeta)(release));
});
// Reports how many users startup actually loaded. SELECT 1 alone succeeds
// even when the schema is wrong, so it cannot distinguish a healthy database
// from one carrying the older lowercase tables — and that difference is the
// whole reason logins return 401.
app.get('/ready', async (_req, res) => {
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
        await prisma.$queryRaw `SELECT 1`;
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
    }
    catch (error) {
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
// still wait for durable PostgreSQL hydration, so the browser never receives seed
// branches or seed items during a restart.
app.use('/api/v1', async (req, res, next) => {
    try {
        // Login only depends on the User table. A legacy inventory table must not
        // lock every administrator out while its additive migration is repaired.
        if (req.path.startsWith('/auth/')) {
            await authHydration;
        }
        else {
            await startupHydration;
            // Operational routes serve an in-memory snapshot. Refresh it before
            // stale GETs so direct database imports appear without an API restart.
            // Parallel browser requests share one database refresh job.
            if (req.method === 'GET' && req.path !== '/events')
                await refreshRepositoryIfStale();
        }
        next();
    }
    catch (error) {
        res.status(503).json({ message: 'Inventory is starting. Please retry in a moment.' });
    }
});
app.use('/api/v1', enterprise_auth_js_2.extractToken, (req, res, next) => {
    if (!req.companyId)
        return next();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const candidates = [req.params.companyId, req.query.companyId, body.companyId];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate && candidate !== req.companyId) {
            control_plane_js_2.controlPlane.auditEvent({
                actorUserId: req.userId ?? 'unknown',
                actorType: 'company',
                tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID,
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
app.use('/api/v1', enterprise_auth_js_2.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
app.use('/api/v1', kill_switch_js_1.enforceOperationalKillSwitches);
app.use('/api/v1', company_access_js_1.enforceSuspendedCompany);
app.use('/api/v1', entitlements_js_1.enforcePlanEntitlements);
app.use('/api/v1', company_access_js_1.enforcePlanLimits);
app.use('/api/v1', company_access_js_1.enforceApiUsage);
app.use('/control/v1', control_plane_js_1.controlRouter);
app.use('/studio/v1', control_plane_js_1.studioRouter);
app.use('/sync/v1', control_plane_js_1.syncRouter);
app.use('/api/v1/auth', enterprise_auth_js_1.default);
app.use('/api/v1/admin', enterprise_management_js_1.default);
app.use('/api/v1/analytics', enterprise_analytics_js_1.default);
// Blueprint v4 §11: live event stream + payload-free mutation events. The
// publisher must sit before every router that owns a mutating route.
app.use('/api/v1', events_js_1.default);
app.use('/api/v1', campaigns_js_1.default);
app.use('/api/v1', item_master_js_1.default);
app.use('/api/v1', import_control_center_js_1.default);
app.use('/api/v1', events_js_1.publishMutationEvents);
app.use('/api/v1', transfer_logistics_js_1.default);
app.use('/api/v1', command_center_js_1.default);
// Mounted last so the prefixed routers above keep priority over its paths.
app.use('/api/v1', core_js_1.default);
app.use('/api/v1', catalog_procurement_js_1.default);
app.post('/api/v1/webhooks/marketplaces/:connectorId', async (req, res) => {
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
        const mapped = mapMarketplaceOrder(connector.platform, req.body ?? {});
        const invalid = validateNormalizedOrder(mapped);
        if (invalid) {
            res.status(400).json({ message: invalid });
            return;
        }
        const lines = [];
        for (const line of mapped.lines) {
            const item = (databaseEnabled ? await prisma.item.findFirst({ where: { OR: [{ code: line.sku }, { id: line.sku }] } }) : null)
                ?? listItems().find((entry) => entry.code === line.sku || entry.id === line.sku);
            if (item)
                lines.push({ itemId: item.id, quantity: line.quantity });
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
    }
    catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to ingest marketplace order.' });
    }
});
app.use('/api/v1', operations_extension_js_1.default);
// Last-resort boundary for unexpected errors. Route handlers may return
// user-friendly validation messages, but uncaught failures must never leak
// database details or stack traces to web/mobile clients.
app.use((error, req, res, _next) => {
    const requestId = res.locals.requestId ?? 'unknown';
    console.error('Unhandled API error', {
        requestId,
        method: req.method,
        path: req.originalUrl,
        error: error instanceof Error ? error.message : String(error),
    });
    if (res.headersSent)
        return;
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
        }
        else {
            console.log(`✅ ${loaded} users loaded successfully`);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The repo carries two older schemas that create a lowercase `users`
        // table. Prisma queries the canonical `User` model, so
        // importing one of those leaves logins failing with a bare 401.
        if (/doesn't exist|Unknown table|no such table/i.test(message)) {
            console.error('⚠️  The database is missing the tables this API expects.');
            console.error('    Prisma needs `User`, `Location`, `Item`, `Lot`, `StockLedger`,');
            console.error('    `StockCount`, `CountAssignment`, `Transfer`, `TransferLine`, `AuditLog`.');
            console.error('    A lowercase `users` table comes from database/schema.sql, which belongs');
            console.error('    to a different design and does not work with this API.');
            console.error('    Import invexaretail-database.sql, or run: npm run db:migrate && npm run db:seed');
            console.error(`    (${message})`);
        }
        else {
            console.error('Database connection failed:', error);
        }
    }
};
// The core inventory routes read from the in-memory repository, which serves
// seed data until this replaces it with the database contents.
const hydrateRepository = async () => {
    const { databaseEnabled, hydrateRepositoryFromDatabase, hydrateAuditFromDatabase, hydrateCompanyProfile } = await import('./lib/persistence.js');
    if (!databaseEnabled) {
        console.log('DATABASE_URL is not set; serving inventory from seed data instead of PostgreSQL.');
        const { seedEnhancedUsersForMemoryMode } = await import('./lib/enterprise-repository.js');
        const { seedUsers } = await import('./lib/seed.js');
        const { hashPassword } = await import('./lib/otp-auth.js');
        seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
        return;
    }
    const { ensureDailySyncSchema } = await import('./lib/runtime-schema.js');
    await ensureDailySyncSchema();
    await hydrateRepositoryFromDatabase();
    repositoryRefreshedAt = Date.now();
    try {
        const { hydrateControlPlaneFromStore } = await import('./lib/saas/persistence.js');
        const saas = await hydrateControlPlaneFromStore();
        if (saas === 'restored')
            console.log('✅ SaaS control plane restored from ControlPlaneState');
        else if (saas === 'seeded')
            console.log('✅ SaaS control plane seed saved to ControlPlaneState');
    }
    catch (error) {
        console.warn('SaaS control plane could not be hydrated; continuing with in-memory seed.', error instanceof Error ? error.message : error);
    }
    const { replaceAuditEvents } = await import('./lib/audit.js');
    // Company profile and audit history enhance the admin screens, but neither
    // may block login or branch hydration when an older Hostinger database has
    // not yet received those optional tables.
    try {
        await hydrateCompanyProfile();
    }
    catch (error) {
        console.warn('Company profile could not be hydrated; continuing with the default profile.', error instanceof Error ? error.message : error);
    }
    try {
        replaceAuditEvents(await hydrateAuditFromDatabase());
    }
    catch (error) {
        console.warn('Audit history could not be hydrated; continuing without historical audit entries.', error instanceof Error ? error.message : error);
    }
    try {
        const { hydrateCampaignsFromDatabase } = await import('./lib/campaign-persistence.js');
        await hydrateCampaignsFromDatabase();
    }
    catch (error) {
        console.warn('Stock-take campaigns could not be hydrated; continuing without them.', error instanceof Error ? error.message : error);
    }
    console.log('✅ Inventory repository hydrated from database');
};
const refreshRepositoryIfStale = async () => {
    const configuredInterval = Number(process.env.DATABASE_REFRESH_INTERVAL_MS ?? 30_000);
    // Committed domain events keep normal screens current. This broader refresh is only a reconciliation path for direct database imports or missed events.
    const refreshIntervalMs = Number.isFinite(configuredInterval) ? Math.max(5_000, configuredInterval) : 30_000;
    if (Date.now() - repositoryRefreshedAt < refreshIntervalMs)
        return;
    if (!repositoryRefreshInFlight) {
        repositoryRefreshInFlight = (async () => {
            try {
                const { databaseEnabled, hydrateRepositoryFromDatabase } = await import('./lib/persistence.js');
                if (databaseEnabled)
                    await hydrateRepositoryFromDatabase();
            }
            catch (error) {
                // A transient database read must not take down an otherwise usable
                // workspace. Keep serving the last good snapshot and retry later.
                console.warn('Database snapshot refresh failed; serving the last good snapshot.', error instanceof Error ? error.message : error);
            }
            finally {
                repositoryRefreshedAt = Date.now();
            }
        })().finally(() => {
            repositoryRefreshInFlight = null;
        });
    }
    await repositoryRefreshInFlight;
};
// Bind the HTTP port immediately for Hostinger, then keep API requests behind
// the hydration promise until PostgreSQL branches, users and stock are available.
const startServer = () => {
    authHydration = hydrateDatabase();
    startupHydration = (async () => {
        await authHydration;
        await hydrateRepository();
        repositoryHydrationState = 'ready';
        if (process.env.RUN_SCHEDULERS !== 'false') {
            const { startCampaignScheduler } = await import('./lib/campaign-scheduler.js');
            startCampaignScheduler();
            const { startOrderScheduler } = await import('./lib/order-scheduler.js');
            startOrderScheduler();
        }
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
    const shutdown = (signal) => {
        console.log(`${signal} received; closing the API server.`);
        server.close(async () => {
            try {
                const { flushControlPlanePersist } = await import('./lib/saas/persistence.js');
                await flushControlPlanePersist();
            }
            catch (error) {
                console.warn('SaaS control plane state could not be flushed on shutdown.', error instanceof Error ? error.message : error);
            }
            try {
                const { prisma } = await import('./lib/db.js');
                await prisma.$disconnect();
            }
            finally {
                process.exit(0);
            }
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
};
startServer();
