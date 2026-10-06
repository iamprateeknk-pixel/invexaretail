// Plan Area H WP2: switching tabs must not throw away what the person was doing.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/home_shell.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

void main() {
  testWidgets('a visited tab keeps its state when the person switches away and back, and unvisited tabs are not built', (tester) async {
    final requested = <String>[];
    final controller = SessionController(
      api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async {
        requested.add(request.url.path);
        return http.Response('nope', 500);
      })),
      store: MemoryStore(),
    )
      ..restoring = false
      ..user = const AuthUser(id: 'u1', name: 'Admin', email: 'a@retail.local', role: 'ADMIN')
      ..api.token = 'jwt';
    await tester.pumpWidget(MaterialApp(home: HomeShell(controller: controller)));
    await tester.pump();

    expect(find.byType(IndexedStack), findsOneWidget);
    final stack = tester.widget<IndexedStack>(find.byType(IndexedStack));
    final built = stack.children.where((child) => child is! SizedBox).length;
    expect(built, 1, reason: 'only the landing tab exists until another is opened');

    await tester.tap(find.text('Stock'));
    await tester.pump();
    expect(tester.widget<IndexedStack>(find.byType(IndexedStack)).children.where((child) => child is! SizedBox).length, 2);

    await tester.tap(find.text('Home'));
    await tester.pump();
    await tester.tap(find.text('Stock'));
    await tester.pump();
    expect(tester.widget<IndexedStack>(find.byType(IndexedStack)).children.where((child) => child is! SizedBox).length, 2, reason: 'going back and forth does not rebuild or add tabs');
  });
}
