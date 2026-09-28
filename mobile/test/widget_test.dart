import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/app.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/dashboard_screen.dart';
import 'package:invexaretail_mobile/screens/home_shell.dart';
import 'package:invexaretail_mobile/screens/login_screen.dart';
import 'package:invexaretail_mobile/screens/stock_screen.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

SessionController _controller({AuthUser? user}) {
  final controller = SessionController(
    api: InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async => http.Response('nope', 500)),
    ),
    store: MemoryStore(),
  )..restoring = false;
  if (user != null) {
    controller
      ..user = user
      ..api.token = 'jwt';
  }
  return controller;
}

void main() {
  testWidgets('login screen requires email and password', (tester) async {
    final controller = _controller();
    await tester.pumpWidget(MaterialApp(home: LoginScreen(controller: controller)));
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Enter your work email and password.'), findsOneWidget);
  });

  testWidgets('one-time code sign-in requires an email before sending', (tester) async {
    final controller = _controller();
    await tester.pumpWidget(MaterialApp(home: LoginScreen(controller: controller)));
    await tester.tap(find.text('One-time code'));
    await tester.pump();
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.text('Enter your work email to receive a code.'), findsOneWidget);
  });

  testWidgets('dashboard shows server KPI labels, not Total Items', (tester) async {
    final controller = _controller(
      user: const AuthUser(id: 'u1', name: 'Admin User', email: 'admin@retail.local', role: 'ADMIN'),
    )
      ..dashboard = const DashboardSummary(
        pendingCounts: 2,
        transferRequests: 1,
        expiredTillDate: 1,
        nearExpiryThisMonth: 1,
        nearExpiryNextMonth: 0,
        countCompletionPercent: 50,
        transferSlaPercent: 0,
        stockAccuracyPercent: 100,
      );

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: DashboardScreen(controller: controller))));
    expect(find.text('Pending counts'), findsOneWidget);
    expect(find.text('Transfer requests'), findsOneWidget);
    expect(find.text('Expired lots'), findsOneWidget);
    expect(find.text('Total Items'), findsNothing);
    expect(find.text('Hello, Admin User'), findsOneWidget);
  });

  testWidgets('stock list joins item names and hides book qty for store users', (tester) async {
    final controller = _controller(
      user: const AuthUser(id: 'u2', name: 'Store User', email: 'store@retail.local', role: 'STORE_USER'),
    )
      ..items = [
        const CatalogItem(id: 'item-1001', code: 'SKU-1001', name: 'Rice 5kg', lots: [LotRecord(id: 'lot-1001', lotNo: 'LOT-01')]),
      ]
      ..locations = const [LocationRecord(id: 'loc-1', name: 'Main Store', type: 'store')]
      ..selectedLocationId = 'loc-1'
      ..stock = const [
        StockRow(itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', physicalQuantity: 28),
      ];

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: StockScreen(controller: controller))));
    expect(find.text('Rice 5kg'), findsOneWidget);
    expect(find.textContaining('1 lot'), findsOneWidget);
    expect(find.textContaining('Book'), findsNothing);

    await tester.tap(find.text('Rice 5kg'));
    await tester.pumpAndSettle();
    expect(find.textContaining('LOT-01'), findsOneWidget);
    expect(find.textContaining('Book'), findsNothing);
  });

  testWidgets('signed-out app starts on the login screen', (tester) async {
    final controller = _controller();
    await tester.pumpWidget(InvexaRetailApp(controller: controller));
    expect(find.text('Invexa Retail'), findsWidgets);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('warehouse pickers see pick/putaway/scan plus their own warehouse stock counts, but not transfers', (tester) async {
    final controller = _controller(
      user: const AuthUser(id: 'u3', name: 'Picker', email: 'picker@retail.local', role: 'WAREHOUSE_PICKER'),
    );
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: controller)));
    expect(find.text('Pick'), findsWidgets);
    expect(find.text('Putaway'), findsWidgets);
    expect(find.text('Scan'), findsWidgets);
    expect(find.text('Count'), findsWidgets, reason: 'pickers are assigned warehouse stock counts too (audit: mobile app gap)');
    expect(find.text('Transfers'), findsNothing);
  });

  testWidgets('store users see count and receive, not warehouse picking', (tester) async {
    final controller = _controller(
      user: const AuthUser(id: 'u4', name: 'Store', email: 'store@retail.local', role: 'STORE_USER'),
    );
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: controller)));
    expect(find.text('Count'), findsWidgets);
    expect(find.text('Receive'), findsWidgets);
    expect(find.text('Pick'), findsNothing);
  });
}
