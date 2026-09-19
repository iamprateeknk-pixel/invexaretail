import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/pick_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/pick_session.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

Map<String, dynamic> _payload() => {
      'transfer': {
        'id': 'tr-9',
        'lines': [
          {'itemId': 'pen', 'itemCode': 'PEN', 'itemName': 'Pen', 'unit': 'PCS', 'pickMethod': 'LOT_SCAN', 'remainingQty': 3, 'lotId': 'l1', 'lotNo': 'LOT-1', 'lotAvailable': 10, 'lotStatus': 'AVAILABLE'},
          {'itemId': 'pen', 'itemCode': 'PEN', 'itemName': 'Pen', 'unit': 'PCS', 'pickMethod': 'LOT_SCAN', 'remainingQty': 2, 'lotId': 'l2', 'lotNo': 'LOT-2', 'lotAvailable': 0, 'lotStatus': 'AVAILABLE'},
          {'itemId': 'cup', 'itemCode': 'CUP', 'itemName': 'Cup', 'unit': 'PCS', 'pickMethod': 'LOT_SCAN', 'remainingQty': 4, 'lotId': 'l3', 'lotNo': 'LOT-3', 'lotAvailable': 9, 'lotStatus': 'BLOCKED'},
          {'itemId': 'rice', 'itemCode': 'RICE', 'itemName': 'Rice', 'unit': 'KG', 'pickMethod': 'ITEM_QTY_FIFO', 'remainingQty': 5.5, 'lotId': 'l4', 'lotNo': 'LOT-4', 'lotAvailable': 9, 'lotStatus': 'AVAILABLE'},
          {'itemId': 'done', 'itemCode': 'DONE', 'itemName': 'Done', 'unit': 'PCS', 'pickMethod': 'LOT_SCAN', 'remainingQty': 0, 'lotId': 'l5', 'lotNo': 'LOT-5', 'lotAvailable': 9, 'lotStatus': 'AVAILABLE'},
        ],
      },
    };

void main() {
  test('only what can actually be picked is listed: no zero-stock or blocked lot, nothing already done', () {
    final session = PickSession.fromServer(_payload());
    expect(session.lines.map((line) => line.itemId), ['pen', 'rice']);
    expect(session.line('pen')!.lots.map((lot) => lot.lotNo), ['LOT-1'], reason: 'the empty lot is not offered');
    expect(session.line('rice')!.pooled, isTrue);
    expect(session.line('rice')!.lots, isEmpty, reason: 'KG lots are the server\'s choice');
  });

  test('piece scans must be this item or one of its listed lots, and stop at what is left', () {
    final session = PickSession.fromServer(_payload());
    expect(session.scan('NOT-ON-THE-LIST').accepted, isFalse);
    expect(session.scan('LOT-2').accepted, isFalse, reason: 'a zero-stock lot cannot be scanned in');
    expect(session.scan('CUP').accepted, isFalse, reason: 'a blocked lot\'s item is not offered');
    expect(session.scan('rice').accepted, isFalse, reason: 'a KG item is picked by weight, not by scan');
    for (final code in ['pen', 'LOT-1', ' pen ']) {
      expect(session.scan(code).accepted, isTrue);
    }
    expect(session.scannedFor('pen'), 3);
    // 5 were asked for, but 2 of them sit in a lot with nothing on the shelf: they stay "left" (to be reported as No Stock) and cannot be scanned in.
    expect(session.leftFor('pen'), 2);
    expect(session.scan('PEN').accepted, isFalse, reason: 'a fourth scan is refused');
    session.undoScan('pen');
    expect(session.leftFor('pen'), 3);
    expect(session.scan('LOT-1').accepted, isTrue);
  });

  test('a weight cannot exceed what is still to be picked, and the slip carries item + weight only', () {
    final session = PickSession.fromServer(_payload());
    expect(session.setWeight('rice', 6).accepted, isFalse);
    expect(session.setWeight('pen', 1).accepted, isFalse, reason: 'weights are for KG items');
    expect(session.setWeight('rice', 2.25).accepted, isTrue);
    expect(session.leftFor('rice'), 3.25);
    session.scan('pen');
    session.report('rice', 'NO_STOCK', 3.25);
    final body = session.slipBody(requestId: 'req-1', finished: false);
    expect(body['requestId'], 'req-1');
    expect(body['finished'], isFalse);
    expect(body['lines'], [
      {'itemId': 'pen', 'lotId': 'l1', 'quantity': 1.0, 'inputMethod': 'SCAN', 'scanCode': 'pen'},
      {'itemId': 'rice', 'quantity': 2.25, 'inputMethod': 'MANUAL'},
    ]);
    expect((body['exceptions'] as List).single, {'itemId': 'rice', 'reason': 'NO_STOCK', 'quantity': 3.25});
    session.clearPending();
    expect(session.hasPending, isFalse);
  });

  testWidgets('a pick saves progress with one request id that survives a failed attempt', (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async => null);
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final slips = <Map<String, dynamic>>[];
    var failFirst = true;
    final controller = SessionController(
      api: InvexaApi(
        baseUrl: 'http://api.test',
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/allocation-preview')) {
            return http.Response(jsonEncode({'allocations': [{'lotId': 'a', 'lotNo': 'E0', 'quantity': 2.0, 'expiryDate': '2027-01-01T00:00:00Z'}, {'lotId': 'b', 'lotNo': 'E1', 'quantity': 0.5}]}), 200, headers: {'content-type': 'application/json'});
          }
          if (request.url.path.endsWith('/pick-slips')) {
            slips.add(jsonDecode(request.body) as Map<String, dynamic>);
            if (failFirst) {
              failFirst = false;
              return http.Response(jsonEncode({'message': 'Try again'}), 500, headers: {'content-type': 'application/json'});
            }
            return http.Response(jsonEncode({'success': true}), 201, headers: {'content-type': 'application/json'});
          }
          if (request.url.path.contains('/picker/transfers/')) return http.Response(jsonEncode(_payload()), 200, headers: {'content-type': 'application/json'});
          return http.Response(jsonEncode({'transfers': [], 'locations': [], 'items': [], 'counts': [], 'assignments': []}), 200, headers: {'content-type': 'application/json'});
        }),
      ),
      store: MemoryStore(),
    )
      ..restoring = false
      ..user = const AuthUser(id: 'p1', name: 'Picker', email: 'p@x', role: 'WAREHOUSE_PICKER');
    controller.api.token = 'jwt';

    await tester.pumpWidget(MaterialApp(home: PickDetailScreen(transferId: 'tr-9', controller: controller)));
    await tester.pumpAndSettle();
    expect(find.text('Pen'), findsOneWidget);
    expect(find.text('Cup'), findsNothing);

    await tester.enterText(find.byKey(const ValueKey('pick-weight-rice')), '2.5');
    await tester.tap(find.text('Preview'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Take 2 KG from lot E0'), findsOneWidget);
    expect(find.textContaining('Take 0.5 KG from lot E1'), findsOneWidget);

    await tester.scrollUntilVisible(find.byKey(const ValueKey('pick-save')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('pick-save')));
    await tester.pumpAndSettle();
    expect(slips, hasLength(1));
    await tester.tap(find.byKey(const ValueKey('pick-save')));
    await tester.pumpAndSettle();
    expect(slips, hasLength(2));
    expect(slips[1]['requestId'], slips[0]['requestId'], reason: 'the retry carries the same key, so the server saves the slip once');
    expect(slips[1]['lines'], [
      {'itemId': 'rice', 'quantity': 2.5, 'inputMethod': 'MANUAL'},
    ]);
  });
}
