"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const audit_js_1 = require("../lib/audit.js");
const exceptions_js_1 = require("../lib/exceptions.js");
const transfer_lifecycle_js_1 = require("../lib/transfer-lifecycle.js");
const inventory_js_1 = require("../lib/inventory.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const repository_js_1 = require("../lib/repository.js");
const persistence_js_1 = require("../lib/persistence.js");
const transfer_packing_js_1 = require("../lib/transfer-packing.js");
// Blueprint v4 §16 Packing, §17 Dispatch/Transit. Stock leaves the source at
// /transfers/:id/confirm (existing); packing then re-verifies what is being
// shipped carton by carton, and dispatch records who carries it and when it is
// due. Both are refused until the step before them is genuinely complete.
const router = (0, express_1.Router)();
const guard = [enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth];
const PACK_STATUSES = ['READY_FOR_ADMIN', 'PARTIAL', 'CONFIRMED'];
const PACKERS = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'];
function canAccess(req, locationId) {
    const user = req.user;
    if (user.companyId && !(0, tenant_scope_js_1.companyOwnsLocation)(user.companyId, locationId))
        return false;
    if (user.role === 'ADMIN' || user.role === 'ADMIN_USER')
        return true;
    return (user.locationIds ?? []).includes(locationId);
}
async function pickedLines(transfer) {
    const slips = persistence_js_1.databaseEnabled
        ? await (0, persistence_js_1.loadTransferPickSlips)(transfer.id)
        : (0, audit_js_1.listAuditEvents)().filter((event) => event.entityType === 'Transfer' && event.entityId === transfer.id && event.action === 'PICK_SLIP_SAVED');
    const byKey = new Map();
    for (const slip of slips) {
        for (const line of (slip.metadata?.lines ?? [])) {
            const key = `${line.itemId}|${line.lotId}`;
            const current = byKey.get(key) ?? { itemId: line.itemId, lotId: line.lotId, requestedQty: 0 };
            current.requestedQty += Number(line.quantity ?? 0);
            byKey.set(key, current);
        }
    }
    if (byKey.size)
        return [...byKey.values()].filter((line) => line.requestedQty > 0);
    // No pick slip yet: what was requested is what must go in the cartons.
    return transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity }));
}
function summarize(cartons) {
    return cartons.map((carton) => ({
        id: carton.id, cartonNumber: carton.cartonNumber, packageId: carton.packageId, quantity: carton.quantity,
        weightKg: carton.weightKg, status: carton.status, sealedAt: carton.sealedAt, packedById: carton.packedById, lines: carton.lines,
    }));
}
async function packState(transfer) {
    const expected = await pickedLines(transfer);
    const cartons = (0, repository_js_1.listTransferCartons)(transfer.id);
    const verification = (0, transfer_packing_js_1.verifyTransferPacking)(expected, cartons);
    return {
        transferId: transfer.id,
        status: transfer.status,
        expected,
        cartons: summarize(cartons),
        verification,
        packingComplete: Boolean(transfer.packing),
        packing: transfer.packing,
        canComplete: verification.readyToSeal && !transfer.packing,
    };
}
function lookup(req, res) {
    const transfer = (0, repository_js_1.listTransfers)().find((record) => record.id === String(req.params.transferId));
    if (!transfer || (!canAccess(req, transfer.sourceLocationId) && !canAccess(req, transfer.destinationLocationId))) {
        res.status(404).json({ message: 'Transfer was not found.' });
        return undefined;
    }
    return transfer;
}
function requirePacker(req, res, transfer) {
    if (!PACKERS.includes(req.user.role) || !canAccess(req, transfer.sourceLocationId)) {
        res.status(403).json({ message: 'Only the source branch packing team can pack this transfer.' });
        return false;
    }
    return true;
}
router.get('/transfers/:transferId/pack', ...guard, async (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer)
        return;
    if (!PACKERS.includes(req.user.role) && req.user.role !== 'AUDITOR')
        return res.status(403).json({ message: 'Packing access denied.' });
    return res.json(await packState(transfer));
});
router.post('/transfers/:transferId/cartons', ...guard, async (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer || !requirePacker(req, res, transfer))
        return;
    if (!PACK_STATUSES.includes(transfer.status))
        return res.status(409).json({ message: `A transfer in ${transfer.status} cannot be packed.` });
    if (transfer.packing)
        return res.status(409).json({ message: 'Packing is already complete for this transfer.' });
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim().slice(0, 191) : '';
    if (requestId) {
        const prior = (0, repository_js_1.listTransferCartons)(transfer.id).find((carton) => carton.requestId === requestId);
        if (prior)
            return res.json({ success: true, duplicate: true, carton: summarize([prior])[0], ...(await packState(transfer)) });
    }
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!rawLines.length)
        return res.status(400).json({ message: 'Add at least one item to the carton.' });
    const catalog = new Map((0, repository_js_1.listItems)().map((item) => [item.id, item]));
    const lines = [];
    for (const raw of rawLines) {
        const quantity = Number(raw.quantity);
        const itemId = String(raw.itemId ?? '');
        const lotId = String(raw.lotId ?? '');
        if (!itemId || !lotId || !Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({ message: 'Every carton line needs an item, a lot and a positive quantity.' });
        }
        const item = catalog.get(itemId);
        if (item && !item.decimalQuantity && item.countMethod !== 'ITEM_WEIGHT' && !Number.isInteger(quantity)) {
            return res.status(400).json({ message: `${item.code} is packed in whole units.` });
        }
        lines.push({ itemId, lotId, quantity: Math.round(quantity * 1000) / 1000 });
    }
    const weightKg = req.body?.weightKg === undefined || req.body.weightKg === '' ? undefined : Number(req.body.weightKg);
    if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0))
        return res.status(400).json({ message: 'Carton weight must be a positive number.' });
    const expected = await pickedLines(transfer);
    const existing = (0, repository_js_1.listTransferCartons)(transfer.id);
    const mismatches = (0, transfer_packing_js_1.checkCartonLines)(expected, existing, lines);
    if (mismatches.length) {
        // "Mismatch creates exception; cannot silently seal."
        void (0, exceptions_js_1.createExceptionCase)({
            type: 'TRANSFER_DISCREPANCY',
            title: `Pack mismatch on transfer ${transfer.id}`,
            description: mismatches.map((row) => `${row.itemId}/${row.lotId}: ${row.kind === 'OVER' ? `${row.quantity} packed, only ${row.remaining} left to pack` : `${row.quantity} packed but not on this transfer`}`).join('; '),
            locationId: transfer.sourceLocationId, sourceDocument: transfer.id, reportedById: req.user.id,
            companyId: req.user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        });
        return res.status(409).json({ message: 'This carton does not match what was picked for the transfer, so it was not sealed. A discrepancy case was opened.', mismatches });
    }
    const number = (0, transfer_packing_js_1.nextCartonNumber)(existing);
    const carton = {
        id: `carton-${(0, node_crypto_1.randomUUID)()}`, transferId: transfer.id, cartonNumber: String(number), packageId: (0, transfer_packing_js_1.packageIdFor)(transfer.id, number),
        lines, quantity: Math.round(lines.reduce((sum, line) => sum + line.quantity, 0) * 1000) / 1000, weightKg,
        status: 'SEALED', packedById: req.user.id, sealedAt: new Date().toISOString(), requestId: requestId || undefined,
    };
    (0, repository_js_1.addTransferCarton)(carton);
    await (0, persistence_js_1.persistTransferCarton)(carton);
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({ actorId: req.user.id, actorRole: req.user.role, action: 'TRANSFER_CARTON_SEALED', entityType: 'Transfer', entityId: transfer.id, metadata: { packageId: carton.packageId, quantity: carton.quantity, weightKg } }));
    return res.status(201).json({ success: true, carton: summarize([carton])[0], ...(await packState(transfer)) });
});
router.post('/transfers/:transferId/cartons/:cartonId/void', ...guard, async (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer || !requirePacker(req, res, transfer))
        return;
    if (transfer.packing)
        return res.status(409).json({ message: 'Packing is already complete; it cannot be changed.' });
    const carton = (0, repository_js_1.listTransferCartons)(transfer.id).find((row) => row.id === String(req.params.cartonId));
    if (!carton)
        return res.status(404).json({ message: 'Carton was not found.' });
    const voided = (0, repository_js_1.setTransferCartonStatus)(carton.id, 'VOID');
    await (0, persistence_js_1.persistTransferCarton)(voided);
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({ actorId: req.user.id, actorRole: req.user.role, action: 'TRANSFER_CARTON_VOIDED', entityType: 'Transfer', entityId: transfer.id, metadata: { packageId: carton.packageId } }));
    return res.json({ success: true, ...(await packState(transfer)) });
});
router.post('/transfers/:transferId/pack/complete', ...guard, async (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer || !requirePacker(req, res, transfer))
        return;
    if (!PACK_STATUSES.includes(transfer.status))
        return res.status(409).json({ message: `A transfer in ${transfer.status} cannot be packed.` });
    if (transfer.packing)
        return res.json({ success: true, duplicate: true, ...(await packState(transfer)) });
    const state = await packState(transfer);
    if (!state.verification.readyToSeal) {
        void (0, exceptions_js_1.createExceptionCase)({
            type: 'TRANSFER_DISCREPANCY',
            title: `Packing incomplete on transfer ${transfer.id}`,
            description: state.verification.lines.filter((line) => line.status !== 'MATCHED').map((line) => `${line.itemId}/${line.lotId}: packed ${line.scannedQty} of ${line.requestedQty}`).join('; '),
            locationId: transfer.sourceLocationId, sourceDocument: transfer.id, reportedById: req.user.id,
            companyId: req.user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        });
        return res.status(409).json({ message: 'Every picked line must be fully packed into sealed cartons before packing can be completed.', ...state });
    }
    const cartonCount = (0, transfer_packing_js_1.activeCartons)((0, repository_js_1.listTransferCartons)(transfer.id)).length;
    const updated = (0, repository_js_1.setTransferLogistics)(transfer.id, { cartonCount, packing: { completedAt: new Date().toISOString(), completedById: req.user.id, cartonCount } });
    await (0, persistence_js_1.persistTransferLogistics)(updated);
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({ actorId: req.user.id, actorRole: req.user.role, action: 'TRANSFER_PACKED', entityType: 'Transfer', entityId: transfer.id, metadata: { cartonCount } }));
    return res.json({ success: true, ...(await packState(updated)) });
});
router.post('/transfers/:transferId/dispatch', ...guard, async (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer)
        return;
    if (!(0, transfer_lifecycle_js_1.canManageTransferDispatch)(req.user.role) || !canAccess(req, transfer.sourceLocationId)) {
        return res.status(403).json({ message: 'Only admins and the source branch manager can dispatch a transfer.' });
    }
    if (transfer.dispatch && ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(transfer.status)) {
        return res.json({ success: true, duplicate: true, transfer });
    }
    if (transfer.status !== 'CONFIRMED')
        return res.status(409).json({ message: `Confirm the pick and deduct source stock first; this transfer is ${transfer.status}.` });
    if (!transfer.packing)
        return res.status(409).json({ message: 'Complete packing (every line in a sealed carton) before dispatching.' });
    let details;
    try {
        details = (0, transfer_packing_js_1.parseDispatchDetails)(req.body ?? {});
        (0, inventory_js_1.validateTransferStatusChange)(req.user.role, transfer.status, 'DISPATCHED');
    }
    catch (error) {
        return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid dispatch details.' });
    }
    (0, repository_js_1.updateTransferStatus)(transfer.id, 'DISPATCHED');
    const updated = (0, repository_js_1.setTransferLogistics)(transfer.id, { dispatch: { dispatchedAt: new Date().toISOString(), dispatchedById: req.user.id, ...details } });
    await (0, persistence_js_1.persistTransferStatus)(updated);
    await (0, persistence_js_1.persistTransferLogistics)(updated);
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({ actorId: req.user.id, actorRole: req.user.role, action: 'TRANSFER_DISPATCHED', entityType: 'Transfer', entityId: transfer.id, metadata: { ...details } }));
    return res.json({ success: true, transfer: updated });
});
router.get('/transfers/:transferId/tracking', ...guard, (req, res) => {
    const transfer = lookup(req, res);
    if (!transfer)
        return;
    const cartons = (0, transfer_packing_js_1.activeCartons)((0, repository_js_1.listTransferCartons)(transfer.id));
    return res.json({
        transferId: transfer.id,
        status: transfer.status,
        sourceLocationId: transfer.sourceLocationId,
        destinationLocationId: transfer.destinationLocationId,
        packing: transfer.packing,
        dispatch: transfer.dispatch,
        expectedArrivalAt: transfer.dispatch?.expectedArrivalAt,
        delayed: (0, transfer_packing_js_1.isTransitDelayed)({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
        cartons: cartons.map((carton) => ({ packageId: carton.packageId, quantity: carton.quantity, weightKg: carton.weightKg })),
    });
});
// Blueprint §18: "Scan transfer/carton -> load expected lines". A carton's
// package id (its label / QR) leads to its transfer, for the destination.
router.get('/transfers/by-package/:packageId', ...guard, (req, res) => {
    const wanted = String(req.params.packageId).trim().toLowerCase();
    const carton = (0, repository_js_1.listTransferCartons)().find((row) => row.status === 'SEALED' && row.packageId.toLowerCase() === wanted);
    const transfer = carton && (0, repository_js_1.listTransfers)().find((record) => record.id === carton.transferId);
    if (!transfer || (!canAccess(req, transfer.destinationLocationId) && !canAccess(req, transfer.sourceLocationId))) {
        return res.status(404).json({ message: 'No transfer carton matches that code.' });
    }
    return res.json({ transfer, packageId: carton.packageId });
});
exports.default = router;
