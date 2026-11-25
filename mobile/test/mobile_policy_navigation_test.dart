import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/config/role_home.dart';

void main() {
  test('published STORE_USER navigation maps count and receiving to its task screen', () {
    final home = mobileHomeForRole(
      'STORE_USER',
      navigation: const ['dashboard', 'stock', 'counts', 'receiving'],
    );

    expect(home.destinations.map((destination) => destination.id), ['home', 'stock', 'work']);
    expect(home.defaultDestination, 'work');
  });

  test('published picker navigation keeps supported work and ignores unknown screens', () {
    final home = mobileHomeForRole(
      'WAREHOUSE_PICKER',
      navigation: const ['putaway', 'picks', 'unsupported', 'dashboard'],
    );

    expect(home.destinations.map((destination) => destination.id), ['work', 'home']);
    expect(home.defaultDestination, 'work');
  });

  test('missing or unusable policy preserves the role home', () {
    final roleDefault = mobileHomeForRole('STORE_USER');
    expect(mobileHomeForRole('STORE_USER').destinations.map((row) => row.id), roleDefault.destinations.map((row) => row.id));
    expect(mobileHomeForRole('STORE_USER', navigation: const ['unknown']).destinations.map((row) => row.id), roleDefault.destinations.map((row) => row.id));
  });
}
