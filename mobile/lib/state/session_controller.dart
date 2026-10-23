import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/live_events.dart';
import '../services/local_store.dart';
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
  }

  /// The offline read model is only ever read or written for the signed-in identity.
  String get _cacheScope => '$companyId|$_userId';
  void _bindReadModel() => api.cacheScope = user == null ? null : _cacheScope;

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
  // Half-typed quantities, keyed itemId|locationId. Switching tabs rebuilds the
  // count screen, so a number typed before a phone call is not lost.
  final Map<String, String> countDrafts = {};
  // Actionable count tasks from /mobile/work (store users). Empty on an older server.
  List<CountTask> countTasks = [];
  List<QueuedCount> queuedCounts = [];
  List<QueuedAction> queuedActions = [];
  List<Map<String, dynamic>> putawayTasks = [];
  String? selectedLocationId;
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
    queuedCounts = await store.loadQueuedCounts(companyId, _userId);
    queuedActions = await store.loadQueuedActions(companyId, _userId);
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
    try {
      await api.logout();
    } catch (_) {}
    final scope = user == null ? null : _cacheScope;
    api.cacheScope = null;
    api.servedFromCacheAt = null;
    if (scope != null) await store.clearReadModel(scope); // a signed-out phone keeps no stock data
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
    api.clearToken();
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
    await flushQueue();
    await _refreshSlices({'assignments', 'counts', 'stock'});
  }

  void stopLive() {
    _live?.stop();
    _live = null;
    _liveDebounce?.cancel();
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
      final locationId = selectedLocationId;
      final jobs = <Future<void>>[
        if (slices.contains('items')) api.items().then((value) => items = value),
        if (slices.contains('counts')) api.counts().then((value) => counts = value),
        if (slices.contains('assignments') && isCountWorker)
          api.myAssignments().then((value) => assignments = value),
        if ((slices.contains('assignments') || slices.contains('stock')) && isCountWorker)
          _loadCountTasks(),
        if (slices.contains('stock') && locationId != null) api.stock(locationId).then((value) => stock = value),
        if (slices.contains('putaway') && locationId != null)
          api.putawayTasks(locationId).then((value) => putawayTasks = value),
        if (slices.contains('transfers')) api.transfers().then((value) => transfers = value),
        if (slices.contains('dashboard')) api.dashboard().then((value) => dashboard = value),
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

  Future<void> refreshAll() async {
    error = null;
    api.servedFromCacheAt = null;
    final locationFuture = api.locations();
    final itemFuture = api.items();
    final dashFuture = api.dashboard();
    final countFuture = api.counts();
    final transferFuture = api.transfers();
    locations = await locationFuture;
    items = await itemFuture;
    dashboard = await dashFuture;
    counts = await countFuture;
    transfers = await transferFuture;
    if (isCountWorker) {
      try {
        assignments = await api.myAssignments();
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

  Future<void> _loadCountTasks() async {
    try {
      countTasks = await api.countTasks();
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
    stock = await api.stock(locationId);
    notifyListeners();
  }

  Future<void> refreshPutaway() async {
    final locationId = selectedLocationId;
    if (locationId == null) {
      putawayTasks = [];
      return;
    }
    try {
      putawayTasks = await api.putawayTasks(locationId);
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
  }) async {
    final localId = 'act-${DateTime.now().microsecondsSinceEpoch}';
    queuedActions = [
      ...queuedActions,
      QueuedAction(
        localId: localId,
        // The idempotency key was made when the person acted; reuse it so a replay after a crash
        // or restart is recognised by the server (X-Mutation-Id).
        mutationId: mutationId ?? localId,
        companyId: companyId,
        userId: _userId,
        deviceId: await _device(),
        type: type,
        method: method,
        path: path,
        body: body,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await _saveActions();
    notice = 'Offline. $type queued and will sync when the API is reachable.';
    notifyListeners();
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
    busy = true;
    notifyListeners();
    // One idempotency key per user action: the body's own requestId when it has one (pick, receive),
    // otherwise a fresh one. It is reused by the offline queue and every later retry.
    final mutationId = body['requestId']?.toString().isNotEmpty == true ? body['requestId'].toString() : newRequestId();
    try {
      await api.sendRaw(method, path, body: body, mutationId: mutationId);
      notice = '$type saved.';
      await refreshAll();
      return true;
    } on ApiException catch (err) {
      if (err.isOffline) {
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
  }) async {
    error = null;
    notice = null;
    busy = true;
    notifyListeners();
    final requestId = newRequestId();
    try {
      if (weight) {
        final created = await api.submitWeightCount(itemId: itemId, locationId: locationId, totalQuantity: physicalQuantity, requestId: requestId);
        counts = [...created, ...counts];
      } else {
        final created = await api.submitCount(
          itemId: itemId,
          locationId: locationId,
          physicalQuantity: physicalQuantity,
          lotNo: lotNo,
          requestId: requestId,
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
      if (err.isOffline) {
        await enqueueCount(
          itemId: itemId,
          locationId: locationId,
          physicalQuantity: physicalQuantity,
          lotNo: lotNo,
          mode: weight ? 'weight' : 'manual',
          requestId: requestId,
        );
        notice = 'Offline. Count queued and will sync when the API is reachable.';
        return true;
      }
      error = err.message;
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

  Future<void> enqueueCount({
    required String itemId,
    required String locationId,
    required double physicalQuantity,
    String? lotNo,
    String mode = 'manual',
    String? requestId,
  }) async {
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    queuedCounts = [
      ...queuedCounts,
      QueuedCount(
        localId: localId,
        userId: _userId,
        deviceId: await _device(),
        requestId: requestId ?? localId,
        itemId: itemId,
        locationId: locationId,
        physicalQuantity: physicalQuantity,
        lotNo: lotNo,
        mode: mode,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await _saveCounts();
    notifyListeners();
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
        item.status = 'pending';
        item.lastError = null;
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
        item.status = 'pending';
        item.lastError = null;
        item.nextAttemptAt = null;
      }
    }
    await _saveActions();
    notifyListeners();
    await flushQueue();
  }

  Future<void> flushQueue({DateTime? now, Random? random}) async {
    if (!isSignedIn) return;
    if (queuedCounts.isEmpty && queuedActions.isEmpty) return;
    final clock = now ?? DateTime.now();
    final me = _userId;
    var sent = 0;

    // Never replay under a different identity (plan P0-SYNC-001): the lists are loaded per
    // user, and this guard keeps that true even if something stale is ever in memory.
    bool mine(String itemUser) => itemUser.isEmpty || itemUser == me;

    final remainingCounts = <QueuedCount>[];
    var stopCounts = false;
    for (final item in queuedCounts) {
      // A conflict/rejected item waits for the user's explicit retry (retryQueuedCount) - never
      // resubmitted silently. A backed-off item waits for its time. Anything after a transient
      // failure waits too, so the order the person worked in is preserved.
      if (item.status != 'pending' || !mine(item.userId)) {
        remainingCounts.add(item);
        continue;
      }
      // A pending item that is backing off holds back everything queued after it.
      if (stopCounts || !isDueForAttempt(item.nextAttemptAt, clock)) {
        stopCounts = true;
        remainingCounts.add(item);
        continue;
      }
      try {
        if (item.mode == 'weight') {
          await api.submitWeightCount(
            itemId: item.itemId,
            locationId: item.locationId,
            totalQuantity: item.physicalQuantity,
            requestId: item.requestId,
          );
        } else {
          await api.submitCount(
            itemId: item.itemId,
            locationId: item.locationId,
            physicalQuantity: item.physicalQuantity,
            lotNo: item.lotNo,
            mode: item.mode,
            requestId: item.requestId,
          );
        }
        sent += 1;
      } on ApiException catch (err) {
        item.attempts += 1;
        item.lastError = err.message;
        final outcome = classifySyncFailure(isOffline: err.isOffline, statusCode: err.statusCode, attempts: item.attempts, retryAfterSeconds: err.retryAfterSeconds);
        if (outcome == SyncOutcome.retry) {
          item.nextAttemptAt = clock.add(retryDelay(attempts: item.attempts, retryAfterSeconds: err.retryAfterSeconds, random: random)).toIso8601String();
          stopCounts = true;
        } else {
          item.status = outcome == SyncOutcome.conflict ? 'conflict' : 'rejected';
        }
        remainingCounts.add(item);
      }
    }
    queuedCounts = remainingCounts;
    await _saveCounts();

    final remainingActions = <QueuedAction>[];
    var stopActions = false;
    for (final item in queuedActions) {
      if (item.status != 'pending' || !mine(item.userId)) {
        remainingActions.add(item);
        continue;
      }
      if (stopActions || !isDueForAttempt(item.nextAttemptAt, clock)) {
        stopActions = true;
        remainingActions.add(item);
        continue;
      }
      try {
        await api.sendRaw(item.method, item.path, body: item.body, mutationId: item.mutationId);
        sent += 1;
      } on ApiException catch (err) {
        item.attempts += 1;
        item.lastError = err.message;
        final outcome = classifySyncFailure(isOffline: err.isOffline, statusCode: err.statusCode, attempts: item.attempts, retryAfterSeconds: err.retryAfterSeconds);
        if (outcome == SyncOutcome.retry) {
          item.nextAttemptAt = clock.add(retryDelay(attempts: item.attempts, retryAfterSeconds: err.retryAfterSeconds, random: random)).toIso8601String();
          stopActions = true;
        } else {
          item.status = outcome == SyncOutcome.conflict ? 'conflict' : 'rejected';
        }
        remainingActions.add(item);
      }
    }
    queuedActions = remainingActions;
    await _saveActions();
    if (sent > 0) {
      notice = sent == 1 ? 'Synced 1 queued action.' : 'Synced $sent queued actions.';
      counts = await api.counts();
      dashboard = await api.dashboard();
    }
    notifyListeners();
  }
}
