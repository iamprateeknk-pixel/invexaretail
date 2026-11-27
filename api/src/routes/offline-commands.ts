import { Router } from 'express';
import { operationalOfflineCommandSchema, operationalReplayRequest } from '../lib/offline-command-contract.js';
import { parseBody } from '../lib/validate.js';
import { extractToken, requireAuth } from './enterprise-auth.js';

const router = Router();

// This adapter runs before path-based operational middleware. Requests pass
// through the same tenant, policy and authorization checks as normal writes.
router.post('/sync/commands', extractToken, requireAuth, (req, res, next) => {
  const command = parseBody(req, res, operationalOfflineCommandSchema);
  if (command === null) return;
  const { path, body } = operationalReplayRequest(command);
  req.body = body;
  req.headers['x-mutation-id'] = command.commandId;
  req.originalUrl = `${req.baseUrl}${path}`;
  req.url = path;
  next();
});

export default router;
