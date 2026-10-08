// A store user reported: on "Store floor", opening anything shows a black screen full of details.
// This drives that exact role through the real app shell and theme with realistic data, opens every
// kind of item the Work and Stock tabs offer, and fails on any exception or on a screen that is not
// drawn on a real Material surface (a pushed page without a Scaffold shows text on black).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/app.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

SessionController _storeController() {
  final controller = SessionController(
    api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async => http.Response('{}', 200, headers: {'content-type': 'application/json'}))),
    store: MemoryStore(),
  )
    ..restoring = false
    ..user = const AuthUser(id: 'store-1', name: 'Store User', email: 'store@retail.local', role: 'STORE_USER', companyId: 'default-company');
  controller.api.token = 'jwt';
  controller
    ..locations = const [LocationRecord(id: 'loc-1', name: 'Main Store', type: 'store'), LocationRecord(id: 'wh-1', name: 'Warehouse', type: 'warehouse')]
    ..selectedLocationId = 'loc-1'
    ..dashboard = const DashboardSummary(pendingCounts: 2, transferRequests: 1, expiredTillDate: 0, nearExpiryThisMonth: 1, nearExpiryNextMonth: 0, countCompletionPercent: 80, transferSlaPercent: 90, stockAccuracyPercent: 95)
    ..items = const [
      CatalogItem(id: 'item-1', code: 'SKU-1001', name: 'Rice 5kg', unit: 'ea', lots: [LotRecord(id: 'lot-1', lotNo: 'LOT-01'), LotRecord(id: 'lot-2', lotNo: 'LOT-02')]),
      CatalogItem(id: 'item-2', code: 'SKU-1002', name: 'Dal 1kg', unit: 'ea', lots: [LotRecord(id: 'lot-3', lotNo: 'LOT-03')]),
    ]
    ..stock = const [
      StockRow(itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1', physicalQuantity: 28),
      StockRow(itemId: 'item-1', lotId: 'lot-2', locationId: 'loc-1', physicalQuantity: 4),
      StockRow(itemId: 'item-2', lotId: 'lot-3', locationId: 'loc-1', physicalQuantity: 9),
    ]
    ..transfers = const [
      TransferRecord(
        id: 'transfer-1', sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', status: 'IN_TRANSIT', cartonCount: 2,
        lines: [TransferLine(itemId: 'item-1', lotId: 'lot-1', quantity: 12), TransferLine(itemId: 'item-2', lotId: 'lot-3', quantity: 6)],
        createdAt: '2026-10-07T09:00:00.000Z',
      ),
    ]
    ..assignments = const [CountAssignment(id: 'as-1', itemId: 'item-1', locationId: 'loc-1', itemName: 'Rice 5kg', itemCode: 'SKU-1001', status: 'ASSIGNED')]
    ..countTasks = const [
      CountTask(assignmentId: 'as-1', locationId: 'loc-1', item: CatalogItem(id: 'item-1', code: 'SKU-1001', name: 'Rice 5kg', lots: [LotRecord(id: 'lot-1', lotNo: 'LOT-01')]), lots: [LotRecord(id: 'lot-1', lotNo: 'LOT-01')]),
    ];
  return controller;
}

/// Everything visible must sit on a Material surface: text drawn with no ancestor Material is the
/// black-screen-with-yellow-underlines symptom.
void _expectOnMaterial(WidgetTester tester, String text) {
  final finder = find.textContaining(text);
  expect(finder, findsWidgets, reason: 'expected to see "$text"');
  final element = finder.first.evaluate().first;
  expect(Material.maybeOf(element), isNotNull, reason: '"$text" is drawn outside a Material surface');
}

void main() {
  testWidgets('Store floor: every item that can be opened opens cleanly', (tester) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    final controller = _storeController();
    await tester.pumpWidget(InvexaRetailApp(controller: controller));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'the shell itself must build');
    expect(find.text('Work'), findsWidgets);


    // Work > Receive > open a transfer.
    await tester.tap(find.text('Work').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Receive').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.textContaining('Warehouse').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'opening a transfer must not throw');
    _expectOnMaterial(tester, 'Transfer transfer-1');
    expect(find.byType(Scaffold), findsWidgets);
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Work > Count > the assigned item.
    await tester.tap(find.text('Count').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final rice = find.textContaining('Rice 5kg');
    if (rice.evaluate().isNotEmpty) {
      await tester.tap(rice.first);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'opening a count task must not throw');
    }

    // Stock > an item opens its detail sheet.
    await tester.tap(find.text('Stock').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'the Stock tab must lay out without overflow');
    await tester.tap(find.text('Rice 5kg').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'opening a stock item must not throw');
    _expectOnMaterial(tester, 'LOT-01');

    await tester.tapAt(const Offset(10, 10)); // dismiss the stock detail sheet
    await tester.pumpAndSettle();

    // Home > each tile pushes a full-screen page; it must have a Scaffold, a title and a way back.
    await tester.tap(find.text('Home').first);
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
    for (final tile in ['Transfers in scope', 'Transfer requests']) {
      final finder = find.text(tile);
      expect(finder, findsWidgets, reason: 'Home should offer "$tile" - saw: ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).whereType<String>().join(' | ')}');
      await tester.ensureVisible(finder.first);
      await tester.tap(find.ancestor(of: finder.first, matching: find.byType(InkWell)).first);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      expect(tester.takeException(), isNull, reason: '$tile must open cleanly');
      _expectOnMaterial(tester, 'Transfers stay on the pick'); // pushed bare, this text has no Material and renders on black
      expect(find.byType(AppBar), findsWidgets);
      await tester.pageBack();
      await tester.pump(const Duration(seconds: 1));
    }
  });
}
