import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('MySQL: migrations, rollback, cross-connection lock and idempotency retry', async () => {
  const first = await mysql.createConnection(databaseUrl!);
  const second = await mysql.createConnection(databaseUrl!);
  try {
    const [outbox] = await first.query<any[]>('SHOW TABLES LIKE ?', ['DomainEventOutbox']);
    assert.equal(outbox.length, 1, 'durable outbox migration must be present');
    await first.query('CREATE TABLE IF NOT EXISTS `CiIdempotencyProbe` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY, `requestKey` VARCHAR(191) NOT NULL UNIQUE, `value` INT NOT NULL)');
    await first.beginTransaction();
    await first.query('INSERT INTO `CiIdempotencyProbe` (`requestKey`,`value`) VALUES (?,?)', ['rollback-check', 1]);
    await first.rollback();
    const [rolledBack] = await first.query<any[]>('SELECT COUNT(*) AS count FROM `CiIdempotencyProbe` WHERE `requestKey` = ?', ['rollback-check']);
    assert.equal(Number(rolledBack[0].count), 0);
    const [lock] = await first.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', ['invexa-ci-lock']);
    assert.equal(Number(lock[0].acquired), 1);
    const [contended] = await second.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', ['invexa-ci-lock']);
    assert.equal(Number(contended[0].acquired), 0, 'only one worker may own the lock');
    await first.query('SELECT RELEASE_LOCK(?)', ['invexa-ci-lock']);
    await Promise.all(Array.from({ length: 8 }, () => second.query('INSERT IGNORE INTO `CiIdempotencyProbe` (`requestKey`,`value`) VALUES (?,?)', ['retry-key', 7])));
    const [deduped] = await first.query<any[]>('SELECT COUNT(*) AS count FROM `CiIdempotencyProbe` WHERE `requestKey` = ?', ['retry-key']);
    assert.equal(Number(deduped[0].count), 1, 'replayed request posts only once');
  } finally {
    await first.end();
    await second.end();
  }
});