"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCheckpoints = exports.dailyMovements = exports.users = exports.stockMovements = exports.countAssignments = exports.stockLedger = exports.transfers = exports.counts = exports.items = exports.locations = exports.companyProfile = void 0;
exports.getCompanyProfile = getCompanyProfile;
exports.setCompanyProfile = setCompanyProfile;
exports.findUserById = findUserById;
exports.listUsers = listUsers;
exports.findStockLedgerEntry = findStockLedgerEntry;
exports.listStockLedgerForLocation = listStockLedgerForLocation;
exports.listStockLedger = listStockLedger;
exports.adjustStockLedger = adjustStockLedger;
exports.adjustQuarantineLedger = adjustQuarantineLedger;
exports.listLocations = listLocations;
exports.listItems = listItems;
exports.createItemRecord = createItemRecord;
exports.upsertItemRecord = upsertItemRecord;
exports.ensureLotRecord = ensureLotRecord;
exports.updateLotStatus = updateLotStatus;
exports.updateLotExpiry = updateLotExpiry;
exports.recordDailyMovement = recordDailyMovement;
exports.listDailyMovements = listDailyMovements;
exports.upsertSyncCheckpoint = upsertSyncCheckpoint;
exports.listSyncCheckpoints = listSyncCheckpoints;
exports.createCountRecord = createCountRecord;
exports.listCounts = listCounts;
exports.createTransferRecord = createTransferRecord;
exports.listStockMovements = listStockMovements;
exports.updateCountReview = updateCountReview;
exports.findPendingCountForLot = findPendingCountForLot;
exports.findAssignmentForCount = findAssignmentForCount;
exports.createCountAssignment = createCountAssignment;
exports.createRecountAssignment = createRecountAssignment;
exports.updateCountAssignment = updateCountAssignment;
exports.listCountAssignments = listCountAssignments;
exports.listCountAssignmentsFor = listCountAssignmentsFor;
exports.findActiveAssignment = findActiveAssignment;
exports.markAssignmentSubmitted = markAssignmentSubmitted;
exports.updateTransferStatus = updateTransferStatus;
exports.updateTransferReceiptProgress = updateTransferReceiptProgress;
exports.listTransfers = listTransfers;
const seed_js_1 = require("./seed.js");
// Single-tenant: one profile for the whole deployment, not one per company.
exports.companyProfile = { name: 'InvexaRetail', industry: 'Grocery', industryKey: 'grocery' };
function getCompanyProfile() {
    return { ...exports.companyProfile };
}
function setCompanyProfile(update) {
    Object.assign(exports.companyProfile, update);
    return { ...exports.companyProfile };
}
exports.locations = [...seed_js_1.seedLocations];
exports.items = [...seed_js_1.seedItems];
exports.counts = [...seed_js_1.seedCounts];
exports.transfers = [...seed_js_1.seedTransfers];
exports.stockLedger = [...seed_js_1.seedStockLedger];
exports.countAssignments = [];
exports.stockMovements = [];
exports.users = seed_js_1.seedUsers.map((user) => ({ id: user.id, email: user.email, name: user.name, role: user.role, assignedLocationIds: user.assignedLocationIds }));
exports.dailyMovements = [];
exports.syncCheckpoints = [];
function findUserById(id) {
    return exports.users.find((user) => user.id === id);
}
function listUsers() {
    return [...exports.users];
}
function findStockLedgerEntry(itemId, lotId, locationId) {
    return exports.stockLedger.find((row) => row.itemId === itemId && row.lotId === lotId && row.locationId === locationId);
}
function listStockLedgerForLocation(locationId) {
    return exports.stockLedger.filter((row) => row.locationId === locationId).map((row) => ({ ...row }));
}
function listStockLedger() {
    return exports.stockLedger.map((row) => ({ ...row }));
}
function findOrCreateStockLedgerRow(itemId, lotId, locationId) {
    let row = exports.stockLedger.find((entry) => entry.itemId === itemId && entry.lotId === lotId && entry.locationId === locationId);
    if (!row) {
        row = { itemId, lotId, locationId, onHand: 0, quarantine: 0, version: 0 };
        exports.stockLedger.push(row);
    }
    return row;
}
/** Applies a signed delta to on-hand quantity, creating the row if it does not exist yet. Not safe for concurrent callers within one process tick. */
function adjustStockLedger(itemId, lotId, locationId, delta) {
    const row = findOrCreateStockLedgerRow(itemId, lotId, locationId);
    row.onHand += delta;
    row.version += 1;
    return { ...row };
}
/**
 * Applies a signed delta to the quarantine bucket - damaged/rejected stock
 * that is physically present but not sellable (blueprint section 7.2).
 * A positive delta receives stock into quarantine (e.g. a damaged receiving
 * line); a negative delta releases it out (an Exception Inbox disposition:
 * back to on-hand, or removed entirely for destroy/vendor-return).
 */
