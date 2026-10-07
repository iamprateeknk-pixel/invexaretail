import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/models.dart';

/// The server accepted the first factor but wants an authenticator or backup
/// code before it will issue a session. Not an error to show the user.
class TwoFactorRequiredException implements Exception {
  TwoFactorRequiredException(this.challengeToken);

  final String challengeToken;
}

class InvexaApi {
  InvexaApi({
    String? baseUrl,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 25),
    this.onTokensUpdated,
  })  : baseUrl = stripTrailingSlash(baseUrl ?? apiBaseFromEnvironment()),
        httpClient = httpClient ?? http.Client();

  final String baseUrl;
  final http.Client httpClient;
  final Duration timeout;
  Future<void> Function(String token, String? refreshToken)? onTokensUpdated;

  /// Offline read model (see local_store.dart). When set together with [cacheScope], successful reads
  /// of the whitelisted screen feeds are remembered and, when the network is unreachable, the last
  /// good answer is served instead of an error. [servedFromCacheAt] says when the data being shown is from.
  Future<void> Function(String scope, String path, String body)? cachePut;
  Future<({String body, DateTime fetchedAt})?> Function(String scope, String path)? cacheGet;
  String? cacheScope;
  DateTime? servedFromCacheAt;

  static const _cacheablePrefixes = [
    '/api/v1/locations', '/api/v1/items', '/api/v1/dashboard', '/api/v1/counts', '/api/v1/transfers',
    '/api/v1/stock/', '/api/v1/mobile/work', '/api/v1/count-assignments', '/api/v1/putaway-tasks', '/api/v1/orders',
  ];

  static bool isCacheable(String method, String path) {
    if (method != 'GET') return false;
    final clean = path.split('?').first;
    return _cacheablePrefixes.any((prefix) => clean == prefix || clean.startsWith(prefix.endsWith('/') ? prefix : '$prefix/') || clean.startsWith(prefix));
  }

  String? token;
  String? refreshToken;
  // Plan P1-AUTH-001: every request that hits a 401 at the same time awaits this ONE refresh,
  // instead of the second one seeing a boolean lock and giving up.
  Future<bool>? _refreshInFlight;

  Map<String, String> _headers({bool auth = true, Map<String, String>? extra}) {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (auth && token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      ...?extra,
    };
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
    int attempt = 0,
    String? mutationId,
  }) async {
    try {
      final uri = _uri(path);
      // X-Mutation-Id (plan P0-SYNC-003): created once when the person acts and reused on every
      // retry, so the server can never apply the same mutation twice.
      final headers = _headers(auth: auth, extra: mutationId == null || mutationId.isEmpty ? null : {'X-Mutation-Id': mutationId});
      final encoded = body == null ? null : jsonEncode(body);
      late http.Response response;
      switch (method) {
        case 'GET':
          response = await httpClient.get(uri, headers: headers).timeout(timeout);
        case 'POST':
          response = await httpClient.post(uri, headers: headers, body: encoded).timeout(timeout);
        case 'PATCH':
          response = await httpClient.patch(uri, headers: headers, body: encoded).timeout(timeout);
        default:
          throw ApiException('Unsupported method $method');
      }

      Map<String, dynamic> payload = {};
      if (response.body.isNotEmpty) {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) {
          payload = decoded;
        } else if (decoded is Map) {
          payload = Map<String, dynamic>.from(decoded);
        }
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final scope = cacheScope;
        if (scope != null && cachePut != null && isCacheable(method, path)) {
          servedFromCacheAt = null;
          await cachePut!(scope, path, response.body);
        }
        return payload;
      }

      if (response.statusCode == 401 && auth && attempt == 0) {
        final refreshed = await refreshAccessToken();
        if (refreshed) {
          return await _send(method, path, body: body, auth: true, attempt: 1, mutationId: mutationId);
        }
      }

      final message = asString(
        payload['message'] ?? payload['error'],
        'Request failed with ${response.statusCode}',
      );
      throw ApiException(
        message,
        statusCode: response.statusCode,
        retryAfterSeconds: int.tryParse(response.headers['retry-after'] ?? ''),
      );
    } on ApiException {
      rethrow;
    } on TimeoutException {
      return await _offlineFallback(method, path);
    } on SocketException {
      return await _offlineFallback(method, path);
    } on http.ClientException {
      return await _offlineFallback(method, path);
    }
  }

  /// Unreachable network: serve the last good copy of a cacheable read, otherwise fail as before.
  Future<Map<String, dynamic>> _offlineFallback(String method, String path) async {
    final scope = cacheScope;
    if (scope != null && cacheGet != null && isCacheable(method, path)) {
      final cached = await cacheGet!(scope, path);
      if (cached != null) {
        final decoded = jsonDecode(cached.body);
        if (decoded is Map) {
          servedFromCacheAt = cached.fetchedAt;
          return Map<String, dynamic>.from(decoded);
        }
      }
    }
    throw ApiException('Cannot reach the Invexa API. Check the service and retry.');
  }

  Future<LoginResult> login(String email, String password) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/login',
      body: {'email': email.trim().toLowerCase(), 'password': password},
      auth: false,
    );
    _throwIfTwoFactor(payload);
    final result = LoginResult.fromJson(payload);
    token = result.token;
    refreshToken = result.refreshToken;
    return result;
  }

  Future<SendOtpResult> sendOtp(String email) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/send-otp',
      body: {'email': email.trim().toLowerCase()},
      auth: false,
    );
    return SendOtpResult.fromJson(payload);
  }

  /// A one-time code (valid about a minute) that lets the web workspace open already signed in as this
  /// user, so a capability shown inside the app never asks for a second login. The access token itself
  /// is never put in a URL.
  Future<String> webHandoffCode() async {
    final payload = await _send('POST', '/api/v1/auth/web-handoff', body: const <String, Object?>{});
    final code = asString(payload['code']);
    if (code.isEmpty) throw ApiException('The server did not return a handoff code.');
    return code;
  }

  Future<LoginResult> loginWithOtp(String email, String otpCode) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/verify-otp',
      body: {'email': email.trim().toLowerCase(), 'otpCode': otpCode.trim()},
      auth: false,
    );
    _throwIfTwoFactor(payload);
    final result = LoginResult.fromJson(payload);
    token = result.token;
    refreshToken = result.refreshToken;
    return result;
  }

  void _throwIfTwoFactor(Map<String, dynamic> payload) {
    if (payload['twoFactorRequired'] == true) {
      throw TwoFactorRequiredException(asString(payload['challengeToken']));
    }
  }

  /// Second step of sign-in for accounts with two-factor on.
  Future<LoginResult> verifyTwoFactor(String challengeToken, String code) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/2fa/verify-login',
      body: {'challengeToken': challengeToken, 'code': code.replaceAll(RegExp(r'\s+'), '').toUpperCase()},
      auth: false,
    );
    final result = LoginResult.fromJson(payload);
    token = result.token;
    refreshToken = result.refreshToken;
    return result;
  }

  /// Refreshes the access token. Concurrent callers share one network call and one result.
  Future<bool> refreshAccessToken() {
    final running = _refreshInFlight;
    if (running != null) return running;
    final next = _refreshOnce().whenComplete(() => _refreshInFlight = null);
    _refreshInFlight = next;
    return next;
  }

  Future<bool> _refreshOnce() async {
    final currentRefresh = refreshToken;
    if (currentRefresh == null || currentRefresh.isEmpty) return false;
    try {
      final payload = await _send(
        'POST',
        '/api/v1/auth/refresh-token',
        body: {'refreshToken': currentRefresh},
        auth: false,
      );
      final nextToken = asString(payload['token']);
      if (nextToken.isEmpty) return false;
      token = nextToken;
      final nextRefresh = payload['refreshToken'] == null ? currentRefresh : asString(payload['refreshToken']);
      refreshToken = nextRefresh.isEmpty ? currentRefresh : nextRefresh;
      await onTokensUpdated?.call(token!, refreshToken);
      return true;
    } on ApiException {
      return false;
    }
  }

  Future<void> logout() async {
    final currentRefresh = refreshToken;
    if (currentRefresh != null && currentRefresh.isNotEmpty) {
      try {
        await _send(
          'POST',
          '/api/v1/auth/logout',
          body: {'refreshToken': currentRefresh},
          auth: false,
        );
      } on ApiException {
        // Local sign-out still proceeds.
      }
    }
    clearToken();
  }

  Future<DashboardSummary> dashboard() async {
    return DashboardSummary.fromJson(await _send('GET', '/api/v1/dashboard'));
  }

  Future<List<LocationRecord>> locations() async {
    final payload = await _send('GET', '/api/v1/locations');
    return asList(payload['locations']).map((row) => LocationRecord.fromJson(asMap(row))).toList();
  }

  Future<List<CatalogItem>> items() async {
    final payload = await _send('GET', '/api/v1/items');
    return asList(payload['items']).map((row) => CatalogItem.fromJson(asMap(row))).toList();
  }

  Future<List<StockRow>> stock(String locationId) async {
    final payload = await _send('GET', '/api/v1/stock/$locationId');
    return asList(payload['items']).map((row) => StockRow.fromJson(asMap(row))).toList();
  }

  Future<List<CountRecord>> counts() async {
    final payload = await _send('GET', '/api/v1/counts');
    return asList(payload['counts']).map((row) => CountRecord.fromJson(asMap(row))).toList();
  }

  Future<CountRecord> submitCount({
    required String itemId,
    required String locationId,
    required double physicalQuantity,
    String? lotNo,
    String mode = 'manual',
    String? requestId,
  }) async {
    final payload = await _send('POST', '/api/v1/stock-counts', body: {
      'itemId': itemId,
      'locationId': locationId,
      'physicalQuantity': physicalQuantity,
      'mode': mode,
      if (lotNo != null && lotNo.isNotEmpty) 'lotNo': lotNo,
      if (requestId != null && requestId.isNotEmpty) 'requestId': requestId,
    }, mutationId: requestId);
    return CountRecord.fromJson(asMap(payload['count']));
  }

  /// Loose-weight count: one decimal total for the item. The server splits it
  /// over the lots (FIFO/FEFO); a store user's response carries no split.
  Future<List<CountRecord>> submitWeightCount({
    required String itemId,
    required String locationId,
    required double totalQuantity,
    String? requestId,
  }) async {
    final payload = await _send('POST', '/api/v1/stock-counts/weight', body: {
      'itemId': itemId,
      'locationId': locationId,
      'totalQuantity': totalQuantity,
      if (requestId != null && requestId.isNotEmpty) 'requestId': requestId,
    }, mutationId: requestId);
    return asList(payload['counts']).map((row) => CountRecord.fromJson(asMap(row))).toList();
  }

  /// The task-first work feed. Older servers don't have it: callers fall back.
  Future<List<CountTask>> countTasks() async {
    final payload = await _send('GET', '/api/v1/mobile/work');
    return asList(payload['countTasks']).map((row) => CountTask.fromJson(asMap(row))).toList();
  }

  /// Carton label / QR -> its transfer (blueprint v4 §18).
  Future<TransferRecord?> transferByPackage(String packageId) async {
    try {
      final payload = await _send('GET', '/api/v1/transfers/by-package/${Uri.encodeComponent(packageId.trim())}');
      return TransferRecord.fromJson(asMap(payload['transfer']));
    } on ApiException catch (err) {
      if (err.statusCode == 404) return null;
      rethrow;
    }
  }

  /// Starts a transfer (POST /api/v1/transfers). The server reserves the stock
  /// atomically and may refuse (insufficient stock, expiry block, role).
  Future<TransferRecord> createTransfer(Map<String, Object> body) async {
    final payload = await _send('POST', '/api/v1/transfers', body: body);
    return TransferRecord.fromJson(asMap(payload['transfer']));
  }

  Future<List<TransferRecord>> transfers() async {
    final payload = await _send('GET', '/api/v1/transfers/list');
    return asList(payload['transfers']).map((row) => TransferRecord.fromJson(asMap(row))).toList();
  }

  Future<List<CountAssignment>> myAssignments() async {
    final payload = await _send('GET', '/api/v1/count-assignments/mine');
    return asList(payload['assignments']).map((row) => CountAssignment.fromJson(asMap(row))).toList();
  }

  Future<Map<String, dynamic>> sendRaw(String method, String path, {Object? body, String? mutationId}) {
    return _send(method, path, body: body, mutationId: mutationId);
  }

  Future<Map<String, dynamic>> mobileHome() async {
    return _send('GET', '/api/v1/mobile/home');
  }

  /// The server's view of a pick: what is left, per line. Reopening a task starts from this.
  Future<Map<String, dynamic>> pickerTransfer(String transferId) => _send('GET', '/api/v1/picker/transfers/$transferId');

  /// Which lots a KG pick would take (FIFO/FEFO, chosen by the server).
  Future<List<Map<String, dynamic>>> allocationPreview(String transferId, String itemId, double quantity) async {
    final payload = await _send('POST', '/api/v1/picker/transfers/$transferId/allocation-preview', body: {'itemId': itemId, 'quantity': quantity});
    return asList(payload['allocations']).map(asMap).toList();
  }

  Future<List<Map<String, dynamic>>> putawayTasks(String locationId) async {
    final payload = await _send('GET', '/api/v1/putaway-tasks?locationId=$locationId');
    return asList(payload['tasks']).map(asMap).toList();
  }

  Future<void> confirmPutaway({
    required String taskId,
    required String scannedBinCode,
    String? binId,
  }) async {
    await _send('POST', '/api/v1/putaway-tasks/$taskId/confirm', body: {
      'scannedBinCode': scannedBinCode,
      if (binId != null) 'binId': binId,
      'requireScan': true,
    });
  }

  Future<void> receiveTransfer({
    required String transferId,
    required String requestId,
    required List<Map<String, dynamic>> lines,
  }) async {
    await _send('POST', '/api/v1/transfers/$transferId/receive', body: {
      'requestId': requestId,
      'lines': lines,
    });
  }

  Future<List<Map<String, dynamic>>> transferEvidence(String transferId) async {
    final payload = await _send('GET', '/api/v1/transfers/$transferId/evidence');
    return asList(payload['evidence']).map(asMap).toList();
  }

  Future<Uint8List> transferEvidencePhoto(String transferId, String evidenceId) async {
    final uri = _uri('/api/v1/transfers/$transferId/evidence/$evidenceId');
    final response = await httpClient.get(uri, headers: _headers(auth: true)..remove('Content-Type')).timeout(timeout);
    if (response.statusCode != 200) {
      throw ApiException('Photo was not found.', statusCode: response.statusCode);
    }
    return response.bodyBytes;
  }

  Future<void> savePickSlip({
    required String transferId,
    required List<Map<String, dynamic>> lines,
    List<Map<String, dynamic>> exceptions = const [],
  }) async {
    await _send('POST', '/api/v1/picker/transfers/$transferId/pick-slips', body: {
      'lines': lines,
      'exceptions': exceptions,
    });
  }

  Future<Map<String, dynamic>> scanPickWave({
    required String waveId,
    required String scannedBinCode,
    int scannedIndex = 0,
  }) async {
    return _send('POST', '/api/v1/pick-waves/$waveId/scan', body: {
      'scannedBinCode': scannedBinCode,
      'scannedIndex': scannedIndex,
    });
  }

  Future<void> createException({
    required String type,
    required String title,
    String? locationId,
    String? itemId,
  }) async {
    await _send('POST', '/api/v1/exceptions', body: {
      'type': type,
      'title': title,
      if (locationId != null) 'locationId': locationId,
      if (itemId != null) 'itemId': itemId,
    });
  }

  void clearToken() {
    token = null;
    refreshToken = null;
  }
}
