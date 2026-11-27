import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/conflict_center_screen.dart';
import 'package:invexaretail_mobile/screens/count_screen.dart';
import 'package:invexaretail_mobile/screens/putaway_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/drift_store.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

SessionController _controller(Future<http.Response> Function(http.Request request) handler, {LocalStore? store}) {
  final controller = SessionController(
    api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient(handler)),
    store: store ?? MemoryStore(),
  )
    ..restoring = false
    ..user = const AuthUser(id: 'u1', name: 'Store', email: 'store@retail.local', role: 'STORE_USER')
    ..selectedLocationId = 'loc-1';
  controller.api.token = 'jwt';
  return controller;
}

http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  test('warehouse replays retain each captured permit across restart and refresh', () async {
    final store = DriftStore.inMemory();
    addTearDown(store.close);
    const commands = [
      (type: 'PICK', path: '/api/v1/picker/transfers/p1/pick-slips', scope: 'picks', revision: 'pickRevision', wireType: 'PICK_CONFIRM', entityId: 'p1'),
      (type: 'TRANSFER_RECEIVE', path: '/api/v1/transfers/r1/receive', scope: 'receiving', revision: 'receiveRevision', wireType: 'RECEIVE_CONFIRM', entityId: 'r1'),
      (type: 'PUTAWAY', path: '/api/v1/putaway-tasks/b1/confirm', scope: 'putaway', revision: 'taskRevision', wireType: 'PUTAWAY_CONFIRM', entityId: 'b1'),
    ];
    final attempts = <String, List<({Map<String, dynamic> body, String? mutationId})>>{};
    final replays = <Map<String, dynamic>>[];
    var offline = true;
    var policyAvailable = true;
    var tokenVersion = 'original';
    Future<http.Response> handle(http.Request request) async {
      if (request.url.path.endsWith('/runtime/config')) {
        if (!policyAvailable) throw const SocketException('offline policy');
        return _json({'runtime': {'offlineCommandVersion': 2, 'offlineWarehousePermits': {
          for (final command in commands) command.scope: {
            'token': '$tokenVersion-${command.scope}',
            'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String(),
          },
        }}});
      }
      if (request.method != 'POST') return _json({});
      if (request.url.path == '/api/v1/sync/commands') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        replays.add(body);
        if (body['type'] == 'RECEIVE_CONFIRM') {
          return _json({'code': 'OFFLINE_WAREHOUSE_POLICY_REJECTED', 'error': 'Offline permission changed.'}, 403);
        }
        return _json({'success': true});
      }
      attempts.putIfAbsent(request.url.path, () => []).add((
        body: jsonDecode(request.body) as Map<String, dynamic>,
        mutationId: request.headers['x-mutation-id'],
      ));
      if (offline) throw const SocketException('warehouse offline');
      if (request.url.path.endsWith('/receive')) {
        return _json({'code': 'OFFLINE_WAREHOUSE_POLICY_REJECTED', 'error': 'Offline permission changed.'}, 403);
      }
      return _json({'success': true});
    }

    SessionController session() => _controller(handle, store: store)..api.cacheScope = 'default-company|u1|STORE_USER';
    await session().refreshAll();
    policyAvailable = false;
    final capturing = session();
    await capturing.refreshAll();
    final hash = 'a' * 64;
    for (final command in commands) {
      expect(await capturing.runOrQueue(type: command.type, method: 'POST', path: command.path,
        body: {
          command.revision: command.type == 'PUTAWAY' ? '2026-11-04T12:00:00.000Z' : hash,
          if (command.type == 'PUTAWAY') 'scannedBinCode': 'BIN-A',
          if (command.type == 'PUTAWAY') 'requireScan': true,
          if (command.type == 'PICK') 'lines': [{'itemId': 'item-1', 'quantity': 2}],
          if (command.type == 'TRANSFER_RECEIVE') 'lines': [{'itemId': 'item-1', 'lotId': 'lot-1', 'receivedQty': 2}],
          'requestId': 'req-${command.scope}',
        }), isTrue);
    }
    offline = false;
    policyAvailable = true;
    tokenVersion = 'replacement';
    final restarted = session();
    await restarted.loadQueuesForTest();
    await restarted.refreshAll();
    expect(replays, hasLength(3));
    for (final command in commands) {
      final online = attempts[command.path]!.single;
      final queued = replays.singleWhere((row) => row['type'] == command.wireType);
      expect(online.body.containsKey('offlinePermit'), isFalse);
      expect(online.mutationId, 'req-${command.scope}');
      expect(queued['contractVersion'], 2);
      expect(queued['entityId'], command.entityId);
      expect(queued['permit'], 'original-${command.scope}');
      expect(queued['commandId'], online.mutationId);
      expect(queued['revision'], online.body[command.revision]);
      expect(queued['payload'], Map<String, dynamic>.of(online.body)
        ..remove(command.revision)
        ..remove('requestId')
        ..remove('requireScan'));
    }
    final saved = (await store.loadQueuedActions('default-company', 'u1')).single;
    expect(saved.requiresRescan, isTrue);
    await restarted.retryQueuedAction(saved.localId);
    expect(replays, hasLength(3));
  });

  test('a permit-bearing count waits on an older API and resumes through the shared endpoint', () async {
    final sent = <http.Request>[];
    var apiVersion = 1;
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/runtime/config')) {
        return _json({'runtime': {
          if (apiVersion != 0) 'offlineCountPermit': {
            'token': 'original-count-permit',
            'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String(),
          },
          if (apiVersion == 2) 'offlineCommandVersion': 2,
        }});
      }
      if (request.method == 'POST') {
        sent.add(request);
        if (sent.length == 1) throw const SocketException('disconnected');
        return _json({'success': true});
      }
      return _json({});
    })..api.cacheScope = 'default-company|u1|STORE_USER';
    await controller.refreshAll();
    final revision = 'b' * 64;
    expect(await controller.submitCount(itemId: 'item-1', locationId: 'loc-1', physicalQuantity: 7, lotNo: 'LOT-1',
      stockRevision: revision), isTrue);
    apiVersion = 0;
    await controller.refreshAll();
    expect(sent, hasLength(1));
    expect(controller.queuedCounts.single.status, 'pending');
    expect(controller.queuedCounts.single.lastErrorCode, 'LOCAL_OFFLINE_TRANSPORT_UNAVAILABLE');
    apiVersion = 2;
    await controller.refreshAll();
    expect(sent, hasLength(2));
    expect(sent.last.url.path, '/api/v1/sync/commands');
    final initial = jsonDecode(sent.first.body) as Map<String, dynamic>;
    expect(jsonDecode(sent.last.body), {
      'contractVersion': 2, 'type': 'COUNT_SUBMIT', 'entityId': 'item-1',
      'commandId': initial['requestId'], 'revision': revision, 'permit': 'original-count-permit',
      'payload': {'locationId': 'loc-1', 'mode': 'manual', 'physicalQuantity': 7, 'lotNo': 'LOT-1'},
    });
    expect(controller.queuedCounts, isEmpty);
  });

  test('warehouse work with no current offline permission stays visible without replay', () async {
    var sends = 0;
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/runtime/config')) {
        return _json({'runtime': {'offlineWarehousePermits': {'putaway': null}}});
      }
      if (request.method == 'POST') {
        sends += 1;
        throw const SocketException('offline');
      }
      return _json({});
    })..api.cacheScope = 'default-company|u1|STORE_USER';
    await controller.refreshAll();
    const scan = {'taskRevision': 'revision', 'scannedBinCode': 'BIN-A'};
    expect(await controller.runOrQueue(type: 'PUTAWAY', method: 'POST',
      path: '/api/v1/putaway-tasks/b1/confirm', body: scan), isTrue);
    final saved = controller.queuedActions.single;
    expect(saved.body, scan);
    expect(saved.requiresRescan, isTrue);
    await controller.flushQueue();
    expect(sends, 1);
  });

  test('a restarted count replays the original permit and retains revoked work for recount', () async {
    final store = DriftStore.inMemory();
    addTearDown(store.close);
    var permit = 'original';
    var offline = true;
    var policyAvailable = true;
    final attempts = <Map<String, dynamic>>[];
    Future<http.Response> handle(http.Request request) async {
      if (request.url.path.endsWith('/runtime/config')) {
        if (!policyAvailable) throw const SocketException('offline');
        return _json({'runtime': {
          'offlineCountPermit': {
            'token': permit,
            'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String(),
          },
        }});
      }
      if (request.url.path.endsWith('/stock-counts/weight')) {
        attempts.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (offline) throw const SocketException('offline');
        return _json({'code': 'OFFLINE_COUNT_POLICY_REJECTED', 'error': 'Offline count permission changed.'}, 403);
      }
      return _json({});
    }
    final first = _controller(handle, store: store);
    first.api.cacheScope = 'default-company|u1|STORE_USER';
    await first.refreshAll();
    policyAvailable = false;
    final capturing = _controller(handle, store: store);
    capturing.api.cacheScope = 'default-company|u1|STORE_USER';
    await capturing.refreshAll();
    expect(await capturing.submitCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 2.5,
      weight: true, stockRevision: 'original-revision'), isTrue);
    expect(attempts.single.containsKey('offlineCountPermit'), isFalse);
    permit = 'replacement';
    policyAvailable = true;
    offline = false;
    final restarted = _controller(handle, store: store);
    restarted.api.cacheScope = 'default-company|u1|STORE_USER';
    await restarted.loadQueuesForTest();
    await restarted.refreshAll();
    expect(attempts, hasLength(2));
    expect(attempts.last['offlineCountPermit'], 'original');
    expect(attempts.last['requestId'], attempts.first['requestId']);
    expect(attempts.last['stockRevision'], 'original-revision');
    final saved = (await store.loadQueuedCounts('default-company', 'u1')).single;
    expect(saved.requiresRecount, isTrue);
    expect(saved.physicalQuantity, 2.5);
    await restarted.retryQueuedCount(saved.localId);
    expect(attempts, hasLength(2));
  });

  test('a count saved without permitted offline access stays in Sync Center', () async {
    final attempts = <http.Request>[];
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/runtime/config')) {
        return _json({'runtime': {'offlineCountPermit': null}});
      }
      if (request.url.path.endsWith('/stock-counts')) {
        attempts.add(request);
        throw const SocketException('offline');
      }
      return _json({});
    });
    controller.api.cacheScope = 'default-company|u1|STORE_USER';
    await controller.refreshAll();
    expect(await controller.submitCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 2,
      stockRevision: 'saved-revision'), isTrue);
    final saved = controller.queuedCounts.single;
    expect(saved.requiresRecount, isTrue);
    expect(saved.physicalQuantity, 2);
    await controller.flushQueue();
    expect(attempts, hasLength(1));
  });

  testWidgets('offline putaway retains the scanned bin and task revision until reconciliation', (tester) async {
    final sent = <Map<String, dynamic>>[];
    var offline = true;
    final controller = _controller((request) async {
      sent.add(jsonDecode(request.body) as Map<String, dynamic>);
      if (offline) throw const SocketException('offline');
      return _json({'code': 'PUTAWAY_TASK_CHANGED', 'message': 'Refresh your tasks.'}, 409);
    });
    const revision = '2026-11-27T06:45:00.000Z';
    controller.putawayTasks = [{'id': 'p1', 'itemId': 'i1', 'quantity': 5, 'updatedAt': revision}];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PutawayScreen(controller: controller))));
    await tester.enterText(find.byType(TextField), 'BIN-A');
    await tester.tap(find.widgetWithText(TextButton, 'Confirm'));
    await tester.pumpAndSettle();
    await controller.loadQueuesForTest();
    expect(controller.queuedActions.single.body, {'scannedBinCode': 'BIN-A', 'requireScan': true, 'taskRevision': revision});
    offline = false;
    await controller.flushQueue();
    await controller.loadQueuesForTest();
    final action = controller.queuedActions.single;
    expect(action.requiresRescan, isTrue);
    await controller.retryQueuedAction(action.localId);
    expect(sent, hasLength(2));
    expect(sent.last, sent.first);
  });
  test('quantities print without stray decimals', () {
    expect(formatQty(12), '12');
    expect(formatQty(12.0), '12');
    expect(formatQty(2.5), '2.5');
    expect(formatQty(0.125), '0.125');
    expect(formatQty(2.5004), '2.5');
    expect(formatQty(null), '-');
  });

  test('a count task carries only the lots worth counting and how the item is counted', () {
    final task = CountTask.fromJson({
      'assignmentId': 'a1',
      'locationId': 'loc-1',
      'recount': true,
      'item': {'id': 'i1', 'code': 'RICE', 'name': 'Rice', 'unit': 'KG', 'countMethod': 'ITEM_WEIGHT', 'decimalQuantity': true},
      'lots': [
        {'lotId': 'l1', 'lotNo': 'R-1', 'expiryDate': null},
      ],
    });
    expect(task.item.isWeightCounted, isTrue);
    expect(task.item.allowsDecimal, isTrue);
    expect(task.item.lots.map((lot) => lot.lotNo), ['R-1']);
    expect(task.recount, isTrue);
    final plain = CatalogItem.fromJson({'id': 'i2', 'code': 'PEN', 'name': 'Pen'});
    expect([plain.countMethod, plain.isWeightCounted, plain.allowsDecimal], ['LOT_SCAN', false, false]);
  });

  test('a queued count keeps its idempotency key through storage; old entries fall back to their local id', () {
    final queued = QueuedCount(localId: 'local-1', requestId: 'req-abc', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 2.5, mode: 'weight', createdAt: '2026-09-19T00:00:00Z');
    final again = decodeQueuedCounts(encodeQueuedCounts([queued])).single;
    expect([again.requestId, again.physicalQuantity, again.mode], ['req-abc', 2.5, 'weight']);
    final legacy = QueuedCount.fromJson({'localId': 'local-old', 'itemId': 'i1', 'locationId': 'loc-1', 'physicalQuantity': 3, 'createdAt': ''});
    expect(legacy.requestId, 'local-old');
  });

  test('a weight count posts one total with a request id; offline it is queued with the SAME id and re-sent as weight', () async {
    final seen = <http.Request>[];
    var online = false;
    final controller = _controller((request) async {
      seen.add(request);
      if (!online) throw const SocketException('offline');
      if (request.url.path.endsWith('/stock-counts/weight')) return _json({'success': true, 'lots': 3}, 201);
      if (request.url.path.endsWith('/counts')) return _json({'counts': []});
      return _json({});
    });

    expect(await controller.submitCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 5.5, weight: true), isTrue);
    expect(controller.queuedCounts, hasLength(1));
    final queued = controller.queuedCounts.single;
    expect([queued.mode, queued.physicalQuantity], ['weight', 5.5]);
    final firstBody = jsonDecode(seen.first.body) as Map<String, dynamic>;
    expect(seen.first.url.path, '/api/v1/stock-counts/weight');
    expect(firstBody['totalQuantity'], 5.5);
    expect(firstBody['requestId'], queued.requestId, reason: 'the queued retry must reuse the key of the attempt that timed out');

    online = true;
    seen.clear();
    await controller.flushQueue();
    final resent = seen.firstWhere((request) => request.url.path.endsWith('/stock-counts/weight'));
    expect((jsonDecode(resent.body) as Map<String, dynamic>)['requestId'], queued.requestId);
    expect(controller.queuedCounts, isEmpty);
  });

  test('a piece count is sent to the lot endpoint with a request id', () async {
    // A successful submit also re-fetches assignments/work-feed (a multi-lot item's assignment
    // does not close until every lot is counted, so the client re-checks rather than assumes) -
    // capture the specific /stock-counts request, not just whichever request came last.
    late http.Request captured;
    final controller = _controller((request) async {
      if (request.url.path == '/api/v1/stock-counts') captured = request;
      if (request.url.path.endsWith('/count-assignments/mine')) return _json({'assignments': []});
      if (request.url.path.endsWith('/mobile/work')) return _json({'countTasks': []});
      return _json({'success': true, 'count': {'id': 'c1', 'itemId': 'i1', 'locationId': 'loc-1', 'physicalQuantity': 7}}, 201);
    });
    expect(await controller.submitCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 7, lotNo: 'LOT-1'), isTrue);
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    expect(captured.url.path, '/api/v1/stock-counts');
    expect([body['physicalQuantity'], body['lotNo'], (body['requestId'] as String).startsWith('req-')], [7, 'LOT-1', true]);
    expect(controller.counts.single.physicalQuantity, 7);
  });

  test('a rejected count waits for the user; it is flagged, never resent on its own', () async {
    var calls = 0;
    final controller = _controller((request) async {
      calls += 1;
      return _json({'message': 'This item is not assigned to you'}, 403);
    });
    await controller.enqueueCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 1);
    await controller.flushQueue();
    expect(controller.queuedCounts.single.status, 'rejected');
    expect(controller.attentionCount, 1);
    await controller.flushQueue();
    expect(calls, 1, reason: 'a rejected item is not retried automatically');
  });

  test('an offline count retains its stock revision and requires a fresh count after a conflict', () async {
    final payloads = <Map<String, dynamic>>[];
    final store = DriftStore.inMemory();
    addTearDown(store.close);
    var offline = true;
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/stock-counts/weight')) {
        payloads.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (offline) throw const SocketException('offline');
        return _json({'code': 'COUNT_STOCK_CHANGED', 'error': 'Stock changed since this count was started.'}, 409);
      }
      return _json({});
    }, store: store);
    const revision = 'original-revision';
    expect(await controller.submitCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 5, weight: true, stockRevision: revision), isTrue);
    await controller.loadQueuesForTest();
    expect(controller.queuedCounts.single.stockRevision, revision);
    offline = false;
    await controller.flushQueue();
    await controller.loadQueuesForTest();
    final stale = controller.queuedCounts.single;
    expect(stale.requiresRecount, isTrue);
    expect(stale.status, 'conflict');
    await controller.retryQueuedCount(stale.localId);
    expect(payloads, hasLength(2));
    expect(payloads.map((body) => body['stockRevision']), [revision, revision]);
    expect(payloads.last['requestId'], payloads.first['requestId']);
  });

  test('concurrent local captures keep both writes in SQLite', () async {
    final store = DriftStore.inMemory();
    addTearDown(store.close);
    final controller = _controller((request) async => _json({}), store: store);
    await Future.wait([
      controller.enqueueCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 1, requestId: 'first-count'),
      controller.enqueueCount(itemId: 'i2', locationId: 'loc-1', physicalQuantity: 2, requestId: 'second-count'),
      for (final key in ['first-action', 'second-action'])
        controller.enqueueAction(type: 'PUTAWAY', method: 'POST', path: '/api/v1/putaway-tasks/t1/confirm', body: {}, mutationId: key),
    ]);
    expect((await controller.store.loadQueuedCounts('default-company', 'u1')).map((row) => row.requestId), ['first-count', 'second-count']);
    expect((await controller.store.loadQueuedActions('default-company', 'u1')).map((row) => row.mutationId), ['first-action', 'second-action']);
  });

  test('restored counts and warehouse actions share one ordered retry queue', () async {
    final store = DriftStore.inMemory();
    addTearDown(store.close);
    await store.saveQueuedCounts([
      QueuedCount(localId: 'count', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 1,
        userId: 'u1', createdAt: '2026-09-19T10:00:01Z'),
    ], 'default-company', 'u1');
    await store.saveQueuedActions([
      for (final (id, second) in [('receive', '00'), ('putaway', '02')])
        QueuedAction(localId: id, type: id.toUpperCase(), method: 'POST', path: '/api/v1/$id', body: {},
          companyId: 'default-company', userId: 'u1', createdAt: '2026-09-19T10:00:${second}Z'),
    ], 'default-company', 'u1');
    final sent = <String>[];
    var temporarilyUnavailable = true;
    final controller = _controller((request) async {
      if (request.method != 'POST') return _json({});
      sent.add(request.url.pathSegments.last);
      if (sent.last == 'receive' && temporarilyUnavailable) {
        return http.Response('{"error":"Busy"}', 503, headers: {'content-type': 'application/json', 'retry-after': '60'});
      }
      return _json({'count': {'id': 'c1'}});
    }, store: store);
    controller.queuedCounts = await store.loadQueuedCounts('default-company', 'u1');
    controller.queuedActions = await store.loadQueuedActions('default-company', 'u1');
    final firstAttempt = DateTime.utc(2026, 9, 19, 12);
    await controller.flushQueue(now: firstAttempt);
    expect(sent, ['receive']);
    expect(await store.loadQueuedCounts('default-company', 'u1'), hasLength(1));
    final actions = await store.loadQueuedActions('default-company', 'u1');
    expect(actions.first.attempts, 1);
    expect(actions.last.attempts, 0);
    temporarilyUnavailable = false;
    await controller.flushQueue(now: firstAttempt.add(const Duration(seconds: 30)));
    expect(sent, ['receive']);
    await controller.flushQueue(now: DateTime.parse(actions.first.nextAttemptAt!).add(const Duration(seconds: 1)));
    expect(sent, ['receive', 'receive', 'stock-counts', 'putaway']);
    expect(await store.loadQueuedCounts('default-company', 'u1'), isEmpty);
    expect(await store.loadQueuedActions('default-company', 'u1'), isEmpty);
  });

  test('overlapping sync calls send once and preserve work added during replay', () async {
    final started = Completer<void>();
    final reply = Completer<http.Response>();
    final sent = <String>[];
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/stock-counts')) {
        sent.add(jsonDecode(request.body)['requestId'] as String);
        if (!started.isCompleted) started.complete();
        return reply.future;
      }
      return _json({});
    });
    await controller.enqueueCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 1, requestId: 'first');
    final first = controller.flushQueue();
    await started.future;
    final overlapping = controller.flushQueue();
    await controller.enqueueCount(itemId: 'i2', locationId: 'loc-1', physicalQuantity: 2, requestId: 'new');
    reply.complete(_json({'count': {'id': 'c1'}}));
    await Future.wait([first, overlapping]);
    expect(sent, ['first']);
    expect((await controller.store.loadQueuedCounts('default-company', 'u1')).map((row) => row.requestId), ['new']);
  });

  test('sign-out stops the old replay and leaves its unconfirmed items with their original identity', () async {
    final started = Completer<void>();
    final reply = Completer<http.Response>();
    final sent = <String>[];
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/stock-counts')) {
        sent.add(jsonDecode(request.body)['requestId'] as String);
        if (!started.isCompleted) started.complete();
        return reply.future;
      }
      return _json({});
    });
    await controller.enqueueCount(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 1, requestId: 'first');
    await controller.enqueueCount(itemId: 'i2', locationId: 'loc-1', physicalQuantity: 2, requestId: 'second');
    final replay = controller.flushQueue();
    await started.future;
    await controller.logout();
    controller.user = const AuthUser(id: 'u2', name: 'Picker', email: 'picker@retail.local', role: 'WAREHOUSE_PICKER');
    controller.api.token = 'another-jwt';
    await controller.enqueueCount(itemId: 'i3', locationId: 'loc-1', physicalQuantity: 3, requestId: 'new-account');
    reply.complete(_json({'count': {'id': 'c1'}}));
    await replay;
    expect(sent, ['first']);
    expect((await controller.store.loadQueuedCounts('default-company', 'u1')).map((row) => row.requestId), ['first', 'second']);
    expect((await controller.store.loadQueuedCounts('default-company', 'u2')).map((row) => row.requestId), ['new-account']);
  });

  testWidgets('the Conflict Center lists what needs a decision, with the reason, and can discard it', (tester) async {
    await tester.binding.setSurfaceSize(const Size(900, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final controller = _controller((request) async => _json({}));
    controller.items = const [CatalogItem(id: 'i1', code: 'RICE', name: 'Basmati rice')];
    controller.queuedCounts = [
      QueuedCount(localId: 'local-1', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 4, createdAt: '2026-09-19T00:00:00Z', status: 'conflict', lastError: 'This lot is already submitted'),
      QueuedCount(localId: 'local-2', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 9, createdAt: '2026-09-19T00:00:00Z'),
      QueuedCount(localId: 'stale', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 8, createdAt: '2026-09-19T00:00:00Z',
        status: 'conflict', lastErrorCode: 'COUNT_STOCK_CHANGED'),
    ];
    await tester.pumpWidget(MaterialApp(home: ConflictCenterScreen(controller: controller)));
    expect(find.text('Needs your decision (2)'), findsOneWidget);
    expect(find.text('Waiting for connection (1)'), findsOneWidget);
    expect(find.textContaining('Server said: This lot is already submitted'), findsOneWidget);
    expect(find.byKey(const ValueKey('retry-local-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('retry-local-2')), findsNothing, reason: 'a waiting item has nothing to decide yet');
    expect(find.byKey(const ValueKey('retry-stale')), findsNothing);
    expect(find.textContaining('Recount required.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('discard-local-1')));
    await tester.pumpAndSettle();
    expect(find.text('Discard this?'), findsOneWidget);
    await tester.tap(find.text('Keep'));
    await tester.pumpAndSettle();
    expect(controller.queuedCounts.map((row) => row.localId), contains('local-1'), reason: 'Keep must not discard');

    await tester.tap(find.byKey(const ValueKey('discard-local-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirm-discard')));
    await tester.pumpAndSettle();
    expect(controller.queuedCounts.map((row) => row.localId), ['local-2', 'stale']);
    expect(find.text('Needs your decision (1)'), findsOneWidget);
  });

  testWidgets('a live refresh cannot replace the revision behind a quantity already entered', (tester) async {
    final payloads = <Map<String, dynamic>>[];
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/stock-counts')) {
        payloads.add(jsonDecode(request.body) as Map<String, dynamic>);
        throw const SocketException('offline');
      }
      return _json({});
    });
    CountTask task(String revision) => CountTask.fromJson({
      'assignmentId': 'a1', 'locationId': 'loc-1',
      'item': {'id': 'i1', 'code': 'PEN', 'name': 'Pen', 'countMethod': 'LOT_SCAN'},
      'lots': [{'lotId': 'l1', 'lotNo': 'LOT-1', 'stockRevision': revision}],
    });
    controller
      ..locations = const [LocationRecord(id: 'loc-1', name: 'Store', type: 'store')]
      ..assignments = const [CountAssignment(id: 'a1', itemId: 'i1', locationId: 'loc-1', itemName: 'Pen')]
      ..countTasks = [task('revision-while-counting')]
      ..pendingCountItemId = 'i1';
    await tester.binding.setSurfaceSize(const Size(900, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ListenableBuilder(
      listenable: controller,
      builder: (_, _) => CountScreen(controller: controller),
    ))));
    await tester.pumpAndSettle();
    final quantity = find.byKey(const ValueKey('count-qty'));
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '4');
    controller.countTasks = [task('revision-after-refresh')];
    controller.setNotice('Work refreshed.');
    await tester.pumpAndSettle();
    final submit = find.widgetWithText(FilledButton, 'Submit count');
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    expect(payloads.single['stockRevision'], 'revision-while-counting');
    expect(controller.queuedCounts.single.stockRevision, 'revision-while-counting');
  });
}
