import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';

http.Response _json(Map<String, dynamic> body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

const _session = {
  'success': true,
  'token': 'jwt-token',
  'refreshToken': 'refresh',
  'user': {'id': 'u1', 'name': 'Admin', 'email': 'admin@retail.local', 'role': 'ADMIN', 'branchIds': <String>[]},
};

void main() {
  test('password login surfaces a two-factor challenge instead of failing', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async => _json({'twoFactorRequired': true, 'challengeToken': 'chal-1'})),
    );
    await expectLater(
      api.login('admin@retail.local', 'x'),
      throwsA(isA<TwoFactorRequiredException>().having((e) => e.challengeToken, 'challengeToken', 'chal-1')),
    );
    expect(api.token, isNull, reason: 'no session until the second factor passes');
  });

  test('one-time-code login surfaces the same challenge', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async => _json({'twoFactorRequired': true, 'challengeToken': 'chal-2'})),
    );
    await expectLater(api.loginWithOtp('admin@retail.local', '123456'), throwsA(isA<TwoFactorRequiredException>()));
  });

  test('verifyTwoFactor posts the challenge and a normalised code, then stores the session', () async {
    late http.Request captured;
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async {
        captured = request;
        return _json(_session);
      }),
    );
    final result = await api.verifyTwoFactor('chal-1', ' abcde-23456 ');
    expect(captured.url.path, '/api/v1/auth/2fa/verify-login');
    expect(jsonDecode(captured.body), {'challengeToken': 'chal-1', 'code': 'ABCDE-23456'});
    expect(result.user.role, 'ADMIN');
    expect(api.token, 'jwt-token');
  });

  test('a wrong code is an ApiException with the server message, not a challenge', () async {
    final api = InvexaApi(
      baseUrl: 'http://127.0.0.1:4000',
      httpClient: MockClient((request) async => _json({'error': 'Invalid code'}, 401)),
    );
    await expectLater(api.verifyTwoFactor('chal-1', '000000'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Invalid code')));
  });
}
