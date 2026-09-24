import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/sync_vault.dart';

// Fixes a real prohibited-pattern gap: SyncVault used to be a hand-rolled
// HMAC-keystream stream cipher (XOR against an HMAC-SHA256-derived
// keystream). AGENTS.md/the Week 16 execution guide requires reviewed
// authenticated encryption instead. SyncVault now uses AES-256-GCM via
// PointyCastle. These tests cover what the old suite never exercised:
// ciphertext tampering must be rejected by the AEAD tag, not just a
// same-secret round trip.
void main() {
  test('seal/open round-trips the payload for the owning company', () {
    final vault = SyncVault(companyId: 'default-company', secret: 'grocery-secret');
    final sealed = vault.seal({'mutationId': 'mut-1', 'delta': -2});
    final opened = vault.open(sealed);
    expect(opened['mutationId'], 'mut-1');
    expect(opened['delta'], -2);
  });

  test('two seals of the same payload use different nonces and ciphertexts', () {
    final vault = SyncVault(companyId: 'default-company', secret: 'grocery-secret');
    final first = vault.seal({'mutationId': 'mut-1'});
    final second = vault.seal({'mutationId': 'mut-1'});
    expect(first, isNot(equals(second)));
  });

  test('tampering with the ciphertext is rejected by the GCM authentication tag', () {
    final vault = SyncVault(companyId: 'default-company', secret: 'grocery-secret');
    final sealed = vault.seal({'mutationId': 'mut-1', 'delta': -2});
    final envelope = jsonDecode(sealed) as Map<String, dynamic>;
    final data = base64Decode(envelope['data'] as String);
    data[0] = data[0] ^ 0xFF; // flip a bit inside the ciphertext
    envelope['data'] = base64Encode(data);
    final tampered = jsonEncode(envelope);
    expect(() => vault.open(tampered), throwsStateError);
  });

  test('opening with the wrong secret fails even for the same company', () {
    final sealed = SyncVault(companyId: 'default-company', secret: 'grocery-secret')
        .seal({'mutationId': 'mut-1'});
    final wrongSecret = SyncVault(companyId: 'default-company', secret: 'wrong-secret');
    expect(() => wrongSecret.open(sealed), throwsStateError);
  });

  test('opening with a different companyId is rejected before decryption is attempted', () {
    final sealed = SyncVault(companyId: 'default-company', secret: 'grocery-secret')
        .seal({'mutationId': 'mut-1'});
    final otherCompany = SyncVault(companyId: 'company-jaipur', secret: 'grocery-secret');
    expect(() => otherCompany.open(sealed), throwsStateError);
  });
}
