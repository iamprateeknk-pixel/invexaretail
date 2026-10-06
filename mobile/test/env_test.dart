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

  test('only a development build may use a local http endpoint', () {
    expect(apiBaseProblem('http://10.0.2.2:4000', InvexaEnvironment.development), isNull);
    expect(apiBaseProblem('http://10.0.2.2:4000', InvexaEnvironment.production), isNotNull);
  });

  test('the environment name parses safely: anything unknown is production', () {
    expect(parseEnvironment('staging'), InvexaEnvironment.staging);
    expect(parseEnvironment('DEV'), InvexaEnvironment.development);
    expect(parseEnvironment(' development '), InvexaEnvironment.development);
    expect(parseEnvironment(''), InvexaEnvironment.production);
    expect(parseEnvironment('prod-ish'), InvexaEnvironment.production);
  });
}
