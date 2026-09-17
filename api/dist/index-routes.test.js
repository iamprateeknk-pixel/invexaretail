"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('index does not mount the unused foundation blueprint router', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src/index.ts'), 'utf8');
    strict_1.default.equal(source.includes('foundationRouter'), false);
    strict_1.default.doesNotMatch(source, /routes\/foundation/);
    strict_1.default.equal((0, node_fs_1.existsSync)((0, node_path_1.join)(process.cwd(), 'src/routes/foundation.ts')), true);
});
