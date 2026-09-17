"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const foundation_schema_js_1 = require("./foundation-schema.js");
const CORE_TENANT_MODELS = ['User', 'Branch', 'Location', 'Item'];
(0, node_test_1.default)('operational Prisma models declare additive tenantId defaults', () => {
    const schema = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const required = [...CORE_TENANT_MODELS, ...foundation_schema_js_1.OPERATIONAL_TENANT_TABLES];
    strict_1.default.ok(foundation_schema_js_1.OPERATIONAL_TENANT_TABLES.includes('StockLedger'));
    for (const name of required) {
        const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
        strict_1.default.ok(match, `missing Prisma model ${name}`);
        strict_1.default.match(match[1], /tenantId\s+String\s+@default\("tenant-invexa"\)/);
        strict_1.default.match(match[1], /@@index\(\[tenantId\]\)/);
    }
});
