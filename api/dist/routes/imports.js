"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Week 11: the staged import lifecycle's HTTP surface - thin routes over
// lib/import-commit-service.ts, continuing the Week 8/10 extraction
// pattern. Commit is fire-and-forget from the request's point of view: it
// queues the batch and returns immediately - lib/import-worker.ts's
// background poll loop (or, in tests, commitImportBatchToCompletion)
// does the actual posting, so a 5,000+ row file never holds an HTTP
// request open.
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const import_checksum_js_1 = require("../lib/import-checksum.js");
const import_commit_service_js_1 = require("../lib/import-commit-service.js");
const import_worker_js_1 = require("../lib/import-worker.js");
const db_js_1 = require("../lib/db.js");
const router = (0, express_1.Router)();
router.use(enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides);
function firstParam(value) {
    return Array.isArray(value) ? value[0] : (value ?? '');
}
function tenantContextFor(req) {
    return {
        companyId: req.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID,
        userId: req.user.id,
        role: req.user.role,
    };
}
const IMPORT_TYPES = new Set(['PURCHASE', 'SALES', 'SALES_RETURN', 'OPENING_STOCK']);
router.post('/imports/staged/batches', async (req, res) => {
    const ctx = tenantContextFor(req);
    const { type, fileName, sourceFormat, rows } = req.body;
    if (!type || !IMPORT_TYPES.has(type)) {
        return res.status(400).json({ message: `type must be one of ${[...IMPORT_TYPES].join(', ')}.` });
    }
    if (!fileName || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: 'fileName and a non-empty rows array are required.' });
    }
    const checksum = (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows));
    try {
        const batch = await (0, import_commit_service_js_1.createImportBatch)(ctx, {
            type: type,
            fileName,
            sourceFormat: sourceFormat ?? 'json',
            fileChecksum: checksum,
            rows,
            importedById: ctx.userId,
        });
        return res.status(201).json({ batch, duplicate: false });
    }
    catch (error) {
        if (error instanceof import_commit_service_js_1.DuplicateFileError) {
            const existing = await db_js_1.prisma.importBatch.findUnique({ where: { id: error.existingBatchId } });
            return res.status(200).json({ batch: existing, duplicate: true });
        }
        throw error;
    }
});
router.post('/imports/staged/batches/:id/validate', async (req, res) => {
    const ctx = tenantContextFor(req);
    try {
        const summary = await (0, import_commit_service_js_1.validateImportBatch)(ctx, firstParam(req.params.id));
        return res.json(summary);
    }
    catch (error) {
        if (error instanceof import_commit_service_js_1.BatchNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof import_commit_service_js_1.InvalidBatchStateError)
            return res.status(409).json({ message: error.message });
        throw error;
    }
});
router.post('/imports/staged/batches/:id/commit', async (req, res) => {
    const ctx = tenantContextFor(req);
    const batchId = firstParam(req.params.id);
    try {
        await (0, import_commit_service_js_1.queueImportBatchForCommit)(ctx, batchId);
    }
    catch (error) {
        if (error instanceof import_commit_service_js_1.BatchNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof import_commit_service_js_1.InvalidBatchStateError)
            return res.status(409).json({ message: error.message });
        throw error;
    }
    // Kick the worker immediately rather than waiting for its next poll tick
    // - the request still returns right away, this just avoids an idle wait
    // in the common case where the worker's poll interval hasn't elapsed yet.
    void (0, import_worker_js_1.drainImportCommitsOnce)().catch((error) => console.error('[imports] immediate drain failed', error));
    return res.status(202).json({ queued: true });
});
router.get('/imports/staged/batches/:id', async (req, res) => {
    const ctx = tenantContextFor(req);
    const batch = await db_js_1.prisma.importBatch.findFirst({ where: { id: firstParam(req.params.id), companyId: ctx.companyId } });
    if (!batch)
        return res.status(404).json({ message: 'Import batch was not found.' });
    return res.json({ batch });
});
router.get('/imports/staged/batches/:id/failures', async (req, res) => {
    const ctx = tenantContextFor(req);
    try {
        const rows = await (0, import_commit_service_js_1.exportFailedRows)(ctx, firstParam(req.params.id));
        return res.json({ rows });
    }
    catch (error) {
        if (error instanceof import_commit_service_js_1.BatchNotFoundError)
            return res.status(404).json({ message: error.message });
        throw error;
    }
});
router.post('/imports/staged/batches/:id/reverse', async (req, res) => {
    const ctx = tenantContextFor(req);
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Manual import reversal';
    try {
        await (0, import_commit_service_js_1.reverseImportBatch)(ctx, firstParam(req.params.id), reason);
        return res.json({ reversed: true });
    }
    catch (error) {
        if (error instanceof import_commit_service_js_1.BatchNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof import_commit_service_js_1.InvalidBatchStateError)
            return res.status(409).json({ message: error.message });
        throw error;
    }
});
exports.default = router;
