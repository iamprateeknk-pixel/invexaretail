import { Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
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
import platformRouter from './opext-platform.ts';
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

router.use(platformRouter);

router.use(webhookDeliveriesRouter);

export default router;
