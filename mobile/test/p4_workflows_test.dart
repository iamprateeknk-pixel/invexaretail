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
