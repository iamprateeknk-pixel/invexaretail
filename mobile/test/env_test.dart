import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/config/env.dart';

void main() {
  test('empty dart-define uses the production Render API', () {
    expect(resolveApiBase(), productionApiBase);
    expect(resolveApiBase(fromDefine: ''), productionApiBase);
    expect(resolveApiBase(fromDefine: '   '), productionApiBase);
  });

  test('INVEXA_API_BASE overrides production and strips trailing slashes', () {
    expect(
      resolveApiBase(fromDefine: 'http://127.0.0.1:4000/'),
      'http://127.0.0.1:4000',
    );
  });
}
