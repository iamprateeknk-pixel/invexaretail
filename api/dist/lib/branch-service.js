"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BranchHasActiveWorkError = exports.BranchCodeConflictError = exports.BranchNotFoundError = void 0;
exports.createBranch = createBranch;
exports.updateBranch = updateBranch;
exports.archiveBranch = archiveBranch;
// Week 8: command/query service for Branch management, migrated out of the
// unmounted routes/foundation.ts (dead code - see docs/route-ownership-matrix.md
// for the full parity decision on that file). This is unique behavior with
// no live equivalent anywhere in core.ts/operations-extension.ts, so it is
// migrated rather than retired.
//
// Bug fix made while porting: the original archive-guard queried
// `prisma.stockBalance` for "does this branch have active stock" -
// `StockBalance` is the dead projection table identified in ADR-001's Week
// 6 addendum (nothing has written to it in a long time; `routes/foundation.ts`
// itself was the only writer, and it was never mounted). That check has
// therefore always silently reported zero active stock, regardless of
// reality. Fixed to query `StockLedger`, the table every other stock read in
// this codebase actually uses.
const db_js_1 = require("./db.js");
class BranchNotFoundError extends Error {
    constructor(id) {
        super(`Branch ${id} was not found.`);
        this.name = 'BranchNotFoundError';
    }
}
exports.BranchNotFoundError = BranchNotFoundError;
class BranchCodeConflictError extends Error {
    constructor(code) {
        super(`Branch code ${code} already exists.`);
        this.name = 'BranchCodeConflictError';
    }
}
exports.BranchCodeConflictError = BranchCodeConflictError;
class BranchHasActiveWorkError extends Error {
    blockers;
    constructor(blockers) {
        super('Cannot archive: branch has active stock, open transfers, or pending tasks.');
        this.blockers = blockers;
        this.name = 'BranchHasActiveWorkError';
    }
}
exports.BranchHasActiveWorkError = BranchHasActiveWorkError;
async function createBranch(input) {
    const existing = await db_js_1.prisma.branch.findUnique({ where: { code: input.code } });
    if (existing)
        throw new BranchCodeConflictError(input.code);
    return db_js_1.prisma.branch.create({
        data: {
            code: input.code,
            name: input.name,
            type: input.type || 'WAREHOUSE',
            address: input.address || null,
            phone: input.phone || null,
            email: input.email || null,
            managerId: input.managerId || null,
            workingHours: input.workingHours || null,
        },
    });
}
async function updateBranch(id, patch) {
    const branch = await db_js_1.prisma.branch.findUnique({ where: { id } });
    if (!branch)
        throw new BranchNotFoundError(id);
    // Branch code is immutable after first transaction (blueprint §11); the
    // caller is expected to have already stripped `code` from the patch.
    return db_js_1.prisma.branch.update({
        where: { id: branch.id },
        data: {
            name: patch.name ?? undefined,
            address: patch.address ?? undefined,
            phone: patch.phone ?? undefined,
            email: patch.email ?? undefined,
            managerId: patch.managerId ?? undefined,
            workingHours: patch.workingHours ?? undefined,
            status: patch.status ?? undefined,
        },
    });
}
async function archiveBranch(id) {
    const branch = await db_js_1.prisma.branch.findUnique({ where: { id }, include: { locations: true } });
    if (!branch)
        throw new BranchNotFoundError(id);
    const locationIds = branch.locations.map((l) => l.id);
    const [activeStock, openTransfers, pendingWork] = await Promise.all([
        locationIds.length
            ? db_js_1.prisma.stockLedger.count({ where: { locationId: { in: locationIds }, onHand: { gt: 0 } } })
            : Promise.resolve(0),
        locationIds.length
            ? db_js_1.prisma.transfer.count({
                where: {
                    OR: [{ sourceLocationId: { in: locationIds } }, { destinationLocationId: { in: locationIds } }],
                    status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED'] },
                },
            })
            : Promise.resolve(0),
        locationIds.length
            ? db_js_1.prisma.workAssignment.count({ where: { locationId: { in: locationIds }, status: { notIn: ['CLOSED', 'CANCELLED'] } } })
            : Promise.resolve(0),
    ]);
    if (activeStock > 0 || openTransfers > 0 || pendingWork > 0) {
        throw new BranchHasActiveWorkError({ activeStock, openTransfers, pendingWork });
    }
    return db_js_1.prisma.branch.update({ where: { id: branch.id }, data: { status: 'ARCHIVED' } });
}
