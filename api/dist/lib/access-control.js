"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_ACTIONS = exports.PERMISSION_MODULES = void 0;
exports.classifyPermission = classifyPermission;
exports.enforcePermissionOverrides = enforcePermissionOverrides;
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
exports.PERMISSION_MODULES = ['STOCK', 'COUNT', 'TRANSFER', 'IMPORT', 'REPORT', 'EXPIRY', 'PURCHASE', 'WORK', 'ADMIN'];
exports.PERMISSION_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'ARCHIVE', 'REVERSE'];
function classifyPermission(method, path) {
    const value = path.toLowerCase();
    let module = value.includes('import') ? 'IMPORT' :
        value.includes('transfer') || value.includes('picker') ? 'TRANSFER' :
            value.includes('count') || value.includes('approval') ? 'COUNT' :
                value.includes('expiry') ? 'EXPIRY' :
                    value.includes('purchase') || value.includes('supplier') || value.includes('replenish') ? 'PURCHASE' :
                        value.includes('report') || value.includes('export') || value.includes('dashboard') || value.includes('intelligence') ? 'REPORT' :
                            value.includes('job') || value.includes('asset') || value.includes('work') || value.includes('comment') ? 'WORK' :
                                value.includes('user') || value.includes('location') || value.includes('company') || value.includes('permission') ? 'ADMIN' :
                                    value.includes('stock') || value.includes('item') || value.includes('catalog') ? 'STOCK' : null;
    if (!module)
        return null;
    const action = value.includes('reverse') ? 'REVERSE' :
        value.includes('export') ? 'EXPORT' :
            value.includes('review') || value.includes('approve') || value.includes('confirm') ? 'APPROVE' :
                method === 'DELETE' ? 'DELETE' :
                    method === 'GET' ? 'VIEW' :
                        method === 'POST' ? 'CREATE' : 'EDIT';
    return { module, action };
}
async function enforcePermissionOverrides(req, res, next) {
    if (!persistence_js_1.databaseEnabled || !req.user || req.user.role === 'ADMIN')
        return next();
    const classified = classifyPermission(req.method, req.path);
    if (!classified)
        return next();
    try {
        const permission = await db_js_1.prisma.permission.findUnique({
            where: { module_action: { module: classified.module, action: classified.action } },
        });
        if (!permission)
            return next();
        const locationId = String(req.body?.locationId ?? req.query?.locationId ?? req.params?.locationId ?? '');
        const overrides = await db_js_1.prisma.userPermission.findMany({
            where: {
                userId: req.user.id,
                permissionId: permission.id,
                OR: [{ scopeId: null }, ...(locationId ? [{ scopeId: locationId }] : [])],
            },
        });
        if (!overrides.length)
            return next();
        const scoped = locationId ? overrides.filter((row) => row.scopeId === locationId) : [];
        const effective = scoped.length ? scoped : overrides.filter((row) => row.scopeId === null);
        if (effective.some((row) => row.denied) || !effective.some((row) => row.allowed)) {
            res.status(403).json({ message: `${classified.module} ${classified.action} permission denied.`, code: 'PERMISSION_DENIED' });
            return;
        }
        next();
    }
    catch {
        // Permission infrastructure must fail closed only when an explicit policy
        // can be read. Legacy DBs continue through existing role checks.
        next();
    }
}
