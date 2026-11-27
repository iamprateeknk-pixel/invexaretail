// Windows build: no camera scanner or embedded web view exists there, so the app must
// route scanning to a keyboard-wedge field and lay out for a wide window.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/config/platform_caps.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/home_shell.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';
import 'package:invexaretail_mobile/widgets/barcode_scan_sheet.dart';

SessionController _adminController() => SessionController(
      api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((_) async => http.Response('nope', 500))),
      store: MemoryStore(),
    )
      ..restoring = false
      ..user = const AuthUser(id: 'u1', name: 'Admin', email: 'a@retail.local', role: 'ADMIN')
      ..api.token = 'jwt';

void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('phones get the camera scanner and embedded workspace; Windows gets neither', () {
    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      debugDefaultTargetPlatformOverride = platform;
      expect(PlatformCaps.hasCameraScanner, isTrue, reason: '$platform');
      expect(PlatformCaps.hasEmbeddedWebView, isTrue, reason: '$platform');
      expect(PlatformCaps.isDesktop, isFalse, reason: '$platform');
    }
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    expect(PlatformCaps.hasCameraScanner, isFalse);
    expect(PlatformCaps.hasEmbeddedWebView, isFalse);
    expect(PlatformCaps.isDesktop, isTrue);
  });

  testWidgets('on Windows a scan opens a focused field; a USB scanner\'s code + Enter is returned', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    String? scanned;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () async => scanned = await showBarcodeScanner(context, title: 'Scan item'),
          child: const Text('scan'),
        ),
      ),
    ));
    await tester.tap(find.text('scan'));
    await tester.pumpAndSettle();

    expect(find.byType(KeyboardScanScreen), findsOneWidget);
    final field = find.byKey(const ValueKey('keyboard-scan-field'));
    expect(tester.widget<TextField>(field).autofocus, isTrue, reason: 'the first scan must land without a click');

    await tester.enterText(field, '  8901234567890  ');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(scanned, '8901234567890');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('a wide window uses a side rail; a phone keeps the bottom bar', (tester) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    tester.view.physicalSize = const Size(1280, 800);
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: _adminController())));
    await tester.pump();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    await tester.tap(find.text('Stock'));
    await tester.pump();
    expect(tester.widget<NavigationRail>(find.byType(NavigationRail)).selectedIndex, isNot(0));

    tester.view.physicalSize = const Size(400, 800);
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: _adminController())));
    await tester.pump();
    expect(find.byType(NavigationRail), findsNothing);
    expect(find.byType(NavigationBar), findsOneWidget);
  });
}
