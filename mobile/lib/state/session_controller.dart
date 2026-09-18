import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/live_events.dart';
import '../services/local_store.dart';
import '../services/sync_resolution.dart';

class SessionController extends ChangeNotifier {
  SessionController({
    required this.api,
    required this.store,
  }) {
    api.onTokensUpdated = persistTokens;
  }

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
  List<QueuedCount> queuedCounts = [];
  List<QueuedAction> queuedActions = [];
  List<Map<String, dynamic>> putawayTasks = [];
  String? selectedLocationId;
  LiveStatus liveStatus = LiveStatus.connecting;
  LiveEventClient? _live;
  Timer? _liveDebounce;
  final Set<String> _pendingSlices = {};

  bool get isSignedIn => user != null && (api.token ?? '').isNotEmpty;
  bool get isStoreUser => user?.role == 'STORE_USER';
  bool get showBookQuantity => user != null && canSeeBookQuantity(user!.role);
  bool get allowAdHocCount => user != null && canSubmitAdHocCount(user!.role);
  String get companyId => user?.companyId ?? 'default-company';

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
      queuedActions = await store.loadQueuedActions();
      final session = await store.loadSession();
      if (session != null) {
        api.token = session.token;
        api.refreshToken = session.refreshToken;
        user = session.user;
        queuedCounts = await store.loadQueuedCounts(companyId);
        await refreshAll();
        startLive();
      } else {
        queuedCounts = [];
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
      api.refreshToken = result.refreshToken;
      await persistTokens(result.token, result.refreshToken);
      queuedCounts = await store.loadQueuedCounts(companyId);
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
      api.refreshToken = result.refreshToken;
      await persistTokens(result.token, result.refreshToken);
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
    user = null;
    dashboard = null;
    locations = [];
    items = [];
    stock = [];
    counts = [];
    transfers = [];
    assignments = [];
    queuedCounts = [];
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

  void resumeLive() {
    if (!isSignedIn) return;
    startLive();
    unawaited(flushQueue());
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
        if (slices.contains('assignments') && user?.role == 'STORE_USER')
          api.myAssignments().then((value) => assignments = value),
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
    if (user?.role == 'STORE_USER') {
      try {
        assignments = await api.myAssignments();
      } on ApiException {
        assignments = [];
      }
    } else {
      assignments = [];
    }
    selectedLocationId ??= locations.isEmpty ? null : locations.first.id;
    await refreshStock();
    await refreshPutaway();
    await flushQueue();
    notifyListeners();
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
  }) async {
    queuedActions = [
      ...queuedActions,
      QueuedAction(
        localId: 'act-${DateTime.now().microsecondsSinceEpoch}',
        type: type,
        method: method,
        path: path,
        body: body,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await store.saveQueuedActions(queuedActions);
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
    try {
      await api.sendRaw(method, path, body: body);
      notice = '$type saved.';
      await refreshAll();
      return true;
    } on ApiException catch (err) {
      if (err.isOffline) {
        return enqueueAction(type: type, method: method, path: path, body: body);
      }
      error = err.message;
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> submitCount({
    required String itemId,
    required String locationId,
    required int physicalQuantity,
    String? lotNo,
  }) async {
    error = null;
    notice = null;
    busy = true;
    notifyListeners();
    try {
      final created = await api.submitCount(
        itemId: itemId,
        locationId: locationId,
        physicalQuantity: physicalQuantity,
        lotNo: lotNo,
      );
      notice = 'Count submitted for review.';
      // Update local state from the response instead of re-fetching the
      // whole counts list and dashboard on every submit - that was costing
      // two extra sequential round trips per save. The submitted item's
      // assignment (if any) is closed server-side, so drop it locally too.
      counts = [created, ...counts];
      assignments = assignments.where((row) => !(row.itemId == itemId && row.locationId == locationId)).toList();
      unawaited(_refreshDashboardQuietly());
      return true;
    } on ApiException catch (err) {
      if (err.isOffline) {
        await enqueueCount(
          itemId: itemId,
          locationId: locationId,
          physicalQuantity: physicalQuantity,
          lotNo: lotNo,
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
    required int physicalQuantity,
    String? lotNo,
  }) async {
    queuedCounts = [
      ...queuedCounts,
      QueuedCount(
        localId: 'local-${DateTime.now().microsecondsSinceEpoch}',
        itemId: itemId,
        locationId: locationId,
        physicalQuantity: physicalQuantity,
        lotNo: lotNo,
        createdAt: DateTime.now().toIso8601String(),
      ),
    ];
    await store.saveQueuedCounts(queuedCounts, companyId);
    notifyListeners();
  }

  Future<void> dismissQueued(String localId) async {
    queuedCounts = queuedCounts.where((item) => item.localId != localId).toList();
    await store.saveQueuedCounts(queuedCounts, companyId);
    notifyListeners();
  }

  Future<void> dismissQueuedAction(String localId) async {
    queuedActions = queuedActions.where((item) => item.localId != localId).toList();
    await store.saveQueuedActions(queuedActions);
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
      }
    }
    await store.saveQueuedCounts(queuedCounts, companyId);
    notifyListeners();
    await flushQueue();
  }

  Future<void> retryQueuedAction(String localId) async {
    for (final item in queuedActions) {
      if (item.localId == localId) {
        item.status = 'pending';
        item.lastError = null;
      }
    }
    await store.saveQueuedActions(queuedActions);
    notifyListeners();
    await flushQueue();
  }

  Future<void> flushQueue() async {
    if (!isSignedIn) return;
    if (queuedCounts.isEmpty && queuedActions.isEmpty) return;
    final remainingCounts = <QueuedCount>[];
    var sent = 0;
    for (final item in queuedCounts) {
      // A conflict/rejected item waits for the user's explicit retry
      // (retryQueuedCount) - never resubmitted silently.
      if (item.status != 'pending') {
        remainingCounts.add(item);
        continue;
      }
      try {
        await api.submitCount(
          itemId: item.itemId,
          locationId: item.locationId,
          physicalQuantity: item.physicalQuantity,
          lotNo: item.lotNo,
          mode: item.mode,
        );
        sent += 1;
      } on ApiException catch (err) {
        item.attempts += 1;
        item.lastError = err.message;
        final outcome = classifySyncFailure(isOffline: err.isOffline, statusCode: err.statusCode);
        if (outcome == SyncOutcome.retry) {
          remainingCounts.add(item);
          remainingCounts.addAll(queuedCounts.skip(queuedCounts.indexOf(item) + 1));
          break;
        }
        item.status = outcome == SyncOutcome.conflict ? 'conflict' : 'rejected';
        remainingCounts.add(item);
      }
    }
    queuedCounts = remainingCounts;
    await store.saveQueuedCounts(queuedCounts, companyId);

    final remainingActions = <QueuedAction>[];
    for (final item in queuedActions) {
      if (item.status != 'pending') {
        remainingActions.add(item);
        continue;
      }
      try {
        await api.sendRaw(item.method, item.path, body: item.body);
        sent += 1;
      } on ApiException catch (err) {
        item.attempts += 1;
        item.lastError = err.message;
        final outcome = classifySyncFailure(isOffline: err.isOffline, statusCode: err.statusCode);
        if (outcome == SyncOutcome.retry) {
          remainingActions.add(item);
          remainingActions.addAll(queuedActions.skip(queuedActions.indexOf(item) + 1));
          break;
        }
        item.status = outcome == SyncOutcome.conflict ? 'conflict' : 'rejected';
        remainingActions.add(item);
      }
    }
    queuedActions = remainingActions;
    await store.saveQueuedActions(queuedActions);
    if (sent > 0) {
      notice = sent == 1 ? 'Synced 1 queued action.' : 'Synced $sent queued actions.';
      counts = await api.counts();
      dashboard = await api.dashboard();
    }
    notifyListeners();
  }
}
