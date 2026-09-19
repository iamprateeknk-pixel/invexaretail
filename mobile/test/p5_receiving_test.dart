import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/receive_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

SessionController _controller(Future<http.Response> Function(http.Request request) handler, {List<TransferRecord> transfers = const []}) {
  final controller = SessionController(
    api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient(handler)),
    store: MemoryStore(),
  )
    ..restoring = false
    ..user = const AuthUser(id: 'u1', name: 'Store', email: 'store@retail.local', role: 'STORE_USER')
    ..selectedLocationId = 'loc-1'
    ..transfers = transfers
    ..items = const [
      CatalogItem(id: 'i1', code: 'PEN', name: 'Pen'),
      CatalogItem(id: 'i2', code: 'RICE', name: 'Rice', unit: 'KG', countMethod: 'ITEM_WEIGHT', decimalQuantity: true),
    ];
  controller.api.token = 'jwt';
  return controller;
}

TransferRecord _transfer({double received = 0}) => TransferRecord.fromJson({
      'id': 'tr-1',
      'sourceLocationId': 'wh-1',
      'destinationLocationId': 'loc-1',
      'status': received > 0 ? 'PARTIAL_RECEIVED' : 'DISPATCHED',
      'cartonCount': 2,
      'lines': [
        {'itemId': 'i1', 'lotId': 'l1', 'quantity': 10, 'receivedQty': received},
        {'itemId': 'i2', 'lotId': 'l2', 'quantity': 5.5},
      ],
      'cartons': [
        {'packageId': 'PKG-000001-01', 'quantity': 6},
        {'packageId': 'PKG-000001-02', 'quantity': 9.5},
      ],
      'dispatch': {'carrier': 'BlueDart', 'awb': 'AWB-7', 'expectedArrivalAt': '2026-09-20T10:00:00.000Z'},
      'delayed': true,
    });

void main() {
  test('a transfer knows its cartons, dispatch, open quantity and which code points at it', () {
    final transfer = _transfer(received: 4);
    expect(transfer.cartons.map((carton) => carton.packageId), ['PKG-000001-01', 'PKG-000001-02']);
    expect(transfer.dispatch!.awb, 'AWB-7');
    expect(transfer.delayed, isTrue);
    expect(transfer.totalQuantity, 15.5);
    expect(transfer.lines.first.remaining, 6);
    expect(transfer.lines.last.remaining, 5.5);
    expect(transfer.matchesCode('pkg-000001-02'), isTrue);
    expect(transfer.matchesCode('TR-1'), isTrue);
    expect(transfer.matchesCode('nope'), isFalse);
    expect(transfer.matchesCode(''), isFalse);
  });

  testWidgets('a carton code opens its transfer', (tester) async {
    // Haptics and the alert sound go through the platform channel.
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async => null);
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final transfer = _transfer();
    final controller = _controller((request) async => _json({'evidence': []}), transfers: [transfer]);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ReceiveScreen(controller: controller))));
    expect(find.text('Delayed'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('receive-code')), 'pkg-000001-01');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pumpAndSettle();
    expect(find.text('Transfer tr-1'), findsOneWidget);
    expect(find.textContaining('AWB AWB-7'), findsOneWidget);
    expect(find.text('PKG-000001-02 · 9.5'), findsOneWidget);
  });

  testWidgets('a retried receipt reuses one request id, and only open lines are sent', (tester) async {
    final bodies = <Map<String, dynamic>>[];
    var failFirst = true;
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/receive')) {
        bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (failFirst) {
          failFirst = false;
          return _json({'message': 'Try again'}, 500);
        }
        return _json({'success': true, 'duplicate': false});
      }
      return _json({'evidence': [], 'transfers': [], 'locations': [], 'items': [], 'counts': [], 'assignments': []});
    });
    // Line 1 was partly received earlier (4 of 10): only 6 are open.
    await tester.pumpWidget(MaterialApp(home: TransferDetailScreen(transfer: _transfer(received: 4), controller: controller)));
    await tester.pumpAndSettle();
    expect(find.textContaining('open 6'), findsOneWidget);

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '5'); // pen received
    await tester.enterText(fields.at(1), '1'); // pen damaged
    await tester.enterText(fields.at(2), '2.25'); // rice, decimal allowed
    await tester.scrollUntilVisible(find.text('Confirm receipt'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Confirm receipt'));
    await tester.pumpAndSettle();
    expect(bodies, hasLength(1));

    await tester.tap(find.text('Confirm receipt'));
    await tester.pumpAndSettle();
    expect(bodies, hasLength(2));
    expect(bodies[1]['requestId'], bodies[0]['requestId'], reason: 'the retry must carry the same key');
    final lines = (bodies[1]['lines'] as List).cast<Map<String, dynamic>>();
    expect(lines.map((line) => [line['itemId'], line['receivedQty'], line['damagedQty'], line['shortageQty']]), [
      ['i1', 5, 1, 0],
      ['i2', 2.25, 0, 0],
    ]);
  });

  testWidgets('closing the missing quantity as short, and declaring an excess', (tester) async {
    final bodies = <Map<String, dynamic>>[];
    final controller = _controller((request) async {
      if (request.url.path.endsWith('/receive')) {
        bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        return _json({'success': true});
      }
      return _json({'evidence': [], 'transfers': [], 'locations': [], 'items': [], 'counts': [], 'assignments': []});
    });
    await tester.pumpWidget(MaterialApp(home: TransferDetailScreen(transfer: _transfer(), controller: controller)));
    await tester.pumpAndSettle();
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '7'); // pen: 7 of 10 arrived, 3 missing
    await tester.enterText(fields.at(2), '6'); // rice: 6 of 5.5 arrived, 0.5 excess
    await tester.scrollUntilVisible(find.byKey(const ValueKey('close-short')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('close-short')));
    await tester.pump();
    await tester.scrollUntilVisible(find.text('Confirm receipt'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Confirm receipt'));
    await tester.pumpAndSettle();
    final lines = (bodies.single['lines'] as List).cast<Map<String, dynamic>>();
    expect(lines.map((line) => [line['itemId'], line['receivedQty'], line['shortageQty'], line['excessQty']]), [
      ['i1', 7, 3, 0],
      ['i2', 5.5, 0, 0.5],
    ]);
  });
}
