import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart' as sqlite;

/// Real SQLite store (Week 16). Replaces the earlier JSON file that only
/// imitated SQLite. Company-scoped queues, versioned migrations tracked in
/// `PRAGMA user_version`, and every multi-row write inside a transaction.
///
/// Server secrets never live here: sessions and refresh credentials belong to
/// Keychain/Keystore-backed secure storage. Stock ledger rows are never stored.
const currentSchemaVersion = 5;

/// Ordered migrations; index + 1 is the schema version each one produces.
const _migrations = <String>[
  // v1: legacy count/action queues, now real tables.
  '''
  CREATE TABLE IF NOT EXISTS queued_counts (
    local_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (company_id, local_id)
  );
  CREATE TABLE IF NOT EXISTS queued_actions (
    local_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queued_counts_company_idx ON queued_counts (company_id, seq);
  ''',
  // v2: durable offline command queue matching the server contract
  // (api/src/lib/offline-command-contract.ts).
  '''
  CREATE TABLE IF NOT EXISTS sync_commands (
    command_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_version INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    server_version INTEGER,
    created_seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sync_commands_company_status_idx ON sync_commands (company_id, status, created_seq);
  CREATE TABLE IF NOT EXISTS entity_versions (
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (company_id, entity_type, entity_id)
  );
  ''',
  // v3: per-installation metadata (device id for identity-bound queued work).
  '''
  CREATE TABLE IF NOT EXISTS device_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  ''',
  // v4: one outbox. Queued counts/actions move into sync_commands (type COUNT / ACTION) so the
  // durable command queue is the only offline mutation store; the two legacy tables are dropped.
  '''
  INSERT OR IGNORE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq)
    SELECT 'COUNT:' || company_id || ':' || local_id, company_id, '', 'COUNT', 'count', local_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), payload_json, seq
    FROM queued_counts;
  INSERT OR IGNORE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq)
    SELECT 'ACTION:' || local_id, '', '', 'ACTION', 'action', local_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), payload_json, seq
    FROM queued_actions;
  DROP TABLE queued_counts;
  DROP TABLE queued_actions;
  ''',
  // v5: the offline read model. The last successful answer of each read-only screen feed, scoped to
  // company + user, so a cold start with no network still shows the last known stock, items and
  // tasks (clearly marked as a snapshot). Never holds credentials; removed on sign-out.
  '''
  CREATE TABLE IF NOT EXISTS read_model (
    scope TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (scope, path)
  );
  ''',
];

/// Kept for tests/documentation: the full current schema as one script.
final String driftNativeSchema = _migrations.join('\n');

class SyncCommandRow {
  const SyncCommandRow({
    required this.commandId,
    required this.companyId,
    required this.actorId,
    required this.type,
    required this.entityType,
    required this.entityId,
    required this.baseVersion,
    required this.occurredAt,
    required this.payload,
    this.status = 'PENDING',
    this.attempts = 0,
    this.lastError,
    this.serverVersion,
  });

  final String commandId;
  final String companyId;
  final String actorId;
  final String type;
  final String entityType;
  final String entityId;
  final int baseVersion;
  final String occurredAt;
  final Map<String, Object?> payload;
  // PENDING | SYNCED | CONFLICT | REJECTED
  final String status;
  final int attempts;
  final String? lastError;
  final int? serverVersion;
}

class NativeDatabase {
  NativeDatabase._(this._db, {this.file}) : isMemory = file == null;

  factory NativeDatabase.memory() {
    final db = NativeDatabase._(sqlite.sqlite3.openInMemory());
    db._migrate();
    return db;
  }

  /// Opens (creating if needed) a SQLite file. A file left by the earlier JSON
  /// "sqlite" layer is migrated in place: queued counts/actions are kept, and
  /// everything else (plaintext sessions, sealed envelopes that can no longer be
  /// opened) is discarded, then the legacy file is deleted.
  factory NativeDatabase.file(File file) {
    file.parent.createSync(recursive: true);
    final legacy = _readLegacyJson(file);
    if (legacy != null) file.deleteSync();
    final db = NativeDatabase._(sqlite.sqlite3.open(file.path), file: file);
    try {
      db._db.execute('PRAGMA journal_mode = WAL');
      db._migrate();
      if (legacy != null) db._importLegacy(legacy);
    } catch (_) {
      db.close(); // never leak the file handle when a migration/open is refused
      rethrow;
    }
    return db;
  }

  static Future<NativeDatabase> openApp() async {
    final dir = await getApplicationSupportDirectory();
    return NativeDatabase.file(File(p.join(dir.path, 'invexa_drift.sqlite')));
  }

  final sqlite.Database _db;
  final File? file;
  final bool isMemory;

  int get schemaVersion => _db.select('PRAGMA user_version').first.values.first as int;

