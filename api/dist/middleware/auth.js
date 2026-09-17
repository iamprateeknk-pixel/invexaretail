"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const auth_js_1 = require("../lib/auth.js");
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Authorization token is required.' });
        return;
    }
    try {
        const token = header.replace('Bearer ', '');
        const payload = (0, auth_js_1.verifyToken)(token);
        req.userId = payload.sub;
        req.companyId = payload.companyId;
        next();
    }
    catch (error) {
        res.status(401).json({ message: 'Invalid or expired token.' });
    }
}
