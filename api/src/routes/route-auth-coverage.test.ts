import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Router } from 'express';
import { hashPassword } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import coreRouter from './core.js';
import transfersRouter from './transfers.js';
import branchesRouter from './branches.js';
import itemsRouter from './items.js';
import bundlesRouter from './bundles.js';
import transferEvidenceRouter from './transfer-evidence.js';
import transferLabelsRouter from './transfer-labels.js';
import importsRouter from './imports.js';
import reportsRouter from './reports.js';
import catalogProcurementRouter from './catalog-procurement.js';
import operationsExtensionRouter from './operations-extension.js';
import campaignsRouter from './campaigns.js';
import itemMasterRouter from './item-master.js';
import importControlCenterRouter from './import-control-center.js';
import transferLogisticsRouter from './transfer-logistics.js';
import commandCenterRouter from './command-center.js';

// Security review (blueprint §35 and Appendix C "API authorization tests pass"):
// every route these routers register must refuse a caller with no credentials.
// The routes below are the ones that are meant to be reachable without a
// session; anything else that answers a token-less request is a hole.
const PUBLIC: string[] = [];

type Probe = { method: string; path: string };

function collect(router: Router): Probe[] {
  const found: Probe[] = [];
  for (const layer of (router as unknown as { stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> } }> }).stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      for (const method of Object.keys(layer.route.methods)) found.push({ method: method.toUpperCase(), path });
    }
  }
  return found;
}

const fill = (path: string) => path.replace(/:[A-Za-z]+\??/g, 'probe').replace(/\*/g, 'probe');

test('no route on the operational routers answers a request that carries no credentials', async () => {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword('x'));
  const routers: Array<[string, Router]> = [
    ['core', coreRouter], ['transfers', transfersRouter], ['branches', branchesRouter], ['items', itemsRouter], ['bundles', bundlesRouter], ['transfer-evidence', transferEvidenceRouter], ['transfer-labels', transferLabelsRouter], ['imports', importsRouter], ['reports', reportsRouter], ['catalog-procurement', catalogProcurementRouter], ['operations-extension', operationsExtensionRouter],
    ['campaigns', campaignsRouter], ['item-master', itemMasterRouter], ['import-control-center', importControlCenterRouter],
    ['transfer-logistics', transferLogisticsRouter], ['command-center', commandCenterRouter],
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  for (const [, router] of routers) app.use('/api/v1', router);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  const base = `http://127.0.0.1:${address.port}/api/v1`;

  const open: string[] = [];
  let probed = 0;
  try {
    for (const [name, router] of routers) {
      for (const probe of collect(router)) {
        if (PUBLIC.includes(`${probe.method} ${probe.path}`)) continue;
        probed += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          const response = await fetch(`${base}${fill(probe.path)}`, {
            method: probe.method, signal: controller.signal,
            headers: probe.method === 'GET' || probe.method === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
            body: probe.method === 'GET' || probe.method === 'DELETE' ? undefined : '{}',
          });
          await response.arrayBuffer().catch(() => undefined);
          if (response.status !== 401 && response.status !== 403) open.push(`${name}: ${probe.method} ${probe.path} -> ${response.status}`);
        } catch (error) {
          open.push(`${name}: ${probe.method} ${probe.path} -> ${error instanceof Error ? error.name : 'error'}`);
        } finally {
          clearTimeout(timer);
        }
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.ok(probed > 200, `expected to probe the whole API surface, only reached ${probed} routes`);
  assert.deepEqual(open, [], `routes reachable without credentials:\n${open.join('\n')}`);
});
