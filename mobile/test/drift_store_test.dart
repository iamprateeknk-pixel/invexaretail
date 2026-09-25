import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart' as sqlite;
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/drift_store.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/native_database.dart';

QueuedCount _count(String id, {double qty = 4}) => QueuedCount(
      localId: id,
      itemId: 'item-1001',
      locationId: 'loc-1',
      physicalQuantity: qty,
      createdAt: '2026-09-15T00:00:00Z',
    );

SyncCommandRow _command(String id, {String company = 'c1', int base = 0, String entity = 'count-1'}) => SyncCommandRow(
      commandId: id,
      companyId: company,
      actorId: 'u1',
      type: 'COUNT_SUBMIT',
      entityType: 'count',
      entityId: entity,
      baseVersion: base,
      occurredAt: '2026-09-25T10:00:00Z',
      payload: {'qty': 3},
    );

File _tempFile(String name) {
  final file = File('${Directory.systemTemp.path}/invexa_$name${DateTime.now().microsecondsSinceEpoch}.sqlite');
  addTearDown(() {
    for (final path in [file.path, '${file.path}-wal', '${file.path}-shm']) {
      final f = File(path);
      if (f.existsSync()) f.deleteSync();
    }
  });
  return file;
}

void main() {
  test('DriftStore namespaces queued counts by companyId', () async {
    final store = DriftStore.inMemory();
    await store.saveQueuedCounts([_count('g-1')], 'default-company');
    await store.saveQueuedCounts([_count('j-1', qty: 2)], 'company-jaipur');
    expect((await store.loadQueuedCounts('default-company')).single.localId, 'g-1');
    expect((await store.loadQueuedCounts('company-jaipur')).single.localId, 'j-1');
  });

  test('sessions are never written to SQLite (secure storage owns credentials)', () async {
    final store = DriftStore.inMemory();
    await store.saveSession(PersistedSession(
      token: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      user: AuthUser.fromJson({'id': 'u1', 'email': 'a@b.c', 'role': 'ADMIN'}),
    ));
    expect(await store.loadSession(), isNull);
  });

  test('a real SQLite file survives close/reopen and is company scoped', () async {
    final file = _tempFile('reopen');
    final first = DriftStore.native(NativeDatabase.file(file));
    await first.saveQueuedCounts([_count('p-1', qty: 9)], 'default-company');
    first.close();

    final head = file.openSync()..setPositionSync(0);
    final magic = utf8.decode(head.readSync(15));
    head.closeSync();
    expect(magic, 'SQLite format 3', reason: 'must be a genuine SQLite database, not JSON');

    final second = DriftStore.native(NativeDatabase.file(file));
    expect((await second.loadQueuedCounts('default-company')).single.localId, 'p-1');
    expect(await second.loadQueuedCounts('company-jaipur'), isEmpty);
    second.close();
  });

  test('migrations are versioned and the schema never holds stock or session tables', () {
    final db = NativeDatabase.memory();
    expect(db.schemaVersion, currentSchemaVersion);
    expect(db.tableNames, containsAll(['queued_counts', 'queued_actions', 'sync_commands', 'entity_versions']));
    expect(db.tableNames.any((name) => name.contains('stock') || name == 'sessions'), isFalse);
    db.close();
  });

  test('a database from a newer app version is refused, not silently downgraded', () {
    final file = _tempFile('newer');
    NativeDatabase.file(file).close();
    final raw = sqlite.sqlite3.open(file.path);
    raw.execute('PRAGMA user_version = 99');
    raw.close();
    expect(() => NativeDatabase.file(file), throwsStateError);
  });

  test('legacy JSON "sqlite" file is migrated: queues kept, plaintext session dropped', () async {
    final file = _tempFile('legacy');
    file.writeAsStringSync(jsonEncode({
      'schema': 'drift_native_v1',
      'tables': {
        'sessions': [
          {'id': 1, 'company_id': 'c1', 'token': 'LEAKED-ACCESS', 'refresh_token': 'LEAKED-REFRESH', 'user_json': '{}', 'updated_at': 'x'},
        ],
        'sealed_mutations': [
          {'id': 1, 'company_id': 'c1', 'seq': 1, 'envelope': 'opaque', 'created_at': 'x'},
        ],
        'queued_counts': [
          {'local_id': 'legacy-1', 'company_id': 'c1', 'payload_json': jsonEncode(_count('legacy-1').toJson()), 'seq': 1},
        ],
      },
    }));
    final store = DriftStore.native(NativeDatabase.file(file));
    expect((await store.loadQueuedCounts('c1')).single.localId, 'legacy-1');
    store.close();
    final bytes = file.readAsBytesSync();
    expect(utf8.decode(bytes, allowMalformed: true).contains('LEAKED'), isFalse, reason: 'legacy plaintext tokens must not survive');
  });

  test('a corrupt legacy file opens as an empty database instead of crashing the app', () async {
    final file = _tempFile('corrupt');
    file.writeAsStringSync('{ not json at all');
    final store = DriftStore.native(NativeDatabase.file(file));
    expect(await store.loadQueuedCounts('c1'), isEmpty);
    store.close();
  });

  group('durable command queue', () {
    test('enqueue is idempotent on commandId so a duplicate tap cannot queue twice', () {
      final db = NativeDatabase.memory();
      expect(db.enqueueCommand(_command('cmd-1')), isTrue);
      expect(db.enqueueCommand(_command('cmd-1')), isFalse);
      expect(db.commandsFor('c1'), hasLength(1));
      db.close();
    });

    test('commands are tenant scoped and replay in creation order', () {
      final db = NativeDatabase.memory();
      db.enqueueCommand(_command('a'));
      db.enqueueCommand(_command('other', company: 'c2'));
      db.enqueueCommand(_command('b'));
      expect(db.commandsFor('c1').map((c) => c.commandId), ['a', 'b']);
      expect(db.commandsFor('c2').map((c) => c.commandId), ['other']);
      db.close();
    });

    test('attempts, errors and conflicts persist across process death', () {
      final file = _tempFile('queue');
      var db = NativeDatabase.file(file);
      db.enqueueCommand(_command('cmd-1', base: 1));
      db.recordAttempt('cmd-1', status: 'PENDING', error: 'network down');
      db.recordAttempt('cmd-1', status: 'CONFLICT', error: 'server has v3', serverVersion: 3);
      db.close(); // simulated process death

      db = NativeDatabase.file(file);
      final row = db.command('cmd-1')!;
      expect(row.attempts, 2);
      expect(row.status, 'CONFLICT');
      expect(row.lastError, 'server has v3');
      expect(row.serverVersion, 3);
      expect(db.commandsFor('c1', status: 'PENDING'), isEmpty);

      db.resolveConflictRetry('cmd-1', 3);
      final retried = db.command('cmd-1')!;
      expect(retried.status, 'PENDING');
      expect(retried.baseVersion, 3);
      db.recordAttempt('cmd-1', status: 'SYNCED', serverVersion: 4);
      expect(db.command('cmd-1')!.status, 'SYNCED');
      expect(db.entityVersion('c1', 'count', 'count-1'), 4);
      db.close();
    });

    test('a failing multi-row write rolls back completely', () {
      final db = NativeDatabase.memory();
      expect(() => db.replaceCounts('c1', [jsonEncode(_count('ok').toJson()), 'not json']), throwsA(anything));
      expect(db.loadCounts('c1'), isEmpty);
      db.close();
    });
  });
}
