import 'dart:convert';
import 'dart:io';

import '../models/models.dart';
import 'local_store.dart';
import 'native_database.dart';

/// Drift-shaped local store backed by [NativeDatabase] tables from
/// `drift_schema.sql`. Tests use [DriftStore.inMemory]; the app opens a file.
class DriftStore implements LocalStore {
  DriftStore.native(this._db);

  DriftStore.inMemory() : _db = NativeDatabase.memory();

  factory DriftStore({File? file}) {
    return DriftStore.native(file == null ? NativeDatabase.memory() : NativeDatabase.file(file));
  }

  static Future<DriftStore> open() async {
    return DriftStore.native(await NativeDatabase.openApp());
  }

  final NativeDatabase _db;

  bool get isMemory => _db.isMemory;

  void close() => _db.close();

  @override
  Future<void> saveSession(PersistedSession session) async {
    _db.upsertSession(
      companyId: session.user.companyId ?? 'default-company',
      token: session.token,
      refreshToken: session.refreshToken,
      userJson: jsonEncode(session.user.toJson()),
    );
  }

  @override
  Future<PersistedSession?> loadSession() async {
    final row = _db.loadSession();
    if (row == null) return null;
    final token = row['token']?.toString() ?? '';
    if (token.isEmpty) return null;
    try {
      final user = AuthUser.fromJson(asMap(jsonDecode(row['user_json']?.toString() ?? '{}')));
      final refresh = row['refresh_token']?.toString();
      return PersistedSession(
        token: token,
        refreshToken: refresh == null || refresh.isEmpty ? null : refresh,
        user: user,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> clearSession() async {
    _db.clearSession();
  }

  @override
  Future<List<QueuedCount>> loadQueuedCounts([String companyId = 'default-company']) async {
    return _db.loadCounts(companyId).map((raw) {
      try {
        return QueuedCount.fromJson(asMap(jsonDecode(raw)));
      } catch (_) {
        return QueuedCount(
          localId: '',
          itemId: '',
          locationId: '',
          physicalQuantity: 0,
          createdAt: '',
        );
      }
    }).where((item) => item.localId.isNotEmpty).toList();
  }

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, [String companyId = 'default-company']) async {
    _db.replaceCounts(companyId, items.map((item) => jsonEncode(item.toJson())).toList());
  }

  @override
  Future<List<String>> loadSealedQueue(String companyId) async {
    return _db.loadSealed(companyId);
  }

  @override
  Future<void> saveSealedQueue(String companyId, List<String> envelopes) async {
    _db.replaceSealed(companyId, envelopes);
  }

  @override
  Future<void> clearSealedQueue(String companyId) async {
    _db.clearSealed(companyId);
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions() async {
    return _db.loadActions().map((raw) {
      try {
        return QueuedAction.fromJson(asMap(jsonDecode(raw)));
      } catch (_) {
        return QueuedAction(
          localId: '',
          type: '',
          method: 'POST',
          path: '',
          body: const {},
          createdAt: '',
        );
      }
    }).where((item) => item.localId.isNotEmpty).toList();
  }

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items) async {
    _db.replaceActions(items.map((item) => jsonEncode(item.toJson())).toList());
  }
}
