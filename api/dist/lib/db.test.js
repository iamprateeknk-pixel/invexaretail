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
    withCleanDbEnv(() => {
        strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), '');
    });
});
(0, node_test_1.default)('resolveDatabaseUrl passes DATABASE_URL through unchanged', () => {
    withCleanDbEnv(() => {
        process.env.DATABASE_URL = 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa';
        strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa');
    });
});
(0, node_test_1.default)('resolveDatabaseUrl builds a URL from discrete PG_* parts', () => {
    withCleanDbEnv(() => {
        process.env.PGHOST = '127.0.0.1';
        process.env.PGUSER = 'shop';
        process.env.PGPASSWORD = 'p@ss';
        process.env.PGDATABASE = 'invexa';
        strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa');
    });
});
(0, node_test_1.default)('safeDatabaseError names unreachable hosts and bad credentials', () => {
    strict_1.default.match((0, db_js_1.safeDatabaseError)({ code: 'ECONNREFUSED' }).hint, /reachable/);
    strict_1.default.match((0, db_js_1.safeDatabaseError)({ code: '28P01' }).hint, /credentials/);
});
