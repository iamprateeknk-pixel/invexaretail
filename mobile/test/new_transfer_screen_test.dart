import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/new_transfer_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

const rice = CatalogItem(id: 'i1', code: 'SKU-1', name: 'Rice', unit: 'KG', lots: [
  LotRecord(id: 'l1', lotNo: 'LOT-A'),
  LotRecord(id: 'l2', lotNo: 'LOT-B'),
]);

http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

SessionController _controller(List<http.Request> sent, {int transferStatus = 201}) {
  final controller = SessionController(
    api: InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async {
        sent.add(request);
        if (request.url.path == '/api/v1/transfers' && request.method == 'POST') {
          return transferStatus == 201
              ? _json({'success': true, 'transfer': {'id': 't1', 'sourceLocationId': 'loc-1', 'destinationLocationId': 'loc-2', 'status': 'REQUESTED', 'lines': []}}, 201)
              : _json({'message': 'Only 3 available at this location.'}, 409);
        }
        return _json({});
      }),
    ),
    store: MemoryStore(),
  )
    ..restoring = false
    ..user = const AuthUser(id: 'u1', name: 'Store', email: 's@retail.local', role: 'STORE_USER')
    ..selectedLocationId = 'loc-1'
    ..locations = const [LocationRecord(id: 'loc-1', name: 'Main Store', type: 'store'), LocationRecord(id: 'loc-2', name: 'Warehouse', type: 'warehouse')]
    ..stock = const [
      StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l1', physicalQuantity: 8),
      StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l2', physicalQuantity: 0),
      StockRow(itemId: 'i1', locationId: 'loc-2', lotId: 'l2', physicalQuantity: 50),
    ];
  controller.api.token = 'jwt';
  return controller;
}

Future<void> _pump(WidgetTester tester, SessionController controller, {String? lot}) =>
    tester.pumpWidget(MaterialApp(home: NewTransferScreen(controller: controller, item: rice, initialLotId: lot)));

void main() {
  testWidgets('only lots with stock at this location are offered, and the lot is preselected when there is one', (tester) async {
    await _pump(tester, _controller([]));
    expect(find.text('LOT-A · 8 in stock'), findsOneWidget);
    expect(find.textContaining('LOT-B'), findsNothing, reason: 'zero stock here, and stock elsewhere does not count');
  });

  testWidgets('submitting with nothing chosen explains what is missing and sends nothing', (tester) async {
    final sent = <http.Request>[];
    await _pump(tester, _controller(sent));
    await tester.tap(find.byKey(const ValueKey('transfer-submit')));
    await tester.pump();
    expect(find.text('Choose where the stock is going.'), findsOneWidget);
    expect(sent, isEmpty);
  });

  testWidgets('more than the stock on hand is blocked before any request', (tester) async {
    final sent = <http.Request>[];
    await _pump(tester, _controller(sent));
    await tester.tap(find.byKey(const ValueKey('transfer-destination')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Warehouse').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('transfer-quantity')), '9');
    await tester.tap(find.byKey(const ValueKey('transfer-submit')));
    await tester.pump();
    expect(find.text('That is more than this location has in stock.'), findsOneWidget);
    expect(sent, isEmpty);
  });

  testWidgets('a valid request posts the expected body', (tester) async {
    final sent = <http.Request>[];
    await _pump(tester, _controller(sent));
    await tester.tap(find.byKey(const ValueKey('transfer-destination')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Warehouse').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('transfer-quantity')), '5');
    await tester.tap(find.byKey(const ValueKey('transfer-submit')));
    await tester.pumpAndSettle();
    final post = sent.firstWhere((request) => request.method == 'POST' && request.url.path == '/api/v1/transfers');
    expect(jsonDecode(post.body), {
      'sourceLocationId': 'loc-1',
      'destinationLocationId': 'loc-2',
      'lines': [
        {'itemId': 'i1', 'lotId': 'l1', 'quantity': 5},
      ],
    });
  });

  testWidgets('a server refusal is shown on the screen and the screen stays open', (tester) async {
    final sent = <http.Request>[];
    await _pump(tester, _controller(sent, transferStatus: 409));
    await tester.tap(find.byKey(const ValueKey('transfer-destination')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Warehouse').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('transfer-quantity')), '5');
    await tester.tap(find.byKey(const ValueKey('transfer-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Only 3 available at this location.'), findsOneWidget);
    expect(find.byKey(const ValueKey('transfer-submit')), findsOneWidget);
  });
}
