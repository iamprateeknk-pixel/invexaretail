// Release checklist (Android): "No second login for a capability shown inside the signed-in app."
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';

void main() {
  test('webHandoffCode asks the API (authenticated) for a one-time code and returns only the code', () async {
    late http.Request seen;
    final api = InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode({'success': true, 'code': 'abcDEF0123456789_-abcDEF0123456789_-xyz', 'expiresInSeconds': 60}), 201, headers: {'content-type': 'application/json'});
      }),
    )..token = 'jwt-access';
    final code = await api.webHandoffCode();
    expect(code, 'abcDEF0123456789_-abcDEF0123456789_-xyz');
    expect(seen.method, 'POST');
    expect(seen.url.path, '/api/v1/auth/web-handoff');
    expect(seen.headers['Authorization'], 'Bearer jwt-access');
  });

  test('a response without a code is an error, so the screen falls back to the plain workspace', () async {
    final api = InvexaApi(
      baseUrl: 'http://api.test',
      httpClient: MockClient((request) async => http.Response(jsonEncode({'success': true}), 201, headers: {'content-type': 'application/json'})),
    )..token = 'jwt-access';
    await expectLater(api.webHandoffCode(), throwsA(isA<ApiException>()));
  });

  test('the handoff URL keeps the code in the fragment, never in the query string', () {
    final target = Uri.parse('https://invexaretail.com/').replace(fragment: '/handoff?code=${Uri.encodeQueryComponent('abc_-123')}');
    expect(target.toString(), 'https://invexaretail.com/#/handoff?code=abc_-123');
    expect(target.query, isEmpty);
    expect(target.hasQuery, isFalse);
  });
}
