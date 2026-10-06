// Plan P0-SYNC-001/003, P1-SYNC-004, P1-AUTH-001: queued offline work is bound to the
// company + user + device that queued it, replays exactly once under a stable
// X-Mutation-Id, backs off on transient failures, and concurrent 401s share one refresh.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/drift_store.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/native_database.dart';
import 'package:invexaretail_mobile/services/sync_resolution.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

http.Response _json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json', ...headers});

const alice = AuthUser(id: 'alice', name: 'Alice', email: 'alice@x.local', role: 'STORE_USER', companyId: 'co-a');
const bob = AuthUser(id: 'bob', name: 'Bob', email: 'bob@x.local', role: 'STORE_USER', companyId: 'co-a');
const carol = AuthUser(id: 'carol', name: 'Carol', email: 'carol@x.local', role: 'STORE_USER', companyId: 'co-b');

QueuedAction _action(String id, {String user = 'alice', String company = 'co-a', String? mutationId, String path = '/api/v1/putaway-tasks/t1/confirm'}) => QueuedAction(
      localId: id,
      mutationId: mutationId,
      companyId: company,
      userId: user,
      deviceId: 'dev-1',
      type: 'PUTAWAY',
      method: 'POST',
      path: path,
      body: const {'scannedBinCode': 'BIN-1'},
      createdAt: '2026-10-07T00:00:00Z',
    );

SessionController _controller(LocalStore store, Future<http.Response> Function(http.Request) handler, AuthUser user) {
  final controller = SessionController(api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient(handler)), store: store)
    ..restoring = false
    ..user = user;
  controller.api.token = 'jwt';
  return controller;
}