function adjustQuarantineLedger(itemId, lotId, locationId, delta) {
    const row = findOrCreateStockLedgerRow(itemId, lotId, locationId);
    row.quarantine = Math.max(0, row.quarantine + delta);
    row.version += 1;
    return { ...row };
}
function listLocations() {
    return [...exports.locations];
}
function listItems() {
    return exports.items.map((item) => ({
        ...item,
        lots: [...item.lots],
    }));
}
function createItemRecord(input) {
    const itemId = `item-${Math.random().toString(36).slice(2, 8)}`;
    const lotId = `lot-${Math.random().toString(36).slice(2, 8)}`;
    const item = {
        id: itemId,
        code: input.code,
        name: input.name,
        category: input.category,
        subcategory: input.subcategory,
        company: input.company,
        unit: input.unit,
        countMethod: input.countMethod,
        pickMethod: input.pickMethod,
        allocationStrategy: input.allocationStrategy,
        lotRequired: input.lotRequired,
        expiryRequired: input.expiryRequired,
        decimalQuantity: input.decimalQuantity,
        lots: [{ id: lotId, itemId, lotNo: 'LOT-DEFAULT', expiryDate: null, attributes: { source: 'created' } }],
    };
    exports.items.push(item);
    return { ...item, lots: [...item.lots] };
}
function upsertItemRecord(input) {
    const existing = exports.items.find((item) => item.code.trim().toLowerCase() === input.code.trim().toLowerCase());
    if (existing) {
        existing.name = input.name;
        existing.category = input.category;
        existing.subcategory = input.subcategory;
        existing.company = input.company;
        existing.unit = input.unit;
        return { item: { ...existing, lots: [...existing.lots] }, created: false };
    }
    return { item: createItemRecord(input), created: true };
}
function ensureLotRecord(itemId, lotNo, expiryDate, attributes, id) {
    const item = exports.items.find((entry) => entry.id === itemId);
    if (!item)
        throw new Error('Item was not found.');
    const existing = item.lots.find((lot) => lot.lotNo.trim().toLowerCase() === lotNo.trim().toLowerCase());
    if (existing)
        return { ...existing };
    const lot = { id: id ?? `lot-${Math.random().toString(36).slice(2, 10)}`, itemId, lotNo, expiryDate: expiryDate ?? null, status: 'AVAILABLE', attributes };
    item.lots.push(lot);
    return { ...lot };
}
function updateLotStatus(lotId, status) {
    for (const item of exports.items) {
        const lot = item.lots.find((entry) => entry.id === lotId);
        if (!lot)
            continue;
        lot.status = status;
        return { ...lot };
    }
    throw new Error('Lot was not found.');
}
function updateLotExpiry(lotId, expiryDate) {
    for (const item of exports.items) {
        const lot = item.lots.find((entry) => entry.id === lotId);
        if (!lot)
            continue;
        lot.expiryDate = expiryDate;
        return { ...lot };
    }
    throw new Error('Lot was not found.');
}
function recordDailyMovement(input) { exports.dailyMovements.push(input); return { ...input }; }
function listDailyMovements() { return exports.dailyMovements.map((entry) => ({ ...entry })); }
function upsertSyncCheckpoint(input) { const current = exports.syncCheckpoints.find((entry) => entry.locationId === input.locationId && entry.sourceType === input.sourceType); if (current)
    Object.assign(current, input);
else
    exports.syncCheckpoints.push(input); return { ...input }; }
