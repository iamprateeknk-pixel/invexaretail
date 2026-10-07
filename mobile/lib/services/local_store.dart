import 'dart:convert';
import 'dart:math' as math;

import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';

const sessionTokenKey = 'invexa.session.token';
const sessionRefreshKey = 'invexa.session.refresh';
const sessionUserKey = 'invexa.session.user';
const queuedCountsKey = 'invexa.queue.counts';
const queuedActionsKey = 'invexa.queue.actions';
const deviceIdKey = 'invexa.device.id';

String queuedCountsKeyFor(String companyId) => 'invexa.queue.counts.$companyId';
String scopedCountsKey(String companyId, String userId) => 'invexa.queue.counts.$companyId.$userId';
String scopedActionsKey(String companyId, String userId) => 'invexa.queue.actions.$companyId.$userId';

/// A random id for this installation, created once. It tags queued work so a
/// support engineer can tell which device a stuck command came from.
String newDeviceId() {
  final random = math.Random.secure();
  return 'dev-${List.generate(16, (_) => random.nextInt(16).toRadixString(16)).join()}';
}

class PersistedSession {
  const PersistedSession({
    required this.token,
    required this.user,
    this.refreshToken,
  });

  final String token;
  final String? refreshToken;
  final AuthUser user;
}

/// Offline work is bound to who queued it (plan P0-SYNC-001): every queue read
/// and write names the company AND the user. Rows written before this binding
/// existed carry no identity; they are never handed to whoever signs in next -
/// [adoptLegacyQueues] gives them to the user of the *restored* session only
/// (the session that was active when they were queued), once.
abstract class LocalStore {
  Future<void> saveSession(PersistedSession session);
  Future<PersistedSession?> loadSession();
  Future<void> clearSession();
  Future<List<QueuedCount>> loadQueuedCounts(String companyId, String userId);
  Future<void> saveQueuedCounts(List<QueuedCount> items, String companyId, String userId);
  Future<List<QueuedAction>> loadQueuedActions(String companyId, String userId);
  Future<void> saveQueuedActions(List<QueuedAction> items, String companyId, String userId);

  /// Stamps identity-less (pre-binding) queued work with [companyId]/[userId] and removes
  /// the legacy copies. Call only with the identity of a restored, persisted session.
  Future<void> adoptLegacyQueues(String companyId, String userId);

  Future<String> deviceId();

  /// Offline read model: the last good answer of a read-only feed, per identity scope.
  Future<void> putReadModel(String scope, String path, String body);
  Future<CachedRead?> getReadModel(String scope, String path);
  Future<void> clearReadModel(String scope);
}

/// A cached read-only response and when it was fetched.
class CachedRead {
  const CachedRead(this.body, this.fetchedAt);
  final String body;
  final DateTime fetchedAt;
}

class MemoryStore implements LocalStore {
  final Map<String, CachedRead> readModel = {};

  @override
  Future<void> putReadModel(String scope, String path, String body) async {
    readModel['$scope|$path'] = CachedRead(body, DateTime.now().toUtc());
  }

  @override
  Future<CachedRead?> getReadModel(String scope, String path) async => readModel['$scope|$path'];

  @override
  Future<void> clearReadModel(String scope) async {
    readModel.removeWhere((key, _) => key.startsWith('$scope|'));
  }

  PersistedSession? session;
  final Map<String, List<QueuedCount>> countsByIdentity = {};
  final Map<String, List<QueuedAction>> actionsByIdentity = {};
  // Pre-binding rows (no identity), as an old app version would have left them.
  List<QueuedCount> legacyCounts = [];
  List<QueuedAction> legacyActions = [];
  String? _deviceId;

  String _key(String companyId, String userId) => '$companyId|$userId';

  @override
  Future<void> saveSession(PersistedSession next) async {
    session = next;
  }

  @override
  Future<PersistedSession?> loadSession() async => session;

  @override
  Future<void> clearSession() async {
    session = null;
  }

  @override
  Future<List<QueuedCount>> loadQueuedCounts(String companyId, String userId) async =>
      (countsByIdentity[_key(companyId, userId)] ?? const []).map((item) => QueuedCount.fromJson(item.toJson())).toList();

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, String companyId, String userId) async {
    countsByIdentity[_key(companyId, userId)] = items.map((item) => QueuedCount.fromJson(item.toJson())).toList();
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions(String companyId, String userId) async =>
      (actionsByIdentity[_key(companyId, userId)] ?? const []).map((item) => QueuedAction.fromJson(item.toJson())).toList();

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items, String companyId, String userId) async {
    actionsByIdentity[_key(companyId, userId)] = items.map((item) => QueuedAction.fromJson(item.toJson())).toList();
  }

  @override
  Future<void> adoptLegacyQueues(String companyId, String userId) async {
    if (legacyCounts.isEmpty && legacyActions.isEmpty) return;
    final counts = [...?countsByIdentity[_key(companyId, userId)], ...legacyCounts.map((row) => stampCount(row, userId))];
    final actions = [...?actionsByIdentity[_key(companyId, userId)], ...legacyActions.map((row) => stampAction(row, companyId, userId))];
    countsByIdentity[_key(companyId, userId)] = counts;
    actionsByIdentity[_key(companyId, userId)] = actions;
    legacyCounts = [];
    legacyActions = [];
  }

  @override
  Future<String> deviceId() async => _deviceId ??= newDeviceId();
}

