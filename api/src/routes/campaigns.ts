import { Router, type NextFunction, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { canManageCountWork } from '../lib/count-lifecycle.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { getCampaign } from '../lib/campaign-store.js';
import {
  CampaignError,
  activateCampaign,
  campaignDetail,
  campaignItemsView,
  cancelCampaign,
  createCampaign,
  listCampaignSummaries,
  pauseCampaign,
  reassignWorkload,
  resumeCampaign,
  runCampaignDay,
  updateCampaign,
} from '../lib/campaign-service.js';

// Blueprint v4 §12: stock-take campaigns. Store users never see these
// endpoints - they simply receive the assignments a campaign creates.
const router = Router();

router.use('/campaigns', extractToken, requireAuth, enforcePermissionOverrides, (req: Request, res: Response, next: NextFunction) => {
  if (!canManageCountWork(req.user!.role)) {
    res.status(403).json({ message: 'Only admins and branch managers can manage stock-take campaigns.' });
    return;
  }
  next();
});

function companyOf(req: Request): string {
  return req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID;
}

// null = every location in the company (admin roles); otherwise the user's own.
function allowedLocations(req: Request): string[] | null {
  const role = req.user!.role;
  return role === 'ADMIN' || role === 'ADMIN_USER' ? null : (req.user!.locationIds ?? []);
}

function assertLocation(req: Request, locationId: string): void {
  const allowed = allowedLocations(req);
  if (allowed !== null && !allowed.includes(locationId)) throw new CampaignError('This user cannot manage campaigns at that location.', 403);
}

function assertCampaignAccess(req: Request): string {
  const id = String(req.params.id ?? '');
  const campaign = getCampaign(id);
  if (!campaign || campaign.companyId !== companyOf(req)) throw new CampaignError('Campaign was not found.', 404);
  assertLocation(req, campaign.locationId);
  return id;
}

const actorOf = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

function route(handler: (req: Request, res: Response) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof CampaignError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      console.error('Campaign request failed', error);
      res.status(500).json({ message: 'Unable to complete the campaign request.' });
    }
  };
}

router.get('/campaigns', route((req, res) => {
  res.json({ campaigns: listCampaignSummaries(companyOf(req), allowedLocations(req)) });
}));

router.post('/campaigns', route(async (req, res) => {
  assertLocation(req, typeof req.body?.locationId === 'string' ? req.body.locationId : '');
  const campaign = await createCampaign(req.body ?? {}, actorOf(req), companyOf(req));
  res.status(201).json({ campaign });
}));

router.get('/campaigns/:id', route(async (req, res) => {
  res.json(await campaignDetail(assertCampaignAccess(req), companyOf(req)));
}));

router.get('/campaigns/:id/items', route((req, res) => {
  const id = assertCampaignAccess(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(campaignItemsView(id, companyOf(req), typeof req.query.status === 'string' ? req.query.status : undefined, limit, offset));
}));

router.patch('/campaigns/:id', route(async (req, res) => {
  const campaign = await updateCampaign(assertCampaignAccess(req), req.body ?? {}, actorOf(req), companyOf(req));
  res.json({ campaign });
}));

router.post('/campaigns/:id/activate', route(async (req, res) => {
  res.json(await activateCampaign(assertCampaignAccess(req), actorOf(req), companyOf(req)));
}));

router.post('/campaigns/:id/pause', route(async (req, res) => {
  res.json({ campaign: await pauseCampaign(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));

router.post('/campaigns/:id/resume', route(async (req, res) => {
  res.json({ campaign: await resumeCampaign(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));

router.post('/campaigns/:id/cancel', route(async (req, res) => {
  res.json({ campaign: await cancelCampaign(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));

router.post('/campaigns/:id/run', route(async (req, res) => {
  const result = await runCampaignDay(assertCampaignAccess(req), companyOf(req), { force: Boolean(req.body?.force), actor: actorOf(req) });
  res.json({ result });
}));

router.post('/campaigns/:id/reassign', route(async (req, res) => {
  const result = await reassignWorkload(assertCampaignAccess(req), req.body ?? {}, actorOf(req), companyOf(req));
  res.json({ result });
}));

export default router;
