import { Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import collabRouter from './opext-collab.js';
import serialsRouter from './opext-serials.js';
import webhooksRouter from './opext-webhooks.js';
import { webhookDeliveriesRouter } from './opext-webhooks.js';
import rulesRouter from './opext-rules.js';
import expiryRouter from './opext-expiry.js';
import binsRouter from './opext-bins.js';
import { binStockRouter } from './opext-bins.js';
import qcExceptionsRouter from './opext-qc-exceptions.js';
import jobsRouter from './opext-jobs.js';
import intelligenceRouter from './opext-intelligence.js';
import ordersRouter from './opext-orders.js';
import returnsRouter from './opext-returns.js';
import platformRouter from './opext-platform.js';
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