/// Copies of legacy rows with the identity filled in (their ids and idempotency keys are kept).
QueuedCount stampCount(QueuedCount row, String userId, {String? deviceId}) {
  final json = row.toJson()..['userId'] = userId;
  if (deviceId != null) json['deviceId'] = deviceId;
  return QueuedCount.fromJson(json);
}

QueuedAction stampAction(QueuedAction row, String companyId, String userId, {String? deviceId}) {
  final json = row.toJson()
    ..['companyId'] = companyId
    ..['userId'] = userId;
  if (deviceId != null) json['deviceId'] = deviceId;
  return QueuedAction.fromJson(json);
}

class PrefsStore implements LocalStore {
  PrefsStore({SharedPreferences? prefs}) : _prefs = prefs;

  // Legacy preference-backed store: no offline read model (the SQLite store provides it).
  @override
  Future<void> putReadModel(String scope, String path, String body) async {}

  @override
  Future<CachedRead?> getReadModel(String scope, String path) async => null;

  @override
  Future<void> clearReadModel(String scope) async {}

  SharedPreferences? _prefs;

  Future<SharedPreferences> _ready() async {
    return _prefs ??= await SharedPreferences.getInstance();
  }

  @override
  Future<void> saveSession(PersistedSession session) async {
    final prefs = await _ready();
    await prefs.setString(sessionTokenKey, session.token);
    await prefs.setString(sessionRefreshKey, session.refreshToken ?? '');
    await prefs.setString(sessionUserKey, jsonEncode(session.user.toJson()));
  }

  @override
  Future<PersistedSession?> loadSession() async {
    final prefs = await _ready();
    final token = prefs.getString(sessionTokenKey);
    final rawUser = prefs.getString(sessionUserKey);
    if (token == null || token.isEmpty || rawUser == null || rawUser.isEmpty) {
      return null;
    }
    try {
      final decoded = jsonDecode(rawUser);
      final user = AuthUser.fromJson(asMap(decoded));
      final refresh = prefs.getString(sessionRefreshKey);
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
    final prefs = await _ready();
    await prefs.remove(sessionTokenKey);
    await prefs.remove(sessionRefreshKey);
    await prefs.remove(sessionUserKey);
  }

  @override
  Future<List<QueuedCount>> loadQueuedCounts(String companyId, String userId) async {
    final prefs = await _ready();
    return decodeQueuedCounts(prefs.getString(scopedCountsKey(companyId, userId)));
  }

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, String companyId, String userId) async {
    final prefs = await _ready();
    await prefs.setString(scopedCountsKey(companyId, userId), encodeQueuedCounts(items));
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions(String companyId, String userId) async {
    final prefs = await _ready();
    return decodeQueuedActions(prefs.getString(scopedActionsKey(companyId, userId)));
  }

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items, String companyId, String userId) async {
    final prefs = await _ready();
    await prefs.setString(scopedActionsKey(companyId, userId), encodeQueuedActions(items));
  }

  @override
  Future<void> adoptLegacyQueues(String companyId, String userId) async {
    final prefs = await _ready();
    final legacyCountRows = [
      ...decodeQueuedCounts(prefs.getString(queuedCountsKeyFor(companyId))),
      ...decodeQueuedCounts(prefs.getString(queuedCountsKey)),
    ];
    final legacyActionRows = decodeQueuedActions(prefs.getString(queuedActionsKey));
    if (legacyCountRows.isEmpty && legacyActionRows.isEmpty) return;
    final counts = [...await loadQueuedCounts(companyId, userId), ...legacyCountRows.map((row) => stampCount(row, userId))];
    final actions = [...await loadQueuedActions(companyId, userId), ...legacyActionRows.map((row) => stampAction(row, companyId, userId))];
    await saveQueuedCounts(counts, companyId, userId);
    await saveQueuedActions(actions, companyId, userId);
    await prefs.remove(queuedCountsKeyFor(companyId));
    await prefs.remove(queuedCountsKey);
    await prefs.remove(queuedActionsKey);
  }

  @override
  Future<String> deviceId() async {
    final prefs = await _ready();
    final existing = prefs.getString(deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = newDeviceId();
    await prefs.setString(deviceIdKey, created);
    return created;
  }
}
