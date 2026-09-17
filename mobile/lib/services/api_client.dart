import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/models.dart';

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
  String? token;
  String? refreshToken;
  bool _refreshing = false;

  Map<String, String> _headers({bool auth = true}) {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (auth && token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
    int attempt = 0,
  }) async {
    try {
      final uri = _uri(path);
      final headers = _headers(auth: auth);
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
        return payload;
      }

      if (response.statusCode == 401 && auth && !_refreshing && attempt == 0) {
        final refreshed = await refreshAccessToken();
        if (refreshed) {
          return await _send(method, path, body: body, auth: true, attempt: 1);
        }
      }

      final message = asString(
        payload['message'] ?? payload['error'],
        'Request failed with ${response.statusCode}',
      );
      throw ApiException(message, statusCode: response.statusCode);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException('Cannot reach the Invexa API. Check the service and retry.');
    } on SocketException {
      throw ApiException('Cannot reach the Invexa API. Check the service and retry.');
    } on http.ClientException {
      throw ApiException('Cannot reach the Invexa API. Check the service and retry.');
    }
  }

  Future<LoginResult> login(String email, String password) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/login',
      body: {'email': email.trim().toLowerCase(), 'password': password},
      auth: false,
    );
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

  Future<LoginResult> loginWithOtp(String email, String otpCode) async {
    final payload = await _send(
      'POST',
      '/api/v1/auth/verify-otp',
      body: {'email': email.trim().toLowerCase(), 'otpCode': otpCode.trim()},
      auth: false,
    );
    final result = LoginResult.fromJson(payload);
    token = result.token;
    refreshToken = result.refreshToken;
    return result;
  }

  Future<bool> refreshAccessToken() async {
    final currentRefresh = refreshToken;
    if (currentRefresh == null || currentRefresh.isEmpty || _refreshing) return false;
    _refreshing = true;
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
    } finally {
      _refreshing = false;
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
    required int physicalQuantity,
    String? lotNo,
    String mode = 'manual',
  }) async {
    final payload = await _send('POST', '/api/v1/stock-counts', body: {
      'itemId': itemId,
      'locationId': locationId,
      'physicalQuantity': physicalQuantity,
      'mode': mode,
      if (lotNo != null && lotNo.isNotEmpty) 'lotNo': lotNo,
    });
    return CountRecord.fromJson(asMap(payload['count']));
  }

  Future<List<TransferRecord>> transfers() async {
    final payload = await _send('GET', '/api/v1/transfers/list');
    return asList(payload['transfers']).map((row) => TransferRecord.fromJson(asMap(row))).toList();
  }

  Future<List<CountAssignment>> myAssignments() async {
    final payload = await _send('GET', '/api/v1/count-assignments/mine');
    return asList(payload['assignments']).map((row) => CountAssignment.fromJson(asMap(row))).toList();
  }

  Future<Map<String, dynamic>> sendRaw(String method, String path, {Object? body}) {
    return _send(method, path, body: body);
  }

  Future<Map<String, dynamic>> mobileHome() async {
    return _send('GET', '/api/v1/mobile/home');
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
