import 'dart:convert';
import 'dart:io';

import '../models/models.dart';
import 'local_store.dart';
import 'native_database.dart';

/// Local store backed by the real SQLite [NativeDatabase] (see `drift_schema.sql`). Tests use [DriftStore.inMemory]; the app opens a file.
///
/// Queued work is identity-bound (plan P0-SYNC-001): the `userId` (and, for
/// actions, `companyId`) written into each payload decides who may see it.
/// Loads return only the caller's own rows; saves replace only the caller's own
/// rows and leave everyone else's (and any identity-less legacy rows) untouched.
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

  Map<String, dynamic>? _decode(String raw) {
    try {
      return asMap(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  bool _mine(Map<String, dynamic> json, String userId) => asString(json['userId']) == userId;

  bool _mineAction(Map<String, dynamic> json, String companyId, String userId) =>
      asString(json['userId']) == userId && asString(json['companyId']) == companyId;

  bool _legacy(Map<String, dynamic> json) => asString(json['userId']).isEmpty;

  @override
  Future<List<QueuedCount>> loadQueuedCounts(String companyId, String userId) async {
    return _db
        .loadCounts(companyId)
        .map(_decode)
        .whereType<Map<String, dynamic>>()
        .where((json) => _mine(json, userId))
        .map(QueuedCount.fromJson)
        .where((item) => item.localId.isNotEmpty)
        .toList();
  }

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, String companyId, String userId) async {
    final others = _db.loadCounts(companyId).where((raw) {
      final json = _decode(raw);
      return json != null && !_mine(json, userId);
    });
    _db.replaceCounts(companyId, [...others, ...items.map((item) => jsonEncode(item.toJson()))]);
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions(String companyId, String userId) async {
    return _db
        .loadActions()
        .map(_decode)
        .whereType<Map<String, dynamic>>()
        .where((json) => _mineAction(json, companyId, userId))
        .map(QueuedAction.fromJson)
        .where((item) => item.localId.isNotEmpty)
        .toList();
  }

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items, String companyId, String userId) async {
    final others = _db.loadActions().where((raw) {
      final json = _decode(raw);
      return json != null && !_mineAction(json, companyId, userId);
    });
    _db.replaceActions([...others, ...items.map((item) => jsonEncode(item.toJson()))]);
  }

  @override
  Future<void> adoptLegacyQueues(String companyId, String userId) async {
    final deviceId = await this.deviceId();
    final countRows = _db.loadCounts(companyId);
    final adoptedCounts = <String>[];
    final keptCounts = <String>[];
    for (final raw in countRows) {
      final json = _decode(raw);
      if (json != null && _legacy(json)) {
        adoptedCounts.add(jsonEncode(stampCount(QueuedCount.fromJson(json), userId, deviceId: deviceId).toJson()));
      } else {
        keptCounts.add(raw);
      }
    }
    if (adoptedCounts.isNotEmpty) _db.replaceCounts(companyId, [...keptCounts, ...adoptedCounts]);

    final actionRows = _db.loadActions();
    final adoptedActions = <String>[];
    final keptActions = <String>[];
    for (final raw in actionRows) {
      final json = _decode(raw);
      if (json != null && _legacy(json)) {
        adoptedActions.add(jsonEncode(stampAction(QueuedAction.fromJson(json), companyId, userId, deviceId: deviceId).toJson()));
      } else {
        keptActions.add(raw);
      }
    }
    if (adoptedActions.isNotEmpty) _db.replaceActions([...keptActions, ...adoptedActions]);
  }

  @override
  Future<String> deviceId() async => _db.deviceId(newDeviceId);
}