void main() {
  group('stores bind queued work to the user who queued it (P0-SYNC-001)', () {
    for (final entry in <String, LocalStore Function()>{'MemoryStore': MemoryStore.new, 'DriftStore': DriftStore.inMemory}.entries) {
      test('${entry.key}: another user on the same phone never sees or loses my queue', () async {
        final store = entry.value();
        await store.saveQueuedActions([_action('a-1')], 'co-a', 'alice');
        await store.saveQueuedActions([_action('b-1', user: 'bob')], 'co-a', 'bob');
        await store.saveQueuedActions([_action('c-1', user: 'carol', company: 'co-b')], 'co-b', 'carol');

        expect((await store.loadQueuedActions('co-a', 'alice')).map((a) => a.localId), ['a-1']);
        expect((await store.loadQueuedActions('co-a', 'bob')).map((a) => a.localId), ['b-1']);
        expect((await store.loadQueuedActions('co-b', 'carol')).map((a) => a.localId), ['c-1']);
        expect(await store.loadQueuedActions('co-b', 'alice'), isEmpty, reason: 'same user id under another company is not the same identity');

        // saving one user's queue never clobbers another's
        await store.saveQueuedActions([], 'co-a', 'alice');
        expect(await store.loadQueuedActions('co-a', 'alice'), isEmpty);
        expect((await store.loadQueuedActions('co-a', 'bob')).map((a) => a.localId), ['b-1']);
      });

      test('${entry.key}: queued counts are user-scoped too', () async {
        final store = entry.value();
        QueuedCount count(String id, String user) => QueuedCount(localId: id, userId: user, itemId: 'i', locationId: 'l', physicalQuantity: 1, createdAt: 'x');
        await store.saveQueuedCounts([count('c-a', 'alice')], 'co-a', 'alice');
        await store.saveQueuedCounts([count('c-b', 'bob')], 'co-a', 'bob');
        expect((await store.loadQueuedCounts('co-a', 'alice')).single.localId, 'c-a');
        expect((await store.loadQueuedCounts('co-a', 'bob')).single.localId, 'c-b');
      });
    }

    test('DriftStore: pre-binding rows are hidden from everyone until the restored session adopts them, once', () async {
      final db = NativeDatabase.memory();
      final store = DriftStore.native(db);
      // what an older app version left behind: no identity on the row
      final legacy = QueuedAction(localId: 'old-1', type: 'PICK', method: 'POST', path: '/api/v1/x', body: const {}, createdAt: 'x');
      db.replaceActions([jsonEncode(legacy.toJson())]);
      expect(await store.loadQueuedActions('co-a', 'alice'), isEmpty);
      expect(await store.loadQueuedActions('co-a', 'bob'), isEmpty, reason: 'a later login must not inherit them');

      await store.adoptLegacyQueues('co-a', 'alice');
      final adopted = (await store.loadQueuedActions('co-a', 'alice')).single;
      expect(adopted.localId, 'old-1');
      expect(adopted.userId, 'alice');
      expect(adopted.companyId, 'co-a');
      expect(adopted.deviceId, isNotEmpty);
      expect(adopted.mutationId, 'old-1', reason: 'its stable id is kept');
      expect(await store.loadQueuedActions('co-a', 'bob'), isEmpty);
      await store.adoptLegacyQueues('co-a', 'bob');
      expect(await store.loadQueuedActions('co-a', 'bob'), isEmpty, reason: 'adoption is once; nothing legacy is left');
    });

    test('the device id is stable across calls and unique per installation', () async {
      final a = DriftStore.inMemory();
      final first = await a.deviceId();
      expect(await a.deviceId(), first);
      expect(await DriftStore.inMemory().deviceId(), isNot(first));
      expect(first, startsWith('dev-'));
    });
  });

  group('the controller only replays its own user\'s work', () {
    test('after Alice logs out and Bob signs in, Alice\'s queued action is neither visible nor sent', () async {
      final store = MemoryStore();
      await store.saveQueuedActions([_action('a-1')], 'co-a', 'alice');
      final sent = <http.Request>[];
      final bobController = _controller(store, (request) async {
        sent.add(request);
        return _json({'counts': [], 'dashboard': {}});
      }, bob);
      await bobController.loadQueuesForTest();
      expect(bobController.queuedActions, isEmpty);
      await bobController.flushQueue();
      expect(sent.where((request) => request.method == 'POST'), isEmpty, reason: 'nothing of Alice\'s may be sent with Bob\'s token');
      expect(await store.loadQueuedActions('co-a', 'alice'), hasLength(1), reason: 'and it is still Alice\'s, untouched');
    });

    test('logout empties the in-memory action queue as well as counts', () async {
      final store = MemoryStore();
      final controller = _controller(store, (_) async => _json({}), alice)..queuedActions = [_action('a-1')];
      await controller.logout(notify: false);
      expect(controller.queuedActions, isEmpty);
    });

    test('an action queued offline is stamped with the person, company, device and a mutation id', () async {
      final store = MemoryStore();
      final controller = _controller(store, (_) async => throw const SocketException('offline'), alice);
      await controller.runOrQueue(type: 'PUTAWAY', method: 'POST', path: '/api/v1/putaway-tasks/t1/confirm', body: {'scannedBinCode': 'B'});
      final queued = (await store.loadQueuedActions('co-a', 'alice')).single;
      expect(queued.userId, 'alice');
      expect(queued.companyId, 'co-a');
      expect(queued.deviceId, isNotEmpty);
      expect(queued.mutationId, isNotEmpty);
    });
  });

  group('exactly-once replay: one stable X-Mutation-Id across retries (P0-SYNC-003)', () {
    test('the queued action keeps its mutation id from the first try through every retry and a restart', () async {
      final store = MemoryStore();
      final seen = <String?>[];
      var online = false;
      http.Response handler(http.Request request) {
        if (request.method == 'POST') {
          seen.add(request.headers['X-Mutation-Id']);
          if (!online) throw const SocketException('offline');
          return _json({'ok': true}, 200);
        }
        return _json({'counts': [], 'dashboard': {}});
      }

      final first = _controller(store, (request) async => handler(request), alice);
      await first.runOrQueue(type: 'PUTAWAY', method: 'POST', path: '/api/v1/putaway-tasks/t1/confirm', body: {'scannedBinCode': 'B'});
      final original = seen.single;
      expect(original, isNotNull);

      // the app is killed and restarted: a new controller reads the queue from the store
      final second = _controller(store, (request) async => handler(request), alice);
      await second.loadQueuesForTest();
      await second.flushQueue();
      expect(seen.length, 2);
      expect(seen.last, original, reason: 'the retry after a restart reuses the SAME idempotency key');
      online = true;
      await second.flushQueue(now: DateTime.now().add(const Duration(hours: 1)));
      expect(seen.last, original);
      expect(second.queuedActions, isEmpty, reason: 'removed only after confirmed success');
    });

    test('a pick or receive uses its own requestId as the mutation id', () async {
      String? header;
      final controller = _controller(MemoryStore(), (request) async {
        if (request.method == 'POST') header = request.headers['X-Mutation-Id'];
        return _json({'counts': [], 'dashboard': {}});
      }, alice);
      await controller.runOrQueue(type: 'TRANSFER_RECEIVE', method: 'POST', path: '/api/v1/transfers/t1/receive', body: {'requestId': 'req-abc-123'});
      expect(header, 'req-abc-123');
    });

    test('counts send their requestId as the mutation id too', () async {
      String? header;
      final api = InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async {
        header = request.headers['X-Mutation-Id'];
        return _json({'count': {'id': 'c1', 'itemId': 'i', 'lotId': 'l', 'locationId': 'loc', 'physicalQuantity': 1}}, 201);
      }))..token = 'jwt';
      await api.submitCount(itemId: 'i', locationId: 'loc', physicalQuantity: 1, requestId: 'req-count-1');
      expect(header, 'req-count-1');
    });
  });

  group('retry classifier and backoff (P1-SYNC-004)', () {
    test('transient statuses retry, real conflicts and invalid requests do not', () {
      for (final status in [408, 425, 429, 500, 502, 503, 504]) {
        expect(classifySyncFailure(isOffline: false, statusCode: status), SyncOutcome.retry, reason: '$status');
      }
      expect(classifySyncFailure(isOffline: true), SyncOutcome.retry);
      expect(classifySyncFailure(isOffline: false, statusCode: 401), SyncOutcome.retry);
      expect(classifySyncFailure(isOffline: false, statusCode: 409), SyncOutcome.conflict);
      for (final status in [400, 403, 404, 422]) {
        expect(classifySyncFailure(isOffline: false, statusCode: status), SyncOutcome.rejected, reason: '$status');
      }
    });

    test('a server error that never recovers eventually stops retrying; being offline never does', () {
      expect(classifySyncFailure(isOffline: false, statusCode: 500, attempts: maxTransientServerAttempts - 1), SyncOutcome.retry);
      expect(classifySyncFailure(isOffline: false, statusCode: 500, attempts: maxTransientServerAttempts), SyncOutcome.rejected);
      expect(classifySyncFailure(isOffline: true, attempts: 500), SyncOutcome.retry);
    });

    test('backoff doubles, is capped, jitters within 20 percent, and Retry-After wins when longer', () {
      final noJitter = _FixedRandom(0.5); // 0.8 + 0.4 * 0.5 = 1.0
      expect(retryDelay(attempts: 1, random: noJitter).inSeconds, 5);
      expect(retryDelay(attempts: 2, random: noJitter).inSeconds, 10);
      expect(retryDelay(attempts: 3, random: noJitter).inSeconds, 20);
      expect(retryDelay(attempts: 30, random: noJitter).inSeconds, 15 * 60, reason: 'capped at 15 minutes');
      final low = retryDelay(attempts: 3, random: _FixedRandom(0)).inSeconds;
      final high = retryDelay(attempts: 3, random: _FixedRandom(1)).inSeconds;
      expect(low, 16);
      expect(high, 24);
      expect(retryDelay(attempts: 1, retryAfterSeconds: 90, random: noJitter).inSeconds, 90);
      expect(retryDelay(attempts: 10, retryAfterSeconds: 1, random: noJitter).inSeconds, greaterThan(1), reason: 'a short Retry-After never shortens the backoff');
      expect(retryDelay(attempts: 1, retryAfterSeconds: 999999, random: noJitter).inSeconds, 3600, reason: 'but cannot park work for days');
    });

    test('a 503 backs the item off; it is not retried before it is due, and the order of work is kept', () async {
      final store = MemoryStore();
      var calls = 0;
      final controller = _controller(store, (request) async {
        if (request.method == 'POST') {
          calls += 1;
          return _json({'message': 'busy'}, 503, {'retry-after': '120'});
        }
        return _json({'counts': [], 'dashboard': {}});
      }, alice)
        ..queuedActions = [_action('a-1'), _action('a-2')];
      final t0 = DateTime.utc(2026, 10, 7, 12);
      await controller.flushQueue(now: t0, random: _FixedRandom(0.5));
      expect(calls, 1, reason: 'the second action waits behind the first so the order is preserved');
      expect(controller.queuedActions.first.status, 'pending');
      expect(controller.queuedActions.first.attempts, 1);
      final due = DateTime.parse(controller.queuedActions.first.nextAttemptAt!);
      expect(due.difference(t0).inSeconds, greaterThanOrEqualTo(120), reason: 'Retry-After honoured');

      await controller.flushQueue(now: t0.add(const Duration(seconds: 30)), random: _FixedRandom(0.5));
      expect(calls, 1, reason: 'not due yet');
      await controller.flushQueue(now: due.add(const Duration(seconds: 1)), random: _FixedRandom(0.5));
      expect(calls, 2, reason: 'due, so it tries again');
    });

    test('a 422 is terminal at once and a 409 goes to the conflict center; neither is retried automatically', () async {
      for (final status in [422, 409]) {
        var calls = 0;
        final controller = _controller(MemoryStore(), (request) async {
          if (request.method == 'POST') {
            calls += 1;
            return _json({'message': 'no'}, status);
          }
          return _json({'counts': [], 'dashboard': {}});
        }, alice)
          ..queuedActions = [_action('a-1')];
        await controller.flushQueue();
        expect(controller.queuedActions.single.status, status == 409 ? 'conflict' : 'rejected');
        await controller.flushQueue();
        await controller.flushQueue();
        expect(calls, 1, reason: 'status $status');
      }
    });

    test('a manual retry from the conflict center ignores the backoff', () async {
      final controller = _controller(MemoryStore(), (request) async => _json({'counts': [], 'dashboard': {}}), alice);
      final item = _action('a-1')..nextAttemptAt = DateTime.now().add(const Duration(hours: 5)).toIso8601String();
      controller.queuedActions = [item];
      await controller.retryQueuedAction('a-1');
      expect(controller.queuedActions, isEmpty, reason: 'sent immediately although its backoff had hours left');
    });
  });

  group('single-flight token refresh (P1-AUTH-001)', () {
    test('five simultaneous 401s cause exactly one refresh call, and all five requests succeed', () async {
      var refreshCalls = 0;
      final gate = Completer<void>();
      final api = InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async {
        if (request.url.path == '/api/v1/auth/refresh-token') {
          refreshCalls += 1;
          await gate.future; // hold the refresh open so the other 401s arrive while it is running
          return _json({'token': 'fresh-token', 'refreshToken': 'fresh-refresh'});
        }
        if (request.headers['Authorization'] == 'Bearer fresh-token') return _json({'locations': []});
        return _json({'message': 'expired'}, 401);
      }))
        ..token = 'stale-token'
        ..refreshToken = 'refresh-1';
      final calls = List.generate(5, (_) => api.locations());
      await Future<void>.delayed(const Duration(milliseconds: 50));
      gate.complete();
      final results = await Future.wait(calls);
      expect(results, hasLength(5));
      expect(refreshCalls, 1, reason: 'one refresh per burst of expiries');
      expect(api.token, 'fresh-token');
      expect(api.refreshToken, 'fresh-refresh');
    });

    test('if the refresh fails, every waiting request fails cleanly with 401 and the next burst may try again', () async {
      var refreshCalls = 0;
      final api = InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async {
        if (request.url.path == '/api/v1/auth/refresh-token') {
          refreshCalls += 1;
          return _json({'message': 'revoked'}, 401);
        }
        return _json({'message': 'expired'}, 401);
      }))
        ..token = 'stale'
        ..refreshToken = 'r';
      final outcomes = await Future.wait(List.generate(3, (_) => api.locations().then<Object?>((_) => 'ok', onError: (Object e) => (e as ApiException).statusCode)));
      expect(outcomes, [401, 401, 401]);
      expect(refreshCalls, 1);
      await api.locations().then((_) {}, onError: (_) {});
      expect(refreshCalls, 2, reason: 'the in-flight slot is released, so a later burst refreshes again');
    });
  });
}

class _FixedRandom implements Random {
  _FixedRandom(this.value);
  final double value;
  @override
  double nextDouble() => value;
  @override
  bool nextBool() => false;
  @override
  int nextInt(int max) => 0;
}
