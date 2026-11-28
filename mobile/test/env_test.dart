import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/config/env.dart';

void main() {
  test('empty dart-define uses the production Railway API', () {
    expect(resolveApiBase(), productionApiBase);
    expect(resolveApiBase(fromDefine: ''), productionApiBase);
    expect(resolveApiBase(fromDefine: '   '), productionApiBase);
  });

  test('INVEXA_API_BASE overrides production and strips trailing slashes', () {
    expect(resolveApiBase(fromDefine: 'https://staging.invexaretail.com/', environment: InvexaEnvironment.staging), 'https://staging.invexaretail.com');
    expect(resolveApiBase(fromDefine: 'http://127.0.0.1:4000/', environment: InvexaEnvironment.development), 'http://127.0.0.1:4000');
  });

  test('a production build refuses plain http and any local or private host', () {
    for (final base in [
      'http://api.invexaretail.com',
      'https://localhost:4000',
      'https://127.0.0.1',
      'https://10.0.2.2:4000',
      'https://192.168.1.20',
      'https://172.20.0.5',
      'https://dev-box.local',
      'https://intranet',
    ]) {
      expect(() => resolveApiBase(fromDefine: base), throwsA(isA<StateError>()), reason: base);
    }
  });

  test('staging also needs https and a public host, but is a distinct environment', () {
    expect(() => resolveApiBase(fromDefine: 'http://staging.example.com', environment: InvexaEnvironment.staging), throwsStateError);
    expect(resolveApiBase(fromDefine: 'https://staging.example.com', environment: InvexaEnvironment.staging), 'https://staging.example.com');
  });

  test('staging requires both endpoints and rejects known production hosts', () {
    const staging = InvexaEnvironment.staging;
    expect(() => resolveApiBase(environment: staging), throwsStateError);
    expect(() => resolveWorkspaceOrigin(environment: staging), throwsStateError);
    for (final address in [productionApiBase, workspaceOrigin, 'https://api.invexaretail.com.']) {
      expect(() => resolveApiBase(fromDefine: address, environment: staging), throwsStateError);
      expect(() => resolveWorkspaceOrigin(fromDefine: address, environment: staging), throwsStateError);
    }
    expect(resolveWorkspaceOrigin(fromDefine: 'https://workspace.example.test/', environment: staging),
        Uri.parse('https://workspace.example.test/'));
  });

  test('development defaults to local services and malformed origins are rejected', () {
    const development = InvexaEnvironment.development;
    expect(resolveApiBase(environment: development), 'http://127.0.0.1:4000');
    expect(resolveWorkspaceOrigin(environment: development), Uri.parse('http://127.0.0.1:5173/'));
    for (final address in ['https://user@api.example.test', 'https://api.example.test/path', 'https://api.example.test/?q=1']) {
      expect(() => resolveApiBase(fromDefine: address, environment: development), throwsStateError);
    }
  });

  test('only a development build may use a local http endpoint', () {
    expect(apiBaseProblem('http://10.0.2.2:4000', InvexaEnvironment.development), isNull);
    expect(apiBaseProblem('http://10.0.2.2:4000', InvexaEnvironment.production), isNotNull);
  });

  test('only supported environment names are accepted', () {
    expect(parseEnvironment('staging'), InvexaEnvironment.staging);
    expect(parseEnvironment('DEV'), InvexaEnvironment.development);
    expect(parseEnvironment(' development '), InvexaEnvironment.development);
    expect(parseEnvironment('production'), InvexaEnvironment.production);
    expect(() => parseEnvironment(''), throwsStateError);
    expect(() => parseEnvironment('prod-ish'), throwsStateError);
  });

  test('default production retains its store while other API targets have distinct stores', () {
    const production = InvexaEnvironment.production;
    const staging = InvexaEnvironment.staging;
    const first = 'https://api.example.test';
    const second = 'https://other-api.example.test';
    expect(localStorageScope(production, productionApiBase), isNull);
    final scope = localStorageScope(staging, first);
    expect(scope, matches(RegExp(r'^[a-f0-9]{64}$')));
    expect(localStorageScope(staging, first), scope);
    expect(localStorageScope(staging, second), isNot(scope));
    expect(localStorageScope(production, first), isNot(scope));
  });
}
