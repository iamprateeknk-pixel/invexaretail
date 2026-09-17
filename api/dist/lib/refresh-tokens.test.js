"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const otp_auth_js_1 = require("./otp-auth.js");
const enterprise_repository_js_1 = require("./enterprise-repository.js");
(0, node_test_1.default)('logout revokes a refresh token so it cannot be reused', () => {
    const token = (0, otp_auth_js_1.generateRefreshToken)('user-1', 'company-1');
    (0, enterprise_repository_js_1.storeRefreshToken)(token, 'user-1', 'company-1');
    strict_1.default.ok((0, enterprise_repository_js_1.validateRefreshToken)(token));
    (0, enterprise_repository_js_1.revokeRefreshToken)(token);
    strict_1.default.equal((0, enterprise_repository_js_1.isRefreshTokenRevoked)(token), true);
    strict_1.default.equal((0, enterprise_repository_js_1.validateRefreshToken)(token), null);
});
