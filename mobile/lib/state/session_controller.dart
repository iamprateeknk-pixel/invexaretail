import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/live_events.dart';
import '../services/local_store.dart';
import '../services/mobile_offline_policy.dart';
import '../services/sync_resolution.dart';

/// A key that is unique per user action and stays the same across retries.
String newRequestId() {
  final random = Random.secure();
  final suffix = List.generate(6, (_) => random.nextInt(36).toRadixString(36)).join();
  return 'req-${DateTime.now().microsecondsSinceEpoch}-$suffix';
}

class SessionController extends ChangeNotifier {
  SessionController({
    required this.api,
    required this.store,
  }) {
    api.onTokensUpdated = persistTokens;
    api.cachePut = (scope, path, body) => store.putReadModel(scope, path, body);
    api.cacheGet = (scope, path) async {
      final cached = await store.getReadModel(scope, path);
      return cached == null ? null : (body: cached.body, fetchedAt: cached.fetchedAt);
    };
    api.onCachedSnapshot = _scheduleSnapshotExpiry;
  }

  /// The offline read model is only ever read or written for the signed-in identity.
  String get _legacyCacheScope => '$companyId|$_userId';
  String get _cacheScope => '$_legacyCacheScope|${user?.role ?? ''}';
  void _bindReadModel() {
    api.cacheScope = user == null ? null : _cacheScope;
    if (_mobilePolicyIdentity != api.cacheScope) {
      api.offlinePolicy = null;
      mobileNavigation = null;
      _countPermitsRequired = false;
      _offlineCountPermit = null;
      _offlineWarehousePermits = null;
    }
  }

  /// When non-null, what is on screen is the last saved copy from this time (no network at start-up).
  DateTime? get snapshotFetchedAt => api.servedFromCacheAt;

  final InvexaApi api;
  final LocalStore store;

  bool restoring = true;
  bool busy = false;
  String? error;
  String? notice;
  String? devOtpCode;
  AuthUser? user;
  DashboardSummary? dashboard;
  List<LocationRecord> locations = [];
  List<CatalogItem> items = [];
  List<StockRow> stock = [];
  List<CountRecord> counts = [];
  List<TransferRecord> transfers = [];
  List<CountAssignment> assignments = [];
  // Drafts keep the stock revision from when the quantity was first entered,
  // even when live updates refresh the work feed or switching tabs rebuilds the form.
  final Map<({String itemId, String locationId, String? lotNo}), ({String quantity, String? stockRevision})> countDrafts = {};
  // Actionable count tasks from /mobile/work (store users). Empty on an older server.
  List<CountTask> countTasks = [];
  List<QueuedCount> queuedCounts = [];
  List<QueuedAction> queuedActions = [];
  ({int generation, Future<void> completion})? _queueReplay;
  List<Map<String, dynamic>> putawayTasks = [];
  String? selectedLocationId;
  /// Published screens for this role. Null uses the built-in role home when
  /// the service has no policy or cannot be reached.
  List<String>? mobileNavigation;
  String? _mobilePolicyIdentity;
  int _mobilePolicyRequest = 0;
  bool _countPermitsRequired = false;
  OfflinePermit? _offlineCountPermit;
  Map<String, OfflinePermit?>? _offlineWarehousePermits;
  String _countPermitScope(String identity) => 'offline-count|$identity';
  String _warehousePermitScope(String identity) => 'offline-warehouse|$identity';
  Timer? _snapshotExpiry;
  bool offlineReadsUnavailable = false;

  void _scheduleSnapshotExpiry(Duration remaining) {
    _snapshotExpiry?.cancel();
    final scope = api.cacheScope;
    _snapshotExpiry = Timer(remaining, () {
      if (api.cacheScope != scope || api.servedFromCacheAt == null) return;
      api.servedFromCacheAt = null;
      offlineReadsUnavailable = true;
      dashboard = null;
      locations = [];
      items = [];
      stock = [];
      counts = [];
      assignments = [];
      countTasks = [];
      transfers = [];
      putawayTasks = [];
      selectedLocationId = null;
      notifyListeners();
    });
  }
  // Set when sign-in needs a second factor; the login screen then asks for the code.
  String? twoFactorChallenge;
  // Set by the quick-scan sheet; the Count screen consumes it when it opens.
  String? pendingCountItemId;
  String? pendingCountLotNo;
  LiveStatus liveStatus = LiveStatus.connecting;
  LiveEventClient? _live;
  Timer? _liveDebounce;
  final Set<String> _pendingSlices = {};

