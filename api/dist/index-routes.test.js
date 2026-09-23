"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// Week 8: routes/foundation.ts was the unmounted "Phase 1 Prisma blueprint"
// this test used to just document as present-but-unreachable. Its parity
// decision (docs/route-ownership-matrix.md) migrated the unique Branch
// routes to routes/branches.ts (now mounted) and retired the rest as
// superseded/prohibited-pattern duplicates - the file itself is gone.
(0, node_test_1.default)('the retired foundation blueprint file no longer exists, and nothing still refers to it', () => {
    strict_1.default.equal((0, node_fs_1.existsSync)((0, node_path_1.join)(process.cwd(), 'src/routes/foundation.ts')), false);
});
