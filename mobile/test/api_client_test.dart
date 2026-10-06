import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

void main() {
  test('login posts /api/v1/auth/login and stores the bearer token', () async {
    late http.Request captured;
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'success': true,
            'token': 'jwt-token',
            'refreshToken': 'refresh',
            'user': {
              'id': 'user-admin-1',
              'name': 'Admin User',
              'email': 'admin@retail.local',
              'role': 'ADMIN',
              'branchIds': ['loc-1'],
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final result = await api.login('Admin@retail.local', 'ChangeMe123!');
    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/auth/login');
    expect(jsonDecode(captured.body)['email'], 'admin@retail.local');
    expect(result.token, 'jwt-token');
    expect(api.token, 'jwt-token');
  });

  test('sendOtp posts /api/v1/auth/send-otp and loginWithOtp verifies the code', () async {
    final paths = <String>[];
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async {
        paths.add('${request.method} ${request.url.path}');
        if (request.url.path.endsWith('/send-otp')) {
          expect(jsonDecode(request.body)['email'], 'admin@retail.local');
          return _json({
            'success': true,
            'message': 'OTP sent to your email',
            'delivery': 'development',
            'expiresIn': 600,
            'otpCode': '123456',
          });
        }
        if (request.url.path.endsWith('/verify-otp')) {
          expect(jsonDecode(request.body), {
            'email': 'admin@retail.local',
            'otpCode': '123456',
          });
          return _json({
            'success': true,
            'token': 'otp-jwt',
            'refreshToken': 'otp-refresh',
            'user': {
              'id': 'user-admin-1',
              'name': 'Admin User',
              'email': 'admin@retail.local',
              'role': 'ADMIN',
              'branchIds': ['loc-1'],
            },
          });
        }
        return http.Response('missing', 404);
      }),
    );

    final sent = await api.sendOtp('Admin@retail.local');
    expect(sent.otpCode, '123456');
    expect(sent.delivery, 'development');

    final result = await api.loginWithOtp('Admin@retail.local', '123456');
    expect(result.token, 'otp-jwt');
    expect(api.token, 'otp-jwt');
    expect(api.refreshToken, 'otp-refresh');
    expect(paths, [
      'POST /api/v1/auth/send-otp',
      'POST /api/v1/auth/verify-otp',
    ]);
  });

  test('login surfaces {error} from 401 without treating it as a token', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async {
        return http.Response(jsonEncode({'error': 'Invalid credentials'}), 401);
      }),
    );

    await expectLater(
      api.login('admin@retail.local', 'wrong'),
      throwsA(isA<ApiException>().having((err) => err.message, 'message', 'Invalid credentials')),
    );
  });

  test('dashboard, stock, counts and transfers hit the live API paths', () async {
    final paths = <String>[];
    final api = InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async {
        paths.add('${request.method} ${request.url.path}');
        expect(request.headers['Authorization'], 'Bearer jwt');
        if (request.url.path.endsWith('/dashboard')) {
          return _json({
            'dashboard': {
              'pendingCounts': 2,
              'transferRequests': 1,
              'expiredTillDate': 1,
              'nearExpiryThisMonth': 0,
              'nearExpiryNextMonth': 0,
              'countCompletionPercent': 10,
              'transferSlaPercent': 0,
              'stockAccuracyPercent': 50,
            },
          });
        }
        if (request.url.path.contains('/stock/')) {
          return _json({
            'locationId': 'loc-1',
            'items': [
              {'itemId': 'item-1001', 'lotId': 'lot-1001', 'locationId': 'loc-1', 'bookQuantity': 28, 'physicalQuantity': 28},
            ],
          });
        }
        if (request.url.path.endsWith('/counts')) {
          return _json({
            'counts': [
              {'id': 'count-1', 'itemId': 'item-1001', 'lotId': 'lot-1001', 'locationId': 'loc-1', 'physicalQuantity': 28, 'status': 'APPROVED'},
            ],
          });
        }
        if (request.url.path.endsWith('/transfers/list')) {
          return _json({
            'transfers': [
              {
                'id': 'transfer-1',
                'sourceLocationId': 'loc-1',
                'destinationLocationId': 'wh-1',
                'status': 'REQUESTED',
                'cartonCount': 2,
                'lines': [
                  {'itemId': 'item-1001', 'lotId': 'lot-1001', 'quantity': 12},
                ],
              },
            ],
          });
        }
        return http.Response('missing', 404);
      }),
    )..token = 'jwt';

    final dashboard = await api.dashboard();
    final stock = await api.stock('loc-1');
    final counts = await api.counts();
    final transfers = await api.transfers();

    expect(paths, [
      'GET /api/v1/dashboard',
      'GET /api/v1/stock/loc-1',
      'GET /api/v1/counts',
      'GET /api/v1/transfers/list',
    ]);
    expect(dashboard.pendingCounts, 2);
    expect(stock.first.bookQuantity, 28);
    expect(counts.first.status, 'APPROVED');
    expect(transfers.first.cartonCount, 2);
  });

  test('expired access tokens refresh instead of signing the operator out', () async {
    final paths = <String>[];
    final api = InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async {
        paths.add('${request.method} ${request.url.path}');
        if (request.url.path.endsWith('/refresh-token')) {
          expect(jsonDecode(request.body)['refreshToken'], 'refresh');
          return _json({'success': true, 'token': 'new-jwt', 'refreshToken': 'new-refresh'});
        }
        if (request.url.path.endsWith('/dashboard')) {
          if (request.headers['Authorization'] == 'Bearer expired') {
            return http.Response(jsonEncode({'error': 'Authentication required'}), 401);
          }
          expect(request.headers['Authorization'], 'Bearer new-jwt');
          return _json({
            'dashboard': {
              'pendingCounts': 1,
              'transferRequests': 0,
              'expiredTillDate': 0,
              'nearExpiryThisMonth': 0,
              'nearExpiryNextMonth': 0,
              'countCompletionPercent': 0,
              'transferSlaPercent': 0,
              'stockAccuracyPercent': 0,
            },
          });
        }
        return http.Response('missing', 404);
      }),
    )
      ..token = 'expired'
      ..refreshToken = 'refresh';

    final dashboard = await api.dashboard();
    expect(api.token, 'new-jwt');
    expect(api.refreshToken, 'new-refresh');
    expect(dashboard.pendingCounts, 1);
    expect(paths, [
      'GET /api/v1/dashboard',
      'POST /api/v1/auth/refresh-token',
      'GET /api/v1/dashboard',
    ]);
  });

  test('unreachable API is treated as offline so counts can queue', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:9',
      httpClient: MockClient((request) async {
        throw const SocketException('Connection refused');
      }),
    );

    await expectLater(
      api.submitCount(itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 4),
      throwsA(isA<ApiException>().having((err) => err.isOffline, 'offline', isTrue)),
    );
  });

  test('session controller queues a count when the API is offline', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:9',
      httpClient: MockClient((request) async {
        throw const SocketException('Connection refused');
      }),
    )..token = 'jwt';
    final store = MemoryStore();
    final controller = SessionController(api: api, store: store)
      ..user = const AuthUser(
        id: 'user-admin-1',
        name: 'Admin',
        email: 'admin@retail.local',
        role: 'ADMIN',
      )
      ..restoring = false;

    final ok = await controller.submitCount(
      itemId: 'item-1004',
      locationId: 'loc-1',
      physicalQuantity: 4,
      lotNo: 'LOT-EXP',
    );

    expect(ok, isTrue);
    expect(controller.queuedCounts, hasLength(1));
    expect(controller.queuedCounts.first.itemId, 'item-1004');
    expect(controller.notice, contains('queued'));
    expect(await store.loadQueuedCounts('default-company', 'user-admin-1'), hasLength(1));
  });

  test('flushQueue replays queued counts and drops successes', () async {
    final posts = <Map<String, dynamic>>[];
    final api = InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async {
        if (request.method == 'POST' && request.url.path.endsWith('/stock-counts')) {
          posts.add(jsonDecode(request.body) as Map<String, dynamic>);
          return _json({
            'success': true,
            'count': {
              'id': 'count-new',
              'itemId': 'item-1004',
              'lotId': 'lot-1004',
              'locationId': 'loc-1',
              'physicalQuantity': 4,
            },
          }, status: 201);
        }
        if (request.url.path.endsWith('/counts')) {
          return _json({'counts': []});
        }
        if (request.url.path.endsWith('/dashboard')) {
          return _json({
            'dashboard': {
              'pendingCounts': 0,
              'transferRequests': 0,
              'expiredTillDate': 0,
              'nearExpiryThisMonth': 0,
              'nearExpiryNextMonth': 0,
              'countCompletionPercent': 0,
              'transferSlaPercent': 0,
              'stockAccuracyPercent': 0,
            },
          });
        }
        return http.Response('missing', 404);
      }),
    )..token = 'jwt';
    final store = MemoryStore();
    await store.saveQueuedCounts([
      QueuedCount(
        localId: 'local-1',
        userId: 'user-admin-1',
        itemId: 'item-1004',
        locationId: 'loc-1',
        physicalQuantity: 4,
        lotNo: 'LOT-EXP',
        createdAt: '2026-09-14T00:00:00.000Z',
      ),
    ], 'default-company', 'user-admin-1');
    final controller = SessionController(api: api, store: store)
      ..user = const AuthUser(id: 'user-admin-1', name: 'Admin', email: 'admin@retail.local', role: 'ADMIN')
      ..queuedCounts = await store.loadQueuedCounts('default-company', 'user-admin-1');

    await controller.flushQueue();

    expect(posts, hasLength(1));
    expect(posts.first['itemId'], 'item-1004');
    expect(posts.first['lotNo'], 'LOT-EXP');
    expect(controller.queuedCounts, isEmpty);
  });
}

http.Response _json(Object body, {int status = 200}) {
  return http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json'},
  );
}
