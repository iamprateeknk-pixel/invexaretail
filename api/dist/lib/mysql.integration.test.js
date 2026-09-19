"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promise_1 = __importDefault(require("mysql2/promise"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('MySQL: migrations, rollback, cross-connection lock and idempotency retry', async () => {
    const first = await promise_1.default.createConnection(databaseUrl);
    const second = await promise_1.default.createConnection(databaseUrl);
    try {
        const [outbox] = await first.query('SHOW TABLES LIKE ?', ['DomainEventOutbox']);
        strict_1.default.equal(outbox.length, 1, 'durable outbox migration must be present');
        await first.query('CREATE TABLE IF NOT EXISTS `CiIdempotencyProbe` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY, `requestKey` VARCHAR(191) NOT NULL UNIQUE, `value` INT NOT NULL)');
        await first.beginTransaction();
        await first.query('INSERT INTO `CiIdempotencyProbe` (`requestKey`,`value`) VALUES (?,?)', ['rollback-check', 1]);
        await first.rollback();
        const [rolledBack] = await first.query('SELECT COUNT(*) AS count FROM `CiIdempotencyProbe` WHERE `requestKey` = ?', ['rollback-check']);
        strict_1.default.equal(Number(rolledBack[0].count), 0);
        const [lock] = await first.query('SELECT GET_LOCK(?, 0) AS acquired', ['invexa-ci-lock']);
        strict_1.default.equal(Number(lock[0].acquired), 1);
        const [contended] = await second.query('SELECT GET_LOCK(?, 0) AS acquired', ['invexa-ci-lock']);
        strict_1.default.equal(Number(contended[0].acquired), 0, 'only one worker may own the lock');
        await first.query('SELECT RELEASE_LOCK(?)', ['invexa-ci-lock']);
        await Promise.all(Array.from({ length: 8 }, () => second.query('INSERT IGNORE INTO `CiIdempotencyProbe` (`requestKey`,`value`) VALUES (?,?)', ['retry-key', 7])));
        const [deduped] = await first.query('SELECT COUNT(*) AS count FROM `CiIdempotencyProbe` WHERE `requestKey` = ?', ['retry-key']);
        strict_1.default.equal(Number(deduped[0].count), 1, 'replayed request posts only once');
    }
    finally {
        await first.end();
        await second.end();
    }
});
