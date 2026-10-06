import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/conflict_center_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

SessionController _controller(Future<http.Response> Function(http.Request request) handler) {
  final controller = SessionController(
    api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient(handler)),
    store: MemoryStore(),
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

  testWidgets('the Conflict Center lists what needs a decision, with the reason, and can discard it', (tester) async {
    final controller = _controller((request) async => _json({}));
    controller.items = const [CatalogItem(id: 'i1', code: 'RICE', name: 'Basmati rice')];
    controller.queuedCounts = [
      QueuedCount(localId: 'local-1', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 4, createdAt: '2026-09-19T00:00:00Z', status: 'conflict', lastError: 'This lot is already submitted'),
      QueuedCount(localId: 'local-2', itemId: 'i1', locationId: 'loc-1', physicalQuantity: 9, createdAt: '2026-09-19T00:00:00Z'),
    ];
    await tester.pumpWidget(MaterialApp(home: ConflictCenterScreen(controller: controller)));
    expect(find.text('Needs your decision (1)'), findsOneWidget);
    expect(find.text('Waiting for connection (1)'), findsOneWidget);
    expect(find.textContaining('Server said: This lot is already submitted'), findsOneWidget);
    expect(find.byKey(const ValueKey('retry-local-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('retry-local-2')), findsNothing, reason: 'a waiting item has nothing to decide yet');

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
    expect(controller.queuedCounts.map((row) => row.localId), ['local-2']);
    expect(find.text('Needs your decision (1)'), findsNothing);
  });
}
