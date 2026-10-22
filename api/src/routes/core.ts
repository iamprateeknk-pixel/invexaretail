import { Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import catalogRouter from './core-catalog.js';
import { itemPhotosRouter } from './core-catalog.js';
import insightsRouter from './core-insights.js';
import { syncStatusRouter, insightsReportsRouter } from './core-insights.js';
import identityRouter from './core-identity.js';
import pickingRouter from './core-picking.js';
import { pickerTasksRouter } from './core-picking.js';
import countsRouter from './core-counts.js';
import importsRouter from './core-imports.js';
import { importsIntakeRouter } from './core-imports.js';
export { planStockUpdate } from './core-imports.js';

const router = Router();

router.use(extractToken, requireAuth, enforcePermissionOverrides);

router.use(identityRouter);

router.use(catalogRouter);

router.use(countsRouter);

router.use(pickingRouter);

router.use(insightsRouter);

router.use(importsRouter);

router.use(syncStatusRouter);

router.use(importsIntakeRouter);

router.use(itemPhotosRouter);

router.use(pickerTasksRouter);

router.use(insightsReportsRouter);

export default router;
