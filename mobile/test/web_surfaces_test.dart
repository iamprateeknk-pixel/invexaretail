// Windows app: the web workspace and the Control Panel open inside the app, with the web app's
// own role rules, and never with someone else's session on a shared PC.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/config/role_home.dart';
import 'package:invexaretail_mobile/config/web_surfaces.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/desktop_web_screen.dart';
import 'package:invexaretail_mobile/screens/home_shell.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

SessionController _controllerFor(String role) => SessionController(
      api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((_) async => http.Response('nope', 500))),
      store: MemoryStore(),
    )
      ..restoring = false
      ..user = AuthUser(id: 'u1', name: 'User', email: 'u@retail.local', role: role)
      ..api.token = 'jwt';

void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('only ADMIN sees the Control Panel - the same rule as the web app\'s adminOnly sections', () {
    expect(canOpenControlPanel('ADMIN'), isTrue);
    for (final role in ['ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR', '']) {
      expect(canOpenControlPanel(role), isFalse, reason: role);
    }
  });

  test('only https pages on the listed hosts load inside the app', () {
    expect(isTrustedWebUri(Uri.parse('https://invexaretail.com/#/stock'), workspaceHosts), isTrue);
    expect(isTrustedWebUri(Uri.parse('https://INVEXARETAIL.com/'), workspaceHosts), isTrue);
    expect(isTrustedWebUri(Uri.parse('http://invexaretail.com/'), workspaceHosts), isFalse, reason: 'plain http');
    expect(isTrustedWebUri(Uri.parse('https://invexaretail.com.evil.test/'), workspaceHosts), isFalse);
    expect(isTrustedWebUri(Uri.parse('https://admin.invexaretail.com/'), workspaceHosts), isFalse,
        reason: 'the workspace view does not open the Control Panel');
    expect(isTrustedWebUri(Uri.parse('https://admin.invexaretail.com/'), controlPanelHosts), isTrue);
    expect(isTrustedWebUri(Uri.parse('https://invexaretail.com/#/control?code=x'), controlPanelHosts), isTrue,
        reason: 'the Control Panel hands the locked company off to the web app');
    expect(isTrustedWebUri(null, workspaceHosts), isFalse);
  });

  test('the embedded workspace opens signed in as the app user, and not at all without a sign-in code', () async {
    final signedIn = await signedInWorkspaceUri(() async => 'one-time-code_123456789');
    expect(signedIn.toString(), 'https://invexaretail.com/#/handoff?code=one-time-code_123456789');

    expect(await signedInWorkspaceUri(() async => throw ApiException('offline')), isNull,
        reason: 'falling back to the plain workspace would reuse whatever session the PC last held');
    expect(await signedInWorkspaceUri(() async => '  '), isNull);
  });

  test('the clean-start script clears both web storages and cannot throw into the page', () {
    expect(clearWebStorageScript, contains('localStorage.clear()'));
    expect(clearWebStorageScript, contains('sessionStorage.clear()'));
    expect(clearWebStorageScript, startsWith('try'));
  });

  test('Windows menu: ADMIN lands on the workspace and also gets the Control Panel', () {
    final admin = desktopHomeForRole('ADMIN');
    final ids = admin.destinations.map((d) => d.id).toList();
    expect(ids.first, 'workspace');
    expect(ids.last, 'control');
    expect(admin.defaultDestination, 'workspace');
    for (final native in mobileHomeForRole('ADMIN').destinations) {
      expect(ids, contains(native.id), reason: 'the native ${native.id} screen stays in the menu');
    }
  });

  test('Windows menu: other roles keep their own landing screen, gain the workspace, never the Control Panel', () {
    for (final role in ['ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR']) {
      final desktop = desktopHomeForRole(role);
      final ids = desktop.destinations.map((d) => d.id).toList();
      expect(desktop.defaultDestination, mobileHomeForRole(role).defaultDestination, reason: role);
      expect(ids, contains('workspace'), reason: role);
      expect(ids, isNot(contains('control')), reason: role);
    }
  });

  test('cookies are cleared once per signed-in person, so opening a second tab keeps the first signed in', () {
    DesktopWebView.resetForTest();
    expect(DesktopWebView.claimCookieReset('co-a|alice'), isTrue, reason: 'first view for Alice clears the previous person');
    expect(DesktopWebView.claimCookieReset('co-a|alice'), isFalse, reason: 'her second tab must not sign the first out');
    expect(DesktopWebView.claimCookieReset('co-a|bob'), isTrue, reason: 'a different person clears again');
    expect(DesktopWebView.claimCookieReset('co-a|alice'), isTrue);
    DesktopWebView.resetForTest();
  });

  Future<void> pumpShell(WidgetTester tester, String role) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 800);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: _controllerFor(role))));
    await tester.pump();
  }

  Finder railLabel(String text) => find.descendant(of: find.byType(NavigationRail), matching: find.text(text));

  testWidgets('Windows: ADMIN gets Workspace and Control panel in the side menu, opened on the workspace', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    await pumpShell(tester, 'ADMIN');
    expect(railLabel('Workspace'), findsOneWidget);
    expect(railLabel('Control panel'), findsOneWidget);
    expect(find.byType(DesktopWebView), findsOneWidget, reason: 'the workspace tab is the landing screen');
    expect(find.byKey(const ValueKey('open-workspace')), findsNothing, reason: 'no separate toolbar door on Windows');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('Windows: other roles get the Workspace tab but no Control panel, and land on their own screen', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    for (final role in ['ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR']) {
      await pumpShell(tester, role);
      expect(railLabel('Workspace'), findsOneWidget, reason: role);
      expect(railLabel('Control panel'), findsNothing, reason: role);
      expect(find.byType(DesktopWebView), findsNothing, reason: '$role does not open on the web view');
    }
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('phones are unchanged: workspace button in the toolbar, no web tabs, no Control Panel', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await pumpShell(tester, 'ADMIN');
    expect(find.byKey(const ValueKey('open-workspace')), findsOneWidget);
    expect(find.text('Control panel'), findsNothing);
    expect(find.byType(DesktopWebView), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });
}