function listSyncCheckpoints() { return exports.syncCheckpoints.map((entry) => ({ ...entry })); }
function createCountRecord(input) {
    const record = { status: 'PENDING_REVIEW', ...input };
    exports.counts.push(record);
    return { ...record };
}
function listCounts() {
    return [...exports.counts];
}
function createTransferRecord(input) {
    exports.transfers.push(input);
    return { ...input, lines: input.lines.map((line) => ({ ...line })) };
}
function makeMovementId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function listStockMovements(filter) {
    return exports.stockMovements
        .filter((movement) => {
        if (filter?.itemId && movement.itemId !== filter.itemId)
            return false;
        if (filter?.locationId && movement.locationId !== filter.locationId)
            return false;
        if (filter?.sourceDocument && movement.sourceDocument !== filter.sourceDocument)
            return false;
        return true;
    })
        .map((movement) => ({ ...movement }));
}
function updateCountReview(id, status, reviewedBy, reviewReason) {
    const count = exports.counts.find((record) => record.id === id);
    if (!count)
        throw new Error('Stock count was not found.');
    if (count.status !== 'PENDING_REVIEW')
        throw new Error(`Count is already ${count.status} and cannot be reviewed again.`);
    count.status = status;
    count.reviewedBy = reviewedBy;
    count.reviewedAt = new Date().toISOString();
    if (reviewReason)
        count.reviewReason = reviewReason;
    if (status === 'APPROVED') {
        const variance = count.physicalQuantity - count.bookQty;
        const before = findStockLedgerEntry(count.itemId, count.lotId, count.locationId)?.onHand ?? count.bookQty;
        adjustStockLedger(count.itemId, count.lotId, count.locationId, variance);
        const after = before + variance;
        const movement = {
            id: makeMovementId('mv'),
            itemId: count.itemId,
            lotId: count.lotId,
            locationId: count.locationId,
            movementType: 'COUNT_VARIANCE',
            qtyDelta: variance,
            beforeBalance: before,
            afterBalance: after,
            sourceDocument: count.id,
            sourceLineId: count.id,
            actor: reviewedBy,
            timestamp: count.reviewedAt,
            correlationId: count.id,
            reason: reviewReason,
            metadata: { countId: count.id, physicalQuantity: count.physicalQuantity, bookQty: count.bookQty },
        };
        exports.stockMovements.push(movement);
        count.varianceMovementId = movement.id;
    }
    return { ...count };
}
function findPendingCountForLot(userId, itemId, lotId, locationId) {
    return exports.counts.find((count) => count.submittedBy === userId
        && count.itemId === itemId
        && count.lotId === lotId
        && count.locationId === locationId
        && (count.status ?? 'PENDING_REVIEW') === 'PENDING_REVIEW');
}
function findAssignmentForCount(countId) {
    return exports.countAssignments.find((row) => row.countId === countId);
}
function createCountAssignment(input) {
    const record = {
        status: 'ASSIGNED',
        createdAt: new Date().toISOString(),
        priority: 'NORMAL',
        ...input,
    };
    exports.countAssignments.push(record);
    return { ...record };
}
function createRecountAssignment(count, reviewedBy) {
    const previous = findAssignmentForCount(count.id)
        ?? exports.countAssignments.find((row) => row.assignedToId === count.submittedBy
            && row.itemId === count.itemId
            && row.locationId === count.locationId
            && row.status === 'SUBMITTED');
    if (previous && previous.status !== 'CANCELLED') {
        previous.status = 'CANCELLED';
    }
    const assignment = createCountAssignment({
        id: `assign-${Math.random().toString(36).slice(2, 10)}`,
        locationId: count.locationId,
        itemId: count.itemId,
        assignedToId: previous?.assignedToId ?? count.submittedBy,
        assignedById: reviewedBy,
        countDate: new Date().toISOString(),
        dueDate: previous?.dueDate,
        priority: previous?.priority ?? 'HIGH',
        instructions: count.reviewReason ? `Recount: ${count.reviewReason}` : previous?.instructions,
        parentCountId: count.id,
        campaignId: previous?.campaignId,
    });
    return { assignment, cancelled: previous ? { ...previous } : undefined };
}
function updateCountAssignment(id, patch) {
    const assignment = exports.countAssignments.find((row) => row.id === id);
    if (!assignment)
        throw new Error('Count assignment was not found.');
    Object.assign(assignment, patch);
    return { ...assignment };
}
function listCountAssignments() {
    return [...exports.countAssignments];
}
function listCountAssignmentsFor(userId) {
    return exports.countAssignments.filter((row) => row.assignedToId === userId && row.status === 'ASSIGNED').map((row) => ({ ...row }));
}
/** The one open (ASSIGNED) assignment matching this user/item/location, if any. */
function findActiveAssignment(userId, itemId, locationId) {
    return exports.countAssignments.find((row) => row.assignedToId === userId && row.itemId === itemId && row.locationId === locationId && row.status === 'ASSIGNED');
}
function markAssignmentSubmitted(id, countId) {
    const assignment = exports.countAssignments.find((row) => row.id === id);
    if (assignment) {
        assignment.status = 'SUBMITTED';
        assignment.countId = countId;
    }
}
function updateTransferStatus(id, status) {
    const transfer = exports.transfers.find((record) => record.id === id);
    if (!transfer)
        throw new Error('Transfer was not found.');
    transfer.status = status;
    return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}
function updateTransferReceiptProgress(id, lines) {
    const transfer = exports.transfers.find((record) => record.id === id);
    if (!transfer)
        throw new Error('Transfer was not found.');
    transfer.lines = lines.map((line) => ({ ...line }));
    return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}
function listTransfers() {
    return exports.transfers.map((transfer) => ({ ...transfer, lines: transfer.lines.map((line) => ({ ...line })) }));
}