  /// Queued work the server refused or that clashed with newer data: the
  /// Conflict Center lists these for an explicit retry or discard.
  int get attentionCount =>
      queuedCounts.where((row) => row.status != 'pending').length +
      queuedActions.where((row) => row.status != 'pending').length;

  bool get isSignedIn => user != null && (api.token ?? '').isNotEmpty;
  bool get isStoreUser => user?.role == 'STORE_USER';
  // Warehouse pickers also work off count assignments (the server's
  // /count-assignments/mine and /stock-counts already accept both roles) -
  // a picker's own warehouse stock counts were missing from the app entirely.
  bool get isBlindCountWorker => user?.role == 'STORE_USER' || user?.role == 'WAREHOUSE_PICKER';
  // Anyone an admin can hand count work to: branch managers too (they count with book
  // quantity visible, and someone else reviews what they submit).
  bool get isCountWorker => user != null && isCountWorkerRole(user!.role);
  bool get showBookQuantity => user != null && canSeeBookQuantity(user!.role);
  bool get allowAdHocCount => user != null && canSubmitAdHocCount(user!.role);
  String get companyId => user?.companyId ?? 'default-company';
  String get _userId => user?.id ?? '';
  String? _deviceId;

  /// Loads this user's own queued work (plan P0-SYNC-001). Anything queued by another
  /// user or company on this phone is neither shown nor replayed.
  Future<void> _loadQueues() async {
    final generation = api.sessionGeneration;
    final company = companyId;
    final actor = _userId;
    final storedCounts = await store.loadQueuedCounts(company, actor);
    final storedActions = await store.loadQueuedActions(company, actor);
    if (generation != api.sessionGeneration) return;
    queuedCounts = storedCounts;
    queuedActions = storedActions;
  }

  @visibleForTesting
  Future<void> loadQueuesForTest() => _loadQueues();

  Future<void> _saveCounts() => store.saveQueuedCounts(queuedCounts, companyId, _userId);
  Future<void> _saveActions() => store.saveQueuedActions(queuedActions, companyId, _userId);
  Future<String> _device() async => _deviceId ??= await store.deviceId();

  LocationRecord? get selectedLocation {
    for (final location in locations) {
      if (location.id == selectedLocationId) return location;
    }
    return locations.isEmpty ? null : locations.first;
  }

  Future<void> restore() async {
    restoring = true;
    error = null;
    notifyListeners();
    try {
      final session = await store.loadSession();
      if (session != null) {
        api.token = session.token;
        api.refreshToken = session.refreshToken;
        user = session.user;
        _bindReadModel();
        // Work queued before identity binding existed belongs to the session that was active
        // when it was queued - this restored one - and to no one who signs in later.
        await store.adoptLegacyQueues(companyId, _userId);
        await _loadQueues();
        await refreshAll();
        startLive();
      } else {
        queuedCounts = [];
        queuedActions = [];
      }
    } on ApiException catch (err) {
      if (err.statusCode == 401) {
        final refreshed = await api.refreshAccessToken();
        if (refreshed) {
          await refreshAll();
          startLive();
        } else {
          error = err.message;
        }
      } else {
        error = err.message;
      }
    } catch (err) {
      error = err.toString();
    } finally {
      restoring = false;
      notifyListeners();
    }
  }

  void setError(String message) {
    error = message;
    notifyListeners();
  }

