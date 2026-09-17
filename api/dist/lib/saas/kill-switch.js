"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KILLABLE_FEATURES = void 0;
exports.featureForOperationalPath = featureForOperationalPath;
exports.isOperationalKillSwitchOn = isOperationalKillSwitchOn;
exports.enforceOperationalKillSwitches = enforceOperationalKillSwitches;
const control_plane_js_1 = require("./control-plane.js");
exports.KILLABLE_FEATURES = ['INVENTORY', 'WMS', 'OMS'];
const INVENTORY_SEGMENTS = new Set([
    'stock',
    'items',
    'counts',
    'imports',
    'locations',
    'opening-stock',
]);
const WMS_SEGMENTS = new Set([
    'transfers',
    'waves',
    'picks',
    'putaway',
    'receiving',
]);
const OMS_SEGMENTS = new Set([
    'orders',
    'fulfillments',
    'checkout',
]);
function featureForOperationalPath(path) {
    const segments = String(path ?? '').split('/').filter(Boolean);
    for (const segment of segments) {
        if (INVENTORY_SEGMENTS.has(segment))
            return 'INVENTORY';
        if (WMS_SEGMENTS.has(segment))
            return 'WMS';
        if (OMS_SEGMENTS.has(segment))
            return 'OMS';
    }
    return null;
}
function isOperationalKillSwitchOn(feature) {
    return control_plane_js_1.controlPlane.safety.get(feature) === false;
}
function enforceOperationalKillSwitches(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        next();
        return;
    }
    const feature = featureForOperationalPath(req.path ?? '');
    if (!feature || !isOperationalKillSwitchOn(feature)) {
        next();
        return;
    }
    res.status(403).json({
        error: `${feature} mutations are disabled by a platform kill switch`,
        code: 'KILL_SWITCH',
        feature,
    });
}
