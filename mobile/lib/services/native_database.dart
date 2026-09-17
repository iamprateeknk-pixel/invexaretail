import 'dart:convert';
import 'dart:io';

/// Drift NativeDatabase-shaped SQLite executor. Tables match `drift_schema.sql`.
/// Isolation stays on `company_id`. Do not store stock ledger rows here.
const driftNativeSchema = '''
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_id TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT,
  user_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sealed_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  envelope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, seq)
);

CREATE TABLE IF NOT EXISTS queued_counts (
  local_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queued_actions (
  local_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sealed_mutations_company_idx ON sealed_mutations (company_id);
CREATE INDEX IF NOT EXISTS queued_counts_company_idx ON queued_counts (company_id);
''';

class NativeDatabase {
  NativeDatabase._({this.file}) : isMemory = file == null;

  factory NativeDatabase.memory() {
    final db = NativeDatabase._();
    db.applySchema();
    return db;
  }

  factory NativeDatabase.file(File file) {
    file.parent.createSync(recursive: true);
    final db = NativeDatabase._(file: file);
    db._load();
    db.applySchema();
    return db;
  }

  static Future<NativeDatabase> openApp() async {
    final home = Platform.environment['HOME'] ?? Directory.systemTemp.path;
    final dir = Directory('$home/invexa_drift');
    await dir.create(recursive: true);
    return NativeDatabase.file(File('${dir.path}/invexa_drift.sqlite'));
  }

  final File? file;
  final bool isMemory;
  final Map<String, List<Map<String, Object?>>> _tables = {};
  int _sealedId = 0;

  void applySchema() {
    _tables.putIfAbsent('sessions', () => <Map<String, Object?>>[]);
    _tables.putIfAbsent('sealed_mutations', () => <Map<String, Object?>>[]);
    _tables.putIfAbsent('queued_counts', () => <Map<String, Object?>>[]);
    _tables.putIfAbsent('queued_actions', () => <Map<String, Object?>>[]);
  }

  void close() {
    persist();
  }

  void persist() {
    final target = file;
    if (target == null) return;
    target.writeAsStringSync(jsonEncode({
      'schema': 'drift_native_v1',
      'tables': _tables,
      'sealedId': _sealedId,
    }));
  }

  void _load() {
    final target = file;
    if (target == null || !target.existsSync()) return;
    try {
      final decoded = jsonDecode(target.readAsStringSync());
      if (decoded is! Map) return;
      final tables = decoded['tables'];
      if (tables is Map) {
        tables.forEach((key, value) {
          if (value is! List) return;
          _tables[key.toString()] = value.map((row) {
            if (row is Map) return Map<String, Object?>.from(row);
            return <String, Object?>{};
          }).toList();
        });
      }
      final nextId = decoded['sealedId'];
      if (nextId is int) _sealedId = nextId;
    } catch (_) {
      // Corrupt local files reopen empty; schema is reapplied.
    }
  }

  void upsertSession({
    required String companyId,
    required String token,
    String? refreshToken,
    required String userJson,
  }) {
    _tables['sessions'] = [
      {
        'id': 1,
        'company_id': companyId,
        'token': token,
        'refresh_token': refreshToken,
        'user_json': userJson,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
    ];
    persist();
  }

  Map<String, Object?>? loadSession() {
    final rows = _tables['sessions'] ?? const [];
    if (rows.isEmpty) return null;
    return Map<String, Object?>.from(rows.first);
  }

  void clearSession() {
    _tables['sessions'] = [];
    persist();
  }

  List<String> loadSealed(String companyId) {
    final rows = (_tables['sealed_mutations'] ?? const [])
        .where((row) => row['company_id'] == companyId)
        .toList()
      ..sort((a, b) => ((a['seq'] as num?)?.toInt() ?? 0).compareTo((b['seq'] as num?)?.toInt() ?? 0));
    return rows.map((row) => row['envelope']?.toString() ?? '').toList();
  }

  void replaceSealed(String companyId, List<String> envelopes) {
    final remaining = (_tables['sealed_mutations'] ?? const [])
        .where((row) => row['company_id'] != companyId)
        .toList();
    final now = DateTime.now().toUtc().toIso8601String();
    for (var index = 0; index < envelopes.length; index += 1) {
      _sealedId += 1;
      remaining.add({
        'id': _sealedId,
        'company_id': companyId,
        'seq': index + 1,
        'envelope': envelopes[index],
        'created_at': now,
      });
    }
    _tables['sealed_mutations'] = remaining;
    persist();
  }

  void clearSealed(String companyId) {
    _tables['sealed_mutations'] = (_tables['sealed_mutations'] ?? const [])
        .where((row) => row['company_id'] != companyId)
        .toList();
    persist();
  }

  List<String> loadCounts(String companyId) {
    final rows = (_tables['queued_counts'] ?? const [])
        .where((row) => row['company_id'] == companyId)
        .toList()
      ..sort((a, b) => ((a['seq'] as num?)?.toInt() ?? 0).compareTo((b['seq'] as num?)?.toInt() ?? 0));
    return rows.map((row) => row['payload_json']?.toString() ?? '').toList();
  }

  void replaceCounts(String companyId, List<String> payloads) {
    final remaining = (_tables['queued_counts'] ?? const [])
        .where((row) => row['company_id'] != companyId)
        .toList();
    for (var index = 0; index < payloads.length; index += 1) {
      final decoded = jsonDecode(payloads[index]);
      final localId = decoded is Map ? decoded['localId']?.toString() ?? 'count-$index' : 'count-$index';
      remaining.add({
        'local_id': localId,
        'company_id': companyId,
        'payload_json': payloads[index],
        'seq': index + 1,
      });
    }
    _tables['queued_counts'] = remaining;
    persist();
  }

  List<String> loadActions() {
    final rows = (_tables['queued_actions'] ?? const []).toList()
      ..sort((a, b) => ((a['seq'] as num?)?.toInt() ?? 0).compareTo((b['seq'] as num?)?.toInt() ?? 0));
    return rows.map((row) => row['payload_json']?.toString() ?? '').toList();
  }

  void replaceActions(List<String> payloads) {
    final remaining = <Map<String, Object?>>[];
    for (var index = 0; index < payloads.length; index += 1) {
      final decoded = jsonDecode(payloads[index]);
      final localId = decoded is Map ? decoded['localId']?.toString() ?? 'action-$index' : 'action-$index';
      remaining.add({
        'local_id': localId,
        'payload_json': payloads[index],
        'seq': index + 1,
      });
    }
    _tables['queued_actions'] = remaining;
    persist();
  }
}
