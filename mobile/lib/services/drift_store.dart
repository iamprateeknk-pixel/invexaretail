import 'dart:convert';
import 'dart:io';

import '../models/models.dart';
import 'local_store.dart';
import 'native_database.dart';

/// Local store backed by the real SQLite [NativeDatabase] (see `drift_schema.sql`). Tests use [DriftStore.inMemory]; the app opens a file.
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

  // Refresh credentials and access tokens are never written to SQLite: they
  // belong to Keychain/Keystore-backed secure storage (see SecureLocalStore).
  @override
  Future<void> saveSession(PersistedSession session) async {}

  @override
  Future<PersistedSession?> loadSession() async => null;

  @override
  Future<void> clearSession() async {}

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
