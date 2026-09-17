"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const db_js_1 = require("./db.js");
const URL_ENV = ['DATABASE_URL', 'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
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
(0, node_test_1.default)('Render rewrites Hostinger phpMyAdmin loopback to the public MariaDB host', () => {
    const previousUrl = process.env.DATABASE_URL;
    const previousRender = process.env.RENDER;
    process.env.RENDER = 'true';
    process.env.DATABASE_URL = 'mysql://u411689398_invexa:p%40ss@127.0.0.1:3306/u411689398_invexa';
    strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), `mysql://u411689398_invexa:p%40ss@${(0, db_js_1.publicMysqlHost)()}:3306/u411689398_invexa`);
    if (previousUrl === undefined)
        delete process.env.DATABASE_URL;
    else
        process.env.DATABASE_URL = previousUrl;
    if (previousRender === undefined)
        delete process.env.RENDER;
    else
        process.env.RENDER = previousRender;
});
(0, node_test_1.default)('Render rewrites the Hostinger hostname that times out from public clouds', () => {
    const previousUrl = process.env.DATABASE_URL;
    const previousRender = process.env.RENDER;
    process.env.RENDER = 'true';
    process.env.DATABASE_URL = 'mysql://u411689398_invexauser:p%40ss@srv834.hstgr.io:3306/u411689398_invexa';
    strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), `mysql://u411689398_invexauser:p%40ss@${(0, db_js_1.publicMysqlHost)()}:3306/u411689398_invexa`);
    if (previousUrl === undefined)
        delete process.env.DATABASE_URL;
    else
        process.env.DATABASE_URL = previousUrl;
    if (previousRender === undefined)
        delete process.env.RENDER;
    else
        process.env.RENDER = previousRender;
});
(0, node_test_1.default)('mysql pool stays tiny so Hostinger hourly connection limits are not burned', () => {
    const pool = (0, db_js_1.mysqlPoolConfig)('mysql://u411689398_invexauser:p%40ss@82.25.121.149:3306/u411689398_invexa');
    strict_1.default.equal(pool.host, '82.25.121.149');
    strict_1.default.equal(pool.user, 'u411689398_invexauser');
    strict_1.default.equal(pool.password, 'p@ss');
    strict_1.default.equal(pool.database, 'u411689398_invexa');
    strict_1.default.equal(pool.connectionLimit, 2);
    strict_1.default.equal(pool.idleTimeout, 0);
    strict_1.default.deepEqual((0, db_js_1.parseMysqlUrl)('mysql://shop:p%40ss@127.0.0.1:3306/invexa'), {
        host: '127.0.0.1',
        port: 3306,
        user: 'shop',
        password: 'p@ss',
        database: 'invexa',
    });
});
(0, node_test_1.default)('ready hint names the Hostinger hourly connection cap', () => {
    strict_1.default.equal((0, db_js_1.safeDatabaseError)({ code: 'ER_USER_LIMIT_REACHED' }).code, 'ER_USER_LIMIT_REACHED');
    strict_1.default.match((0, db_js_1.safeDatabaseError)({ code: 'ER_USER_LIMIT_REACHED' }).hint, /hourly connection limit/);
});
(0, node_test_1.default)('Hostinger keeps 127.0.0.1 so the local phpMyAdmin database is used', () => {
    const previousUrl = process.env.DATABASE_URL;
    const previousRender = process.env.RENDER;
    const previousService = process.env.RENDER_SERVICE_ID;
    delete process.env.RENDER;
    delete process.env.RENDER_SERVICE_ID;
    process.env.DATABASE_URL = 'mysql://shop:secret@127.0.0.1:3306/u411689398_invexa';
    strict_1.default.equal((0, db_js_1.resolveDatabaseUrl)(), 'mysql://shop:secret@127.0.0.1:3306/u411689398_invexa');
    if (previousUrl === undefined)
        delete process.env.DATABASE_URL;
    else
        process.env.DATABASE_URL = previousUrl;
    if (previousRender === undefined)
        delete process.env.RENDER;
    else
        process.env.RENDER = previousRender;
    if (previousService === undefined)
        delete process.env.RENDER_SERVICE_ID;
    else
        process.env.RENDER_SERVICE_ID = previousService;
});
