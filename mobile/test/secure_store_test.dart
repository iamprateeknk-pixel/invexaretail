import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/secure_store.dart';

void main() {
  test('session tokens live only in the secure vault', () async {
    final delegate = MemoryStore();
    final vault = MemorySessionVault();
    final store = SecureLocalStore(delegate, vault);
    const session = PersistedSession(token: 'access-secret', refreshToken: 'refresh-secret', user: AuthUser(id: 'u1', email: 'user@example.com', name: 'User', role: 'ADMIN'));
    await store.saveSession(session);
    expect(delegate.session, isNull);
    expect(vault.value, contains('refresh-secret'));
    expect((await store.loadSession())?.refreshToken, 'refresh-secret');
    await store.clearSession();
    expect(await store.loadSession(), isNull);
  });

  test('legacy plaintext session is migrated then erased', () async {
    final delegate = MemoryStore();
    const legacy = PersistedSession(token: 'legacy-access', refreshToken: 'legacy-refresh', user: AuthUser(id: 'u2', email: 'legacy@example.com', name: 'Legacy', role: 'STORE_USER'));
    await delegate.saveSession(legacy);
    final vault = MemorySessionVault();
    final store = SecureLocalStore(delegate, vault);
    expect((await store.loadSession())?.token, 'legacy-access');
    expect(delegate.session, isNull);
    expect(vault.value, contains('legacy-refresh'));
  });
}