  void setNotice(String message) {
    notice = message;
    error = null;
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final result = await api.login(email, password);
      user = result.user;
      _bindReadModel();
      api.refreshToken = result.refreshToken;
      await persistTokens(result.token, result.refreshToken);
      await _loadQueues();
      await refreshAll();
      startLive();
      return true;
    } on TwoFactorRequiredException catch (challenge) {
      twoFactorChallenge = challenge.challengeToken;
      return false;
    } on ApiException catch (err) {
      error = err.message;
      return false;
    } catch (err) {
      error = err.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> completeTwoFactor(String code) async {
    final challenge = twoFactorChallenge;
    if (challenge == null) return false;
    busy = true;
    error = null;
    notifyListeners();
    try {
      final result = await api.verifyTwoFactor(challenge, code);
      twoFactorChallenge = null;
      user = result.user;
      _bindReadModel();
      api.refreshToken = result.refreshToken;
      await persistTokens(result.token, result.refreshToken);
      await _loadQueues();
      await refreshAll();
      startLive();
      return true;
    } on ApiException catch (err) {
      error = err.message;
      return false;
    } catch (err) {
      error = err.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void cancelTwoFactor() {
    twoFactorChallenge = null;
    error = null;
    notifyListeners();
  }

  Future<bool> sendOtp(String email) async {
    busy = true;
    error = null;
    notice = null;
    devOtpCode = null;
    notifyListeners();
    try {
      final result = await api.sendOtp(email);
      notice = result.message;
      devOtpCode = result.otpCode;
      return true;
    } on ApiException catch (err) {
      error = err.message;
      return false;
    } catch (err) {
      error = err.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> loginWithOtp(String email, String otpCode) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final result = await api.loginWithOtp(email, otpCode);
      user = result.user;
      _bindReadModel();
      api.refreshToken = result.refreshToken;
      await persistTokens(result.token, result.refreshToken);
      await _loadQueues();
      await refreshAll();
      startLive();
      return true;
    } on TwoFactorRequiredException catch (challenge) {
      twoFactorChallenge = challenge.challengeToken;
      return false;
    } on ApiException catch (err) {
      error = err.message;
      return false;
    } catch (err) {
      error = err.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> persistTokens(String token, String? nextRefreshToken) async {
    api.token = token;
    api.refreshToken = nextRefreshToken;
    if (user == null) return;
    await store.saveSession(PersistedSession(
      token: token,
      refreshToken: nextRefreshToken,
      user: user!,
    ));
  }

  Future<void> logout({bool notify = true}) async {
    stopLive();
    final scope = user == null ? null : _cacheScope;
    final legacyScope = _legacyCacheScope;
    _mobilePolicyIdentity = null;
    _mobilePolicyRequest += 1;
    _countPermitsRequired = false;
    _offlineCountPermit = null;
    _offlineWarehousePermits = null;
    api.cacheScope = null;
    api.offlinePolicy = null;
    try {
      await api.logout();
    } catch (_) {}
    api.servedFromCacheAt = null;
    if (scope != null) {
      await store.clearReadModel(scope);
      await store.clearReadModel(legacyScope);
      await store.saveMobilePolicy(scope, null);
      await store.saveMobilePolicy(_countPermitScope(scope), null);
      await store.saveMobilePolicy(_warehousePermitScope(scope), null);
    }
    user = null;
    dashboard = null;
    locations = [];
    items = [];
    stock = [];
    counts = [];
    transfers = [];
    assignments = [];
    countTasks = [];
    countDrafts.clear();
    queuedCounts = [];
    queuedActions = [];
    selectedLocationId = null;
    mobileNavigation = null;
    offlineReadsUnavailable = false;
    await store.clearSession();
    if (notify) notifyListeners();
  }

  // ---- Live sync (blueprint v4 §11) --------------------------------------

  void startLive() {
    if (!isSignedIn) return;
    _live ??= LiveEventClient(
      url: '${api.baseUrl}/api/v1/events',
      tokenProvider: () => api.token,
      onEvents: _onLiveTopics,
      onUnauthorized: api.refreshAccessToken,
      onStatus: (status) {
        liveStatus = status;
        notifyListeners();
      },
    );
    _live!.start();
  }

  /// Foreground only: the stream is released in the background and resumed
  /// with its cursor, so the server replays whatever was missed meanwhile.
  void pauseLive() => _live?.stop();

  /// Reconnect order (blueprint v4 §38): the session was refreshed on demand
  /// by the API client, then the live cursor resumes (server replays what was
  /// missed), then the outbox flushes, then the slices are reconciled.
  void resumeLive() {
    if (!isSignedIn) return;
    startLive();
    unawaited(_reconnectSync());
  }

  Future<void> _reconnectSync() async {
    await _refreshMobilePolicy();
    if (!isSignedIn) return;
    if (api.offlinePolicy != null || api.servedFromCacheAt != null) {
      try {
        await refreshAll(refreshPolicy: false);
      } on ApiException {
        // Connection changes during a resume are retried on the next refresh.
      }
      return;
    }
    await flushQueue();
    await _refreshSlices({'assignments', 'counts', 'stock'});
  }

  void stopLive() {
    _live?.stop();
    _live = null;
    _liveDebounce?.cancel();
    _snapshotExpiry?.cancel();
    _pendingSlices.clear();
    liveStatus = LiveStatus.connecting;
  }

  void reportNetworkOffline() => _live?.markOffline();

  void _onLiveTopics(List<String> topics) {
    _pendingSlices.addAll(invalidationsForTopics(topics));
    _liveDebounce?.cancel();
    _liveDebounce = Timer(const Duration(milliseconds: 300), () {
      final slices = {..._pendingSlices};
      _pendingSlices.clear();
      unawaited(_refreshSlices(slices));
    });
  }

  // Refetches only what the events invalidated. It never touches busy/error/
  // notice, so a background update can't clobber a form the user is on.
  Future<void> _refreshSlices(Set<String> slices) async {
    if (!isSignedIn || slices.isEmpty) return;
    try {
      if (slices.contains('full')) {
        await refreshAll();
        return;
      }
      if (slices.contains('policy')) {
        final generation = api.sessionGeneration;
        await _refreshMobilePolicy();
        if (!isSignedIn || api.sessionGeneration != generation) return;
      }
      final locationId = selectedLocationId;
      final jobs = <Future<void>>[
        if (slices.contains('items')) _policyRead(api.items(), <CatalogItem>[]).then((value) => items = value),
        if (slices.contains('counts')) _policyRead(api.counts(), <CountRecord>[]).then((value) => counts = value),
        if (slices.contains('assignments') && isCountWorker)
          _policyRead(api.myAssignments(), <CountAssignment>[]).then((value) => assignments = value),
        if ((slices.contains('assignments') || slices.contains('stock')) && isCountWorker)
          _loadCountTasks(),
        if (slices.contains('stock') && locationId != null) _policyRead(api.stock(locationId), <StockRow>[]).then((value) => stock = value),
        if (slices.contains('putaway') && locationId != null)
          _policyRead(api.putawayTasks(locationId), <Map<String, dynamic>>[]).then((value) => putawayTasks = value),
        if (slices.contains('transfers')) _policyRead(api.transfers(), <TransferRecord>[]).then((value) => transfers = value),
        if (slices.contains('dashboard')) _policyRead<DashboardSummary?>(api.dashboard(), null).then((value) => dashboard = value),
      ];
      await Future.wait(jobs);
      notifyListeners();
    } on ApiException {
      // A stale slice is acceptable; the next event or app resume retries.
    }
  }

  Future<void> selectLocation(String locationId) async {
    selectedLocationId = locationId;
    notifyListeners();
    await refreshStock();
  }

  Future<void> refreshAll({bool refreshPolicy = true}) async {
    error = null;
    _snapshotExpiry?.cancel();
    offlineReadsUnavailable = false;
    api.servedFromCacheAt = null;
    if (refreshPolicy) await _refreshMobilePolicy();
    await Future.wait<void>([
      _policyRead(api.locations(), <LocationRecord>[]).then((value) => locations = value),
      _policyRead(api.items(), <CatalogItem>[]).then((value) => items = value),
      _policyRead<DashboardSummary?>(api.dashboard(), null).then((value) => dashboard = value),
      _policyRead(api.counts(), <CountRecord>[]).then((value) => counts = value),
      _policyRead(api.transfers(), <TransferRecord>[]).then((value) => transfers = value),
    ]);
    if (isCountWorker) {
      try {
        assignments = await _policyRead(api.myAssignments(), <CountAssignment>[]);
      } on ApiException {
        assignments = [];
      }
      await _loadCountTasks();
    } else {
      assignments = [];
      countTasks = [];
    }
    selectedLocationId ??= locations.isEmpty ? null : locations.first.id;
    await refreshStock();
    await refreshPutaway();
    await flushQueue();
    notifyListeners();
  }

  Future<T> _policyRead<T>(Future<T> request, T unavailable) async {
    try {
      return await request;
    } on ApiException catch (error) {
      if (!error.isOffline || api.offlinePolicy == null) rethrow;
      offlineReadsUnavailable = true;
      return unavailable;
    }
  }

  void _applyMobilePolicy(Map<String, dynamic>? policy) {
    final navigation = policy?['navigation'];
    mobileNavigation = navigation is List ? navigation.whereType<String>().toList(growable: false) : null;
    api.offlinePolicy = policy == null ? null : MobileOfflinePolicy.fromJson(policy);
  }

  Map<String, OfflinePermit?> _decodeWarehousePermits(Object? raw) {
    final permits = asMap(raw);
    return {
      for (final scope in ['picks', 'receiving', 'putaway'])
        scope: OfflinePermit.fromJson(permits[scope]),
    };
  }

  Future<void> _refreshMobilePolicy() async {
    final identity = api.cacheScope;
    if (identity == null || !isSignedIn) return;
    final attempt = ++_mobilePolicyRequest;
    bool current() => identity == api.cacheScope && attempt == _mobilePolicyRequest && isSignedIn;
    try {
      final saved = await store.loadMobilePolicy(identity);
      if (!current()) return;
      if (_mobilePolicyIdentity != identity) {
        final savedPermit = await store.loadMobilePolicy(_countPermitScope(identity));
        final savedWarehouse = await store.loadMobilePolicy(_warehousePermitScope(identity));
        if (!current()) return;
        _countPermitsRequired = savedPermit != null;
        _offlineCountPermit = null;
        if (savedPermit != null) {
          try {
            _offlineCountPermit = OfflinePermit.fromJson(jsonDecode(savedPermit));
          } on FormatException {
            // A damaged grant cannot authorize newly captured work.
          }
        }
        _offlineWarehousePermits = null;
        if (savedWarehouse != null) {
          try {
            _offlineWarehousePermits = _decodeWarehousePermits(jsonDecode(savedWarehouse));
          } on FormatException {
            _offlineWarehousePermits = {};
          }
        }
        _mobilePolicyIdentity = identity;
        if (saved == null) {
          _applyMobilePolicy(null);
        } else {
          try {
            _applyMobilePolicy(asMap(jsonDecode(saved)));
          } on FormatException {
            _applyMobilePolicy({});
          }
        }
      }
      final response = await api.runtimeConfig();
      final runtime = response['runtime'];
      if (!current() || runtime is! Map) return;
      final policy = runtime['mobilePolicy'] is Map ? asMap(runtime['mobilePolicy']) : null;
      final encoded = policy == null ? null : jsonEncode(policy);
      _applyMobilePolicy(policy);
      _countPermitsRequired = runtime.containsKey('offlineCountPermit');
      final rawPermit = runtime['offlineCountPermit'];
      _offlineCountPermit = OfflinePermit.fromJson(rawPermit);
      final rawWarehouse = runtime['offlineWarehousePermits'];
      final warehousePermitsRequired = runtime.containsKey('offlineWarehousePermits');
      _offlineWarehousePermits = warehousePermitsRequired ? _decodeWarehousePermits(rawWarehouse) : null;
      await Future.wait([
        store.saveMobilePolicy(_countPermitScope(identity), _countPermitsRequired ? jsonEncode(rawPermit) : null),
        store.saveMobilePolicy(_warehousePermitScope(identity), warehousePermitsRequired ? jsonEncode(rawWarehouse) : null),
      ]);
      if (!current()) return;
      if (encoded != saved) {
        await store.saveMobilePolicy(identity, encoded);
        if (current()) await store.clearReadModel(identity);
      }
      if (!current()) return;
      notifyListeners();
    } on ApiException {
      // Keep the last known policy when Studio is unavailable.
    } catch (_) {
      // A runtime presentation setting must not block sign-in or operational work.
    }
  }

  Future<void> _loadCountTasks() async {
    try {
      countTasks = await _policyRead(api.countTasks(), <CountTask>[]);
    } on ApiException {
      // Older server (no /mobile/work) or offline: the count screen falls back
      // to the catalog + stock list it already had.
      countTasks = [];
    }
  }

  /// The task for an assigned item, if the work feed returned one.
  CountTask? taskFor(String itemId, String locationId) {
    for (final task in countTasks) {
      if (task.item.id == itemId && task.locationId == locationId) return task;
    }
    return null;
  }

  Future<void> refreshStock() async {
    final locationId = selectedLocationId;
    if (locationId == null) {
      stock = [];
      return;
    }
    stock = await _policyRead(api.stock(locationId), <StockRow>[]);
    notifyListeners();
  }

  Future<void> refreshPutaway() async {
    final locationId = selectedLocationId;
    if (locationId == null) {
      putawayTasks = [];
      return;
    }
    try {
      putawayTasks = await _policyRead(api.putawayTasks(locationId), <Map<String, dynamic>>[]);
    } on ApiException {
      putawayTasks = [];
    }
    notifyListeners();
  }

  Future<bool> enqueueAction({
    required String type,
    required String method,
    required String path,
    required Map<String, dynamic> body,
    String? mutationId,
    bool requiresRescan = false,
  }) async {
    final generation = api.sessionGeneration;
    final deviceId = await _device();
    if (generation != api.sessionGeneration || !isSignedIn) return false;
    final localId = newRequestId();
    queuedActions = [
      ...queuedActions,
      QueuedAction(
        localId: localId,
        // The idempotency key was made when the person acted; reuse it so a replay after a crash
        // or restart is recognised by the server (X-Mutation-Id).
        mutationId: mutationId ?? localId,
        companyId: companyId,
        userId: _userId,
        deviceId: deviceId,
        type: type,
        method: method,
        path: path,
        body: Map.of(body),
        status: requiresRescan ? 'rejected' : 'pending',
        lastErrorCode: requiresRescan ? 'LOCAL_OFFLINE_WAREHOUSE_UNAVAILABLE' : null,
        lastError: requiresRescan ? 'Offline permission or a current task revision was unavailable.' : null,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await _saveActions();
    if (generation == api.sessionGeneration) {
      notice = requiresRescan
          ? 'Action saved in Sync Center. Reconnect and refresh the task before trying again.'
          : 'Offline. $type queued and will sync when the API is reachable.';
      notifyListeners();
    }
    return true;
  }

  Future<bool> runOrQueue({
    required String type,
    required String method,
    required String path,
    required Map<String, dynamic> body,
  }) async {
    error = null;
    notice = null;
    if (type == 'PICK' && queuedActions.any((action) => action.path == path && action.status == 'pending')) {
      error = 'Sync the saved pick for this transfer before saving another.';
      notifyListeners();
      return false;
    }
    busy = true;
    notifyListeners();
    // One idempotency key per user action: the body's own requestId when it has one (pick, receive),
    // otherwise a fresh one. It is reused by the offline queue and every later retry.
    final mutationId = body['requestId']?.toString().isNotEmpty == true ? body['requestId'].toString() : newRequestId();
    final generation = api.sessionGeneration;
    final warehousePermits = _offlineWarehousePermits;
    final workflow = switch (type) {
      'PICK' => (scope: 'picks', revision: 'pickRevision'),
      'TRANSFER_RECEIVE' => (scope: 'receiving', revision: 'receiveRevision'),
      'PUTAWAY' => (scope: 'putaway', revision: 'taskRevision'),
      _ => null,
    };
    // Keep the authority that was available when the action began. The
    // server can replay a committed receipt even if the permit now expired.
    final capturedPermit = workflow == null ? null : warehousePermits?[workflow.scope]?.currentToken;
    try {
      await api.sendRaw(method, path, body: body, mutationId: mutationId);
      if (generation != api.sessionGeneration || !isSignedIn) return false;
      notice = '$type saved.';
      await refreshAll();
      return true;
    } on ApiException catch (err) {
      if (generation != api.sessionGeneration || !isSignedIn) return false;
      if (err.isOffline) {
        if (warehousePermits != null && workflow != null) {
          final hasRevision = asString(body[workflow.revision]).isNotEmpty;
          final hasRequestId = type == 'PUTAWAY' || asString(body['requestId']).isNotEmpty;
          final canReplay = capturedPermit != null && hasRevision && hasRequestId;
          return enqueueAction(type: type, method: method, path: path, mutationId: mutationId,
            body: {...body, if (canReplay) 'offlinePermit': capturedPermit},
            requiresRescan: !canReplay);
        }
        if (type == 'PICK' && asString(body['pickRevision']).isEmpty) {
          error = 'Connect and refresh this pick task before saving it offline.';
          return false;
        }
        return enqueueAction(type: type, method: method, path: path, body: body, mutationId: mutationId);
      }
      error = err.message;
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  /// [weight] counts send one decimal total for the item (server splits it
  /// over the lots); everything else counts one lot. The idempotency key is
  /// made once per user action, so the offline retry reuses it.
  Future<bool> submitCount({
    required String itemId,
    required String locationId,
    required double physicalQuantity,
    String? lotNo,
    bool weight = false,
    String? stockRevision,
  }) async {
    error = null;
    notice = null;
    busy = true;
    notifyListeners();
    final requestId = newRequestId();
    final generation = api.sessionGeneration;
    final offlinePermit = _offlineCountPermit?.currentToken;
    final permitsRequired = _countPermitsRequired;
    try {
      if (weight) {
        final created = await api.submitWeightCount(itemId: itemId, locationId: locationId, totalQuantity: physicalQuantity,
          requestId: requestId, stockRevision: stockRevision);
        counts = [...created, ...counts];
      } else {
        final created = await api.submitCount(
          itemId: itemId,
          locationId: locationId,
          physicalQuantity: physicalQuantity,
          lotNo: lotNo,
          requestId: requestId,
          stockRevision: stockRevision,
        );
        counts = [created, ...counts];
      }
      notice = 'Count submitted for review.';
      // An item's assignment only closes server-side once every lot that still has stock has
      // been counted (commitLotCount's auto-close gate) - a multi-lot item needs each lot
      // submitted before the task is actually done. This used to assume the first submission
      // always closed it and drop the assignment from this list right away, which hid the still-
      // open remaining lots from the picker/store user and left the assignment permanently
      // ASSIGNED on the server with no way to reach it from the app again. Re-fetch from the
      // server instead, so the list always reflects the real close-or-still-open decision.
      if (isCountWorker) {
        try {
          assignments = await api.myAssignments();
        } on ApiException {
          // Keep the previous list; the next sync/poll corrects it.
        }
        await _loadCountTasks();
      }
      unawaited(_refreshDashboardQuietly());
      return true;
    } on ApiException catch (err) {
      if (generation != api.sessionGeneration || !isSignedIn) return false;
      if (err.isOffline) {
        final requiresRecount = permitsRequired && (offlinePermit == null || stockRevision == null);
        final queued = await enqueueCount(
          itemId: itemId,
          locationId: locationId,
          physicalQuantity: physicalQuantity,
          lotNo: lotNo,
          mode: weight ? 'weight' : 'manual',
          requestId: requestId,
          stockRevision: stockRevision,
          offlineCountPermit: requiresRecount ? null : offlinePermit,
          requiresRecount: requiresRecount,
        );
        if (queued && generation == api.sessionGeneration && isSignedIn) {
          notice = requiresRecount
              ? 'Count saved in Sync Center. Reconnect and refresh the task to count again.'
              : 'Offline. Count queued and will sync when the API is reachable.';
        }
        return queued;
      }
      error = err.message;
      if (err.code == 'COUNT_STOCK_CHANGED' && isCountWorker) await _loadCountTasks();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  // Runs after the busy submit completes so the UI unblocks immediately;
  // dashboard KPIs (pending counts, accuracy, etc.) catch up shortly after
  // instead of holding up every single save.
  Future<void> _refreshDashboardQuietly() async {
    try {
      dashboard = await api.dashboard();
      notifyListeners();
    } catch (_) {
      // Best-effort - a stale dashboard is fine, the next screen visit or
      // pull-to-refresh will pick up the latest numbers.
    }
  }

  Future<bool> enqueueCount({
    required String itemId,
    required String locationId,
    required double physicalQuantity,
    String? lotNo,
    String mode = 'manual',
    String? requestId,
    String? stockRevision,
    String? offlineCountPermit,
    bool requiresRecount = false,
  }) async {
    final generation = api.sessionGeneration;
    final deviceId = await _device();
    if (generation != api.sessionGeneration || !isSignedIn) return false;
    final localId = newRequestId();
    queuedCounts = [
      ...queuedCounts,
      QueuedCount(
        localId: localId,
        userId: _userId,
        deviceId: deviceId,
        requestId: requestId ?? localId,
        stockRevision: stockRevision,
        offlineCountPermit: offlineCountPermit,
        status: requiresRecount ? 'rejected' : 'pending',
        lastErrorCode: requiresRecount ? 'LOCAL_OFFLINE_COUNT_UNAVAILABLE' : null,
        lastError: requiresRecount ? 'Offline count permission or a current task revision was unavailable.' : null,
        itemId: itemId,
        locationId: locationId,
        physicalQuantity: physicalQuantity,
        lotNo: lotNo,
        mode: mode,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await _saveCounts();
    if (generation == api.sessionGeneration) notifyListeners();
    return true;
  }

  Future<void> dismissQueued(String localId) async {
    queuedCounts = queuedCounts.where((item) => item.localId != localId).toList();
    await _saveCounts();
    notifyListeners();
  }

  Future<void> dismissQueuedAction(String localId) async {
    queuedActions = queuedActions.where((item) => item.localId != localId).toList();
    await _saveActions();
    notifyListeners();
  }

  /// A queued item the user has reviewed after a conflict/rejection: put it
  /// back to 'pending' and flush immediately, so a manual retry doesn't wait
  /// for the next automatic flush.
  Future<void> retryQueuedCount(String localId) async {
    for (final item in queuedCounts) {
      if (item.localId == localId) {
        if (item.requiresRecount) return;
        item.status = 'pending';
        item.lastError = null;
        item.lastErrorCode = null;
        item.nextAttemptAt = null;
      }
    }
    await _saveCounts();
    notifyListeners();
    await flushQueue();
  }

  Future<void> retryQueuedAction(String localId) async {
    for (final item in queuedActions) {
      if (item.localId == localId) {
        if (item.requiresRescan) return;
        item.status = 'pending';
        item.lastError = null;
        item.lastErrorCode = null;
        item.nextAttemptAt = null;
      }
    }
    await _saveActions();
    notifyListeners();
    await flushQueue();
  }

  Future<void> flushQueue({DateTime? now, Random? random}) {
    if (!isSignedIn) return Future.value();
    final generation = api.sessionGeneration;
    final running = _queueReplay;
    if (running?.generation == generation) return running!.completion;
    if (queuedCounts.isEmpty && queuedActions.isEmpty) return Future.value();
    final owner = user;
    final completion = _replayQueue(
      clock: now ?? DateTime.now(),
      random: random,
      active: () => api.sessionGeneration == generation && identical(user, owner) && isSignedIn,
    ).whenComplete(() {
      if (_queueReplay?.generation == generation) _queueReplay = null;
    });
    _queueReplay = (generation: generation, completion: completion);
    return completion;
  }

  Future<void> _replayQueue({required DateTime clock, required bool Function() active, Random? random}) async {
    final company = companyId;
    final me = _userId;
    final queue = <QueuedOperation>[...queuedCounts, ...queuedActions]
        .indexed
        .map((entry) => (
              index: entry.$1,
              item: entry.$2,
              capturedAt: DateTime.tryParse(entry.$2.createdAt)?.microsecondsSinceEpoch ?? 0,
            ))
        .toList()
      ..sort((a, b) {
        final order = a.capturedAt.compareTo(b.capturedAt);
        return order == 0 ? a.index.compareTo(b.index) : order;
      });
    var sent = 0;

    bool stillQueued(QueuedOperation item) => switch (item) {
      QueuedCount() => queuedCounts.contains(item),
      QueuedAction() => queuedActions.contains(item),
    };

    Future<void> persist(QueuedOperation item) =>
        item is QueuedCount ? _saveCounts() : _saveActions();

    for (final entry in queue) {
      if (!active()) return;
      final item = entry.item;
      if (!stillQueued(item) || item.status != 'pending') continue;
      if (item.userId.isNotEmpty && item.userId != me) continue;
      if (item is QueuedAction && item.companyId != company) continue;
      // A transient failure holds later pending work across both workflows.
      // Conflicts remain in Sync Center for the operator to resolve.
      if (!isDueForAttempt(item.nextAttemptAt, clock)) break;
      try {
        switch (item) {
          case QueuedCount():
            await _sendQueuedCount(item);
          case QueuedAction():
            await api.sendRaw(item.method, item.path, body: item.body, mutationId: item.mutationId);
        }
      } on ApiException catch (err) {
        if (!active()) return;
        if (!stillQueued(item)) continue;
        item.attempts += 1;
        item.lastError = err.message;
        item.lastErrorCode = err.code;
        final outcome = classifySyncFailure(isOffline: err.isOffline, statusCode: err.statusCode, code: err.code, attempts: item.attempts);
        if (outcome == SyncOutcome.retry) {
          item.nextAttemptAt = clock.add(retryDelay(attempts: item.attempts, retryAfterSeconds: err.retryAfterSeconds, random: random)).toIso8601String();
        } else {
          item.status = outcome == SyncOutcome.conflict ? 'conflict' : 'rejected';
        }
        await persist(item);
        if (outcome == SyncOutcome.retry) break;
        continue;
      }
      if (!active()) return;
      switch (item) {
        case QueuedCount():
          queuedCounts = queuedCounts.where((queued) => !identical(queued, item)).toList();
        case QueuedAction():
          queuedActions = queuedActions.where((queued) => !identical(queued, item)).toList();
      }
      await persist(item);
      sent += 1;
    }
    if (!active()) return;
    if (sent > 0) {
      notice = sent == 1 ? 'Synced 1 queued action.' : 'Synced $sent queued actions.';
      try {
        final updatedCounts = await api.counts();
        if (!active()) return;
        final updatedDashboard = await api.dashboard();
        if (!active()) return;
        counts = updatedCounts;
        dashboard = updatedDashboard;
      } on ApiException {
        // The sends are already recorded. The next refresh can update the dashboard.
      }
    }
    if (active()) notifyListeners();
  }
  Future<void> _sendQueuedCount(QueuedCount item) async {
    if (item.mode == 'weight') {
      await api.submitWeightCount(
        itemId: item.itemId,
        locationId: item.locationId,
        totalQuantity: item.physicalQuantity,
        requestId: item.requestId,
        stockRevision: item.stockRevision,
        offlineCountPermit: item.offlineCountPermit,
      );
      return;
    }
    await api.submitCount(
      itemId: item.itemId,
      locationId: item.locationId,
      physicalQuantity: item.physicalQuantity,
      lotNo: item.lotNo,
      mode: item.mode,
      requestId: item.requestId,
      stockRevision: item.stockRevision,
      offlineCountPermit: item.offlineCountPermit,
    );
  }

}
