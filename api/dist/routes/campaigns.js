"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const count_lifecycle_js_1 = require("../lib/count-lifecycle.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const campaign_store_js_1 = require("../lib/campaign-store.js");
const campaign_service_js_1 = require("../lib/campaign-service.js");
// Blueprint v4 §12: stock-take campaigns. Store users never see these
// endpoints - they simply receive the assignments a campaign creates.
const router = (0, express_1.Router)();
router.use('/campaigns', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, (req, res, next) => {
    if (!(0, count_lifecycle_js_1.canManageCountWork)(req.user.role)) {
        res.status(403).json({ message: 'Only admins and branch managers can manage stock-take campaigns.' });
        return;
    }
    next();
});
function companyOf(req) {
    return req.companyId ?? req.user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID;
}
// null = every location in the company (admin roles); otherwise the user's own.
function allowedLocations(req) {
    const role = req.user.role;
    return role === 'ADMIN' || role === 'ADMIN_USER' ? null : (req.user.locationIds ?? []);
}
function assertLocation(req, locationId) {
    const allowed = allowedLocations(req);
    if (allowed !== null && !allowed.includes(locationId))
        throw new campaign_service_js_1.CampaignError('This user cannot manage campaigns at that location.', 403);
}
function assertCampaignAccess(req) {
    const id = String(req.params.id ?? '');
    const campaign = (0, campaign_store_js_1.getCampaign)(id);
    if (!campaign || campaign.companyId !== companyOf(req))
        throw new campaign_service_js_1.CampaignError('Campaign was not found.', 404);
    assertLocation(req, campaign.locationId);
    return id;
}
const actorOf = (req) => ({ id: req.user.id, role: req.user.role });
function route(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        }
        catch (error) {
            if (error instanceof campaign_service_js_1.CampaignError) {
                res.status(error.status).json({ message: error.message });
                return;
            }
            console.error('Campaign request failed', error);
            res.status(500).json({ message: 'Unable to complete the campaign request.' });
        }
    };
}
router.get('/campaigns', route((req, res) => {
    res.json({ campaigns: (0, campaign_service_js_1.listCampaignSummaries)(companyOf(req), allowedLocations(req)) });
}));
router.post('/campaigns', route(async (req, res) => {
    assertLocation(req, typeof req.body?.locationId === 'string' ? req.body.locationId : '');
    const campaign = await (0, campaign_service_js_1.createCampaign)(req.body ?? {}, actorOf(req), companyOf(req));
    res.status(201).json({ campaign });
}));
router.get('/campaigns/:id', route(async (req, res) => {
    res.json(await (0, campaign_service_js_1.campaignDetail)(assertCampaignAccess(req), companyOf(req)));
}));
router.get('/campaigns/:id/items', route((req, res) => {
    const id = assertCampaignAccess(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json((0, campaign_service_js_1.campaignItemsView)(id, companyOf(req), typeof req.query.status === 'string' ? req.query.status : undefined, limit, offset));
}));
router.patch('/campaigns/:id', route(async (req, res) => {
    const campaign = await (0, campaign_service_js_1.updateCampaign)(assertCampaignAccess(req), req.body ?? {}, actorOf(req), companyOf(req));
    res.json({ campaign });
}));
router.post('/campaigns/:id/activate', route(async (req, res) => {
    res.json(await (0, campaign_service_js_1.activateCampaign)(assertCampaignAccess(req), actorOf(req), companyOf(req)));
}));
router.post('/campaigns/:id/pause', route(async (req, res) => {
    res.json({ campaign: await (0, campaign_service_js_1.pauseCampaign)(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));
router.post('/campaigns/:id/resume', route(async (req, res) => {
    res.json({ campaign: await (0, campaign_service_js_1.resumeCampaign)(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));
router.post('/campaigns/:id/cancel', route(async (req, res) => {
    res.json({ campaign: await (0, campaign_service_js_1.cancelCampaign)(assertCampaignAccess(req), actorOf(req), companyOf(req)) });
}));
router.post('/campaigns/:id/run', route(async (req, res) => {
    const result = await (0, campaign_service_js_1.runCampaignDay)(assertCampaignAccess(req), companyOf(req), { force: Boolean(req.body?.force), actor: actorOf(req) });
    res.json({ result });
}));
router.post('/campaigns/:id/reassign', route(async (req, res) => {
    const result = await (0, campaign_service_js_1.reassignWorkload)(assertCampaignAccess(req), req.body ?? {}, actorOf(req), companyOf(req));
    res.json({ result });
}));
exports.default = router;
