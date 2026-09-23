"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const db_js_1 = require("./db.js");
const URL_ENV = ['DATABASE_URL', 'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT'];
function withCleanDbEnv(run) {
    const previous = Object.fromEntries(URL_ENV.map((key) => [key, process.env[key]]));
    for (const key of URL_ENV)
        delete process.env[key];
    try {
        run();
    }
    finally {
        for (const key of URL_ENV) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
    }
}
(0, node_test_1.default)('resolveDatabaseUrl is empty without connection settings', () => {
    withCleanDbEnv(() => strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), ''));
});
(0, node_test_1.default)('resolveDatabaseUrl accepts Render-style PostgreSQL URL', () => {
    withCleanDbEnv(() => {
        process.env.DATABASE_URL = 'postgresql://invexa:p%40ss@db.internal:5432/invexa';
        strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), process.env.DATABASE_URL);
        strict_1.default.equal((0, db_js_1.validatePostgresUrl)((0, db_js_1.resolveDatabaseUrl)()), process.env.DATABASE_URL);
    });
});
(0, node_test_1.default)('resolveDatabaseUrl composes standard PostgreSQL environment variables', () => {
    withCleanDbEnv(() => {
        process.env.PGHOST = 'localhost';
        process.env.PGUSER = 'shop';
        process.env.PGPASSWORD = 'p@ss';
        process.env.PGDATABASE = 'invexa';
        strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), 'postgresql://shop:p%40ss@localhost:5432/invexa');
    });
});
(0, node_test_1.default)('validatePostgresUrl rejects non-PostgreSQL URLs', () => {
    strict_1.default.throws(() => (0, db_js_1.validatePostgresUrl)('http://user:pass@host/database'), /postgresql/);
});
(0, node_test_1.default)('ready hint explains PostgreSQL connection exhaustion', () => {
    const result = (0, db_js_1.safeDatabaseError)({ code: '53300' });
    strict_1.default.equal(result.code, '53300');
    strict_1.default.match(result.hint, /connection slots/);
});