  List<String> get tableNames => _db
      .select("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((row) => row['name'] as String)
      .toList();

  void _migrate() {
    var version = schemaVersion;
    if (version > _migrations.length) {
      throw StateError('DATABASE_NEWER_THAN_APP: schema $version > ${_migrations.length}');
    }
    while (version < _migrations.length) {
      _transaction(() {
        _db.execute(_migrations[version]);
        _db.execute('PRAGMA user_version = ${version + 1}');
      });
      version += 1;
    }
  }

  void _transaction(void Function() body) {
    _db.execute('BEGIN IMMEDIATE');
    try {
      body();
      _db.execute('COMMIT');
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  static Map<String, dynamic>? _readLegacyJson(File file) {
    if (!file.existsSync() || file.lengthSync() == 0) return null;
    final head = file.openSync()..setPositionSync(0);
    final bytes = head.readSync(16);
    head.closeSync();
    if (utf8.decode(bytes, allowMalformed: true).startsWith('SQLite format 3')) return null;
    try {
      final decoded = jsonDecode(file.readAsStringSync());
      return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{}; // unreadable legacy file: start empty.
    }
  }

  void _importLegacy(Map<String, dynamic> legacy) {
    final tables = legacy['tables'];
    if (tables is! Map) return;
    final countsByCompany = <String, List<String>>{};
    final counts = tables['queued_counts'];
    if (counts is List) {
      for (final row in counts.whereType<Map>()) {
        final company = row['company_id']?.toString() ?? '';
        (countsByCompany[company] ??= []).add(row['payload_json'].toString());
      }
    }
    countsByCompany.forEach(replaceCounts);
    final actions = tables['queued_actions'];
    if (actions is List) {
      replaceActions([for (final row in actions.whereType<Map>()) row['payload_json'].toString()]);
    }
  }

  void close() => _db.close();

  /// The stable id of this installation; created with [create] on first use.
  String deviceId(String Function() create) {
    final rows = _db.select("SELECT value FROM device_meta WHERE key = 'device_id'");
    if (rows.isNotEmpty) return rows.first['value'] as String;
    final id = create();
    _db.execute("INSERT OR REPLACE INTO device_meta (key, value) VALUES ('device_id', ?)", [id]);
    return id;
  }

  // ---- offline read model ---------------------------------------------------------------------

  static const _maxReadModelRows = 200;
  static const _maxReadModelBodyBytes = 2 * 1024 * 1024;

  void putReadModel(String scope, String path, String body, {DateTime? now}) {
    if (utf8.encode(body).length > _maxReadModelBodyBytes) return; // an unusually large feed is not cached
    _transaction(() {
      _db.execute(
        'INSERT OR REPLACE INTO read_model (scope, path, body, fetched_at) VALUES (?, ?, ?, ?)',
        [scope, path, body, (now ?? DateTime.now()).toUtc().toIso8601String()],
      );
      // Bounded: keep the most recently fetched rows only.
      _db.execute(
        'DELETE FROM read_model WHERE rowid IN (SELECT rowid FROM read_model ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)',
        [_maxReadModelRows],
      );
    });
  }

  ({String body, DateTime fetchedAt})? getReadModel(String scope, String path) {
    final rows = _db.select('SELECT body, fetched_at FROM read_model WHERE scope = ? AND path = ?', [scope, path]);
    if (rows.isEmpty) return null;
    return (body: rows.first['body'] as String, fetchedAt: DateTime.parse(rows.first['fetched_at'] as String));
  }

  void clearReadModel(String scope) => _db.execute('DELETE FROM read_model WHERE scope = ?', [scope]);

  // ---- count / action queues (stored as sync_commands of type COUNT / ACTION) ----------------

  int _nextSeq() => _db.select('SELECT COALESCE(MAX(created_seq), 0) + 1 AS next FROM sync_commands').first['next'] as int;

  void _replaceQueue(String type, String entityType, String? companyId, List<String> payloads) {
    _transaction(() {
      if (companyId == null) {
        _db.execute('DELETE FROM sync_commands WHERE type = ?', [type]);
      } else {
        _db.execute('DELETE FROM sync_commands WHERE type = ? AND company_id = ?', [type, companyId]);
      }
      var seq = _nextSeq();
      for (var index = 0; index < payloads.length; index += 1) {
        final decoded = jsonDecode(payloads[index]);
        final localId = decoded is Map ? decoded['localId']?.toString() ?? '$entityType-$index' : '$entityType-$index';
        final owner = type == 'COUNT' ? companyId! : (decoded is Map ? decoded['companyId']?.toString() ?? '' : '');
        final actor = decoded is Map ? decoded['userId']?.toString() ?? '' : '';
        final commandId = type == 'COUNT' ? 'COUNT:$owner:$localId' : 'ACTION:$localId';
        _db.execute(
          'INSERT OR REPLACE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq) '
          'VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
          [commandId, owner, actor, type, entityType, localId, DateTime.now().toUtc().toIso8601String(), payloads[index], seq],
        );
        seq += 1;
      }
    });
  }

  List<String> loadCounts(String companyId) => _db
      .select("SELECT payload_json FROM sync_commands WHERE type = 'COUNT' AND company_id = ? ORDER BY created_seq", [companyId])
      .map((row) => row['payload_json'] as String)
      .toList();

  void replaceCounts(String companyId, List<String> payloads) => _replaceQueue('COUNT', 'count', companyId, payloads);

  List<String> loadActions() => _db
      .select("SELECT payload_json FROM sync_commands WHERE type = 'ACTION' ORDER BY created_seq")
      .map((row) => row['payload_json'] as String)
      .toList();

  void replaceActions(List<String> payloads) => _replaceQueue('ACTION', 'action', null, payloads);

  // ---- durable offline command queue --------------------------------------

  /// Idempotent on `commandId`: enqueueing the same command twice keeps the
  /// first row and reports `false`, so a double tap or replay cannot queue twice.
  bool enqueueCommand(SyncCommandRow command) {
    var inserted = false;
    _transaction(() {
      final seq = (_db.select('SELECT COALESCE(MAX(created_seq), 0) + 1 AS next FROM sync_commands').first['next'] as int);
      _db.execute(
        'INSERT OR IGNORE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          command.commandId, command.companyId, command.actorId, command.type, command.entityType,
          command.entityId, command.baseVersion, command.occurredAt, jsonEncode(command.payload), seq,
        ],
      );
      inserted = _db.updatedRows == 1;
    });
    return inserted;
  }

  List<SyncCommandRow> commandsFor(String companyId, {String? status}) {
    final rows = status == null
        ? _db.select('SELECT * FROM sync_commands WHERE company_id = ? ORDER BY created_seq', [companyId])
        : _db.select('SELECT * FROM sync_commands WHERE company_id = ? AND status = ? ORDER BY created_seq', [companyId, status]);
    return rows.map(_commandFromRow).toList();
  }

  SyncCommandRow? command(String commandId) {
    final rows = _db.select('SELECT * FROM sync_commands WHERE command_id = ?', [commandId]);
    return rows.isEmpty ? null : _commandFromRow(rows.first);
  }

  /// Records one delivery attempt and its outcome. SYNCED/CONFLICT/REJECTED are
  /// terminal for automatic retry; PENDING keeps the command in the queue.
  void recordAttempt(String commandId, {required String status, String? error, int? serverVersion}) {
    _transaction(() {
      _db.execute(
        'UPDATE sync_commands SET attempts = attempts + 1, status = ?, last_error = ?, server_version = COALESCE(?, server_version) WHERE command_id = ?',
        [status, error, serverVersion, commandId],
      );
      if (status == 'SYNCED' && serverVersion != null) {
        final row = command(commandId);
        if (row != null) {
          _db.execute(
            'INSERT OR REPLACE INTO entity_versions (company_id, entity_type, entity_id, version) VALUES (?, ?, ?, ?)',
            [row.companyId, row.entityType, row.entityId, serverVersion],
          );
        }
      }
    });
  }

  /// Puts a conflicted command back in the queue after the user chose to retry
  /// it against the newer server version (baseVersion is rebased).
  void resolveConflictRetry(String commandId, int newBaseVersion) {
    _db.execute(
      "UPDATE sync_commands SET status = 'PENDING', base_version = ?, last_error = NULL WHERE command_id = ? AND status = 'CONFLICT'",
      [newBaseVersion, commandId],
    );
  }

  int entityVersion(String companyId, String entityType, String entityId) {
    final rows = _db.select(
      'SELECT version FROM entity_versions WHERE company_id = ? AND entity_type = ? AND entity_id = ?',
      [companyId, entityType, entityId],
    );
    return rows.isEmpty ? 0 : rows.first['version'] as int;
  }

  SyncCommandRow _commandFromRow(sqlite.Row row) => SyncCommandRow(
        commandId: row['command_id'] as String,
        companyId: row['company_id'] as String,
        actorId: row['actor_id'] as String,
        type: row['type'] as String,
        entityType: row['entity_type'] as String,
        entityId: row['entity_id'] as String,
        baseVersion: row['base_version'] as int,
        occurredAt: row['occurred_at'] as String,
        payload: Map<String, Object?>.from(jsonDecode(row['payload_json'] as String) as Map),
        status: row['status'] as String,
        attempts: row['attempts'] as int,
        lastError: row['last_error'] as String?,
        serverVersion: row['server_version'] as int?,
      );
}
