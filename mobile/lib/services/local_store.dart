import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';

const sessionTokenKey = 'invexa.session.token';
const sessionRefreshKey = 'invexa.session.refresh';
const sessionUserKey = 'invexa.session.user';
const queuedCountsKey = 'invexa.queue.counts';
const queuedActionsKey = 'invexa.queue.actions';

String queuedCountsKeyFor(String companyId) => 'invexa.queue.counts.$companyId';

String sealedQueueKeyFor(String companyId) => 'invexa.vault.$companyId';

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

abstract class LocalStore {
  Future<void> saveSession(PersistedSession session);
  Future<PersistedSession?> loadSession();
  Future<void> clearSession();
  Future<List<QueuedCount>> loadQueuedCounts([String companyId = 'default-company']);
  Future<void> saveQueuedCounts(List<QueuedCount> items, [String companyId = 'default-company']);
  Future<List<String>> loadSealedQueue(String companyId);
  Future<void> saveSealedQueue(String companyId, List<String> envelopes);
  Future<void> clearSealedQueue(String companyId);
  Future<List<QueuedAction>> loadQueuedActions();
  Future<void> saveQueuedActions(List<QueuedAction> items);
}

class MemoryStore implements LocalStore {
  PersistedSession? session;
  final Map<String, List<QueuedCount>> queuedByCompany = {};
  final Map<String, List<String>> sealedByCompany = {};
  List<QueuedAction> queuedActions = [];

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
  Future<List<QueuedCount>> loadQueuedCounts([String companyId = 'default-company']) async {
    final rows = queuedByCompany[companyId] ?? queued;
    return rows.map((item) => QueuedCount.fromJson(item.toJson())).toList();
  }

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, [String companyId = 'default-company']) async {
    queuedByCompany[companyId] = items.map((item) => QueuedCount.fromJson(item.toJson())).toList();
    if (companyId == 'default-company') queued = queuedByCompany[companyId]!;
  }

  List<QueuedCount> queued = [];

  @override
  Future<List<String>> loadSealedQueue(String companyId) async =>
      List<String>.from(sealedByCompany[companyId] ?? const []);

  @override
  Future<void> saveSealedQueue(String companyId, List<String> envelopes) async {
    sealedByCompany[companyId] = List<String>.from(envelopes);
  }

  @override
  Future<void> clearSealedQueue(String companyId) async {
    sealedByCompany.remove(companyId);
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions() async =>
      queuedActions.map((item) => QueuedAction.fromJson(item.toJson())).toList();

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items) async {
    queuedActions = items.map((item) => QueuedAction.fromJson(item.toJson())).toList();
  }
}

class PrefsStore implements LocalStore {
  PrefsStore({SharedPreferences? prefs}) : _prefs = prefs;

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
  Future<List<QueuedCount>> loadQueuedCounts([String companyId = 'default-company']) async {
    final prefs = await _ready();
    final scoped = decodeQueuedCounts(prefs.getString(queuedCountsKeyFor(companyId)));
    if (scoped.isNotEmpty || companyId != 'default-company') return scoped;
    return decodeQueuedCounts(prefs.getString(queuedCountsKey));
  }

  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, [String companyId = 'default-company']) async {
    final prefs = await _ready();
    await prefs.setString(queuedCountsKeyFor(companyId), encodeQueuedCounts(items));
  }

  @override
  Future<List<String>> loadSealedQueue(String companyId) async {
    final prefs = await _ready();
    final raw = prefs.getString(sealedQueueKeyFor(companyId));
    if (raw == null || raw.trim().isEmpty) return const [];
    try {
      return asList(jsonDecode(raw)).map(asString).toList();
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<void> saveSealedQueue(String companyId, List<String> envelopes) async {
    final prefs = await _ready();
    await prefs.setString(sealedQueueKeyFor(companyId), jsonEncode(envelopes));
  }

  @override
  Future<void> clearSealedQueue(String companyId) async {
    final prefs = await _ready();
    await prefs.remove(sealedQueueKeyFor(companyId));
  }

  @override
  Future<List<QueuedAction>> loadQueuedActions() async {
    final prefs = await _ready();
    return decodeQueuedActions(prefs.getString(queuedActionsKey));
  }

  @override
  Future<void> saveQueuedActions(List<QueuedAction> items) async {
    final prefs = await _ready();
    await prefs.setString(queuedActionsKey, encodeQueuedActions(items));
  }
}
