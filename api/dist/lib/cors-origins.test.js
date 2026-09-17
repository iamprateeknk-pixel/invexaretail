"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const cors_origins_js_1 = require("./cors-origins.js");
(0, node_test_1.default)('keeps the live website even when ALLOWED_ORIGINS is empty or API-only', () => {
    strict_1.default.deepEqual((0, cors_origins_js_1.resolveAllowedOrigins)(''), cors_origins_js_1.REQUIRED_WEB_ORIGINS);
    const origins = (0, cors_origins_js_1.resolveAllowedOrigins)('https://api.invexaretail.com');
    strict_1.default.ok(origins.includes('https://invexaretail.com'));
    strict_1.default.ok(origins.includes('https://www.invexaretail.com'));
    strict_1.default.ok(origins.includes('https://invexaretail.prateek160298.workers.dev'));
    strict_1.default.ok(origins.includes('https://api.invexaretail.com'));
});
(0, node_test_1.default)('normalizes Hostinger env values and browser origins', () => {
    const origins = (0, cors_origins_js_1.resolveAllowedOrigins)(' https://INVEXARETAIL.com/ , https://admin.example.com/path/ ');
    strict_1.default.equal((0, cors_origins_js_1.normalizeOrigin)(' https://INVEXARETAIL.com/ '), 'https://invexaretail.com');
    strict_1.default.ok(origins.includes('https://admin.example.com'));
    strict_1.default.equal((0, cors_origins_js_1.isAllowedOrigin)('https://invexaretail.com/', origins), true);
    strict_1.default.equal((0, cors_origins_js_1.isAllowedOrigin)('https://evil.example', origins), false);
    strict_1.default.equal((0, cors_origins_js_1.isAllowedOrigin)(undefined, origins), true);
});
