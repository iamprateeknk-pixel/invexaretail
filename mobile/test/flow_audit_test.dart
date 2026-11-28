// Pick, stock count and bin-walk scan: cases where the app could send the wrong quantity, the
// wrong lot, or the same work twice.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/count_screen.dart';
import 'package:invexaretail_mobile/screens/pick_screen.dart';
import 'package:invexaretail_mobile/screens/scan_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/pick_session.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

Map<String, dynamic> _pick() => {
      'transfer': {
        'id': 'tr-1',
        'lines': [
          {'itemId': 'pen', 'itemCode': 'PEN', 'itemName': 'Pen', 'unit': 'PCS', 'pickMethod': 'LOT_SCAN', 'remainingQty': 3, 'lotId': 'l1', 'lotNo': 'LOT-1', 'lotAvailable': 10, 'lotStatus': 'AVAILABLE'},
          {'itemId': 'rice', 'itemCode': 'RICE', 'itemName': 'Rice', 'unit': 'KG', 'pickMethod': 'ITEM_QTY_FIFO', 'remainingQty': 5, 'lotId': 'l4', 'lotNo': 'LOT-4', 'lotAvailable': 9, 'lotStatus': 'AVAILABLE'},
        ],
      },
    };

void main() {
  group('pick: a problem is reported once, and never on top of what was picked', () {
    test('reporting twice does not double the exception quantity', () {
      final session = PickSession.fromServer(_pick());
      session.scan('PEN');
      expect(session.report('pen', 'NO_STOCK', session.unreportedFor('pen')).accepted, isTrue);
      expect(session.unreportedFor('pen'), 0);
      expect(session.report('pen', 'DAMAGED_ITEM', 2).accepted, isFalse, reason: 'the 2 are already reported');
      final body = session.slipBody(requestId: 'r', finished: true);
      final reported = (body['exceptions'] as List).fold<num>(0, (sum, row) => sum + (row['quantity'] as num));
      expect(reported, 2, reason: '1 picked + 2 reported = the 3 asked for, never 1 + 4');
    });

    test('after the rest is reported, a further scan is refused', () {
      final session = PickSession.fromServer(_pick());
      session.report('pen', 'NO_STOCK', 3);
      expect(session.scan('PEN').accepted, isFalse);
      expect(session.scannedFor('pen'), 0);
    });

    test('a weight cannot cover kilos already reported as a problem', () {
      final session = PickSession.fromServer(_pick());
      session.report('rice', 'DAMAGED_ITEM', 2);
      expect(session.setWeight('rice', 4).accepted, isFalse, reason: 'only 3 kg are still open');
      expect(session.setWeight('rice', 3).accepted, isTrue);
    });
  });

  test('count: the lot shown in the picker is the lot the count is booked against', () {
    const lots = [LotRecord(id: 'a', lotNo: 'A-1'), LotRecord(id: 'b', lotNo: 'B-2')];
    expect(effectiveCountLot(lots, null), 'A-1', reason: 'the picker shows the first lot when none was chosen');
    expect(effectiveCountLot(lots, 'GONE'), 'A-1', reason: 'a stale choice is not sent');
    expect(effectiveCountLot(lots, 'B-2'), 'B-2');
    expect(effectiveCountLot(const [], 'A-1'), isNull, reason: 'an item without lots is counted without one');
  });

  SessionController controllerWith(MockClient client) => SessionController(
        api: InvexaApi(baseUrl: 'http://api.test', httpClient: client),
        store: MemoryStore(),
      )
        ..restoring = false
        ..user = const AuthUser(id: 'u1', name: 'Picker', email: 'p@retail.local', role: 'WAREHOUSE_PICKER')
        ..api.token = 'jwt';

  testWidgets('pick: a task with an offline slip still waiting to sync is not offered again', (tester) async {
    var fetched = 0;
    final controller = controllerWith(MockClient((request) async {
      fetched++;
      return http.Response(jsonEncode(_pick()), 200);
    }));
    controller.queuedActions = [
      QueuedAction(localId: 'q1', type: 'PICK', method: 'POST', path: '/api/v1/picker/transfers/tr-1/pick-slips', body: const {}, createdAt: '2026-11-28'),
    ];
    await tester.pumpWidget(MaterialApp(home: PickDetailScreen(transferId: 'tr-1', controller: controller)));
    await tester.pump();
    expect(find.textContaining('saved offline and has not synced yet'), findsOneWidget);
    expect(find.byKey(const ValueKey('pick-finish')), findsNothing, reason: 'nothing can be picked twice');
    expect(fetched, 0);
  });

  testWidgets('bin walk: a new wave starts at the first bin, and an accepted bin is not resent', (tester) async {
    final sent = <Map<String, dynamic>>[];
    final controller = controllerWith(MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      sent.add({'path': request.url.path, ...body});
      return http.Response(jsonEncode({'scannedIndex': (body['scannedIndex'] as int) + 1, 'nextBin': 'B-2'}), 200);
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ScanScreen(controller: controller))));
    await tester.enterText(find.byKey(const ValueKey('scan-wave')), 'wave-1');
    await tester.enterText(find.byKey(const ValueKey('scan-bin')), 'B-1');
    await tester.tap(find.byKey(const ValueKey('scan-confirm')));
    await tester.pumpAndSettle();
    expect(sent.last['scannedIndex'], 0);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('scan-bin'))).controller!.text, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('scan-wave')), 'wave-2');
    await tester.enterText(find.byKey(const ValueKey('scan-bin')), 'C-1');
    await tester.tap(find.byKey(const ValueKey('scan-confirm')));
    await tester.pumpAndSettle();
    expect(sent.last['path'], '/api/v1/pick-waves/wave-2/scan');
    expect(sent.last['scannedIndex'], 0, reason: 'wave-2 starts its own walk, not at wave-1\'s position');
  });
}
