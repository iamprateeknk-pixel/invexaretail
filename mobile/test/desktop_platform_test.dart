import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/screens/workspace_screen.dart';
import 'package:invexaretail_mobile/widgets/barcode_scan_sheet.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Windows opens the trusted workspace in the default browser with the handoff fragment', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    Uri? opened;

    try {
      await tester.pumpWidget(MaterialApp(
        home: WorkspaceScreen(
          fetchHandoffCode: () async => 'one-time-code',
          externalWorkspaceLauncher: (uri) async {
            opened = uri;
            return true;
          },
        ),
      ));
      await tester.pumpAndSettle();

      expect(opened.toString(), 'https://invexaretail.com/#/handoff?code=one-time-code');
      expect(find.text('The workspace is open in your browser.'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('Windows shows a retry when the default browser cannot be opened', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    var attempts = 0;

    try {
      await tester.pumpWidget(MaterialApp(
        home: WorkspaceScreen(
          externalWorkspaceLauncher: (_) async {
            attempts += 1;
            return false;
          },
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('We could not open the workspace.'), findsOneWidget);
      await tester.tap(find.text('Open in browser'));
      await tester.pumpAndSettle();
      expect(attempts, 2);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('Windows sends the handoff to the configured staging workspace', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    Uri? opened;
    try {
      await tester.pumpWidget(MaterialApp(
        home: WorkspaceScreen(
          workspaceUri: Uri.parse('https://workspace.example.test/'),
          fetchHandoffCode: () async => 'staging-code',
          externalWorkspaceLauncher: (uri) async {
            opened = uri;
            return true;
          },
        ),
      ));
      await tester.pumpAndSettle();
      expect(opened.toString(), 'https://workspace.example.test/#/handoff?code=staging-code');
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('Windows barcode input accepts a USB scanner value without camera support', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    String? result;

    try {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(builder: (context) => FilledButton(
                onPressed: () async => result = await showBarcodeScanner(context),
                child: const Text('Open scanner'),
              )),
        ),
      ));
      await tester.tap(find.text('Open scanner'));
      await tester.pumpAndSettle();

      expect(find.text('Use a USB barcode scanner or enter the code below.'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'SKU-1001');
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(result, 'SKU-1001');
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });
}
