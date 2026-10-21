import 'dart:math' as math;

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

// PrefsStore - the legacy SharedPreferences-backed LocalStore that kept the
// session token and refresh token in plaintext preferences - was removed in
// the 10/10 remediation (21 Oct 2026 audit). It was not wired anywhere:
// production uses SecureLocalStore over DriftStore (tokens only in the
// platform secure vault), and tests use MemoryStore above. Keeping a
// plaintext credential store in production source was a landmine: a single
// wiring change would have silently downgraded credential storage.
