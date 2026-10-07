// Release checklist (Web UX): Lot/Location/Transfer/Count/User 360. A thin route over lib/entity-360.ts.
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { databaseEnabled } from '../lib/persistence.js';
import { getEntity360, isEntity360Type, ENTITY_360_TYPES } from '../lib/entity-360.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

router.get('/entities/:type/:id/360', async (req: Request, res: Response) => {
  const type = String(req.params.type);
  if (!isEntity360Type(type)) return res.status(404).json({ message: `Unknown entity type. Use one of: ${ENTITY_360_TYPES.join(', ')}.` });
  if (!databaseEnabled) return res.status(501).json({ message: '360 views need the database.' });
  const entity = await getEntity360({ companyId: req.companyId ?? DEFAULT_COMPANY_ID, role: req.user!.role }, type, String(req.params.id));
  // A foreign company's id, a missing id and a user the caller may not view are all the same answer.
  if (!entity) return res.status(404).json({ message: 'Not found.' });
  return res.json({ entity });
});

export default router;
