import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:pointycastle/export.dart';

/// Company-scoped sealed queue for offline mutations, encrypted with
/// AES-256-GCM (PointyCastle, a maintained pure-Dart AEAD implementation)
/// instead of a hand-rolled stream cipher. The envelope is bound to
/// [companyId] as additional authenticated data: a grocery key cannot open a
/// Jaipur payload, and any tampering with the ciphertext or the companyId is
/// rejected by the GCM authentication tag.
class SyncVault {
  SyncVault({required this.companyId, required this.secret});

  final String companyId;
  final String secret;

  static const int _keyLengthBytes = 32; // AES-256
  static const int _nonceLengthBytes = 12; // Standard GCM nonce size
  static const int _macLengthBits = 128;

  String seal(Map<String, Object?> payload) {
    final nonce = _randomBytes(_nonceLengthBytes);
    final plaintext = Uint8List.fromList(utf8.encode(jsonEncode(payload)));
    final aad = Uint8List.fromList(utf8.encode(companyId));
    final ciphertextWithTag = _gcm(forEncryption: true, nonce: nonce, aad: aad).process(plaintext);
    return jsonEncode({
      'v': 2,
      'companyId': companyId,
      'nonce': base64Encode(nonce),
      'data': base64Encode(ciphertextWithTag),
    });
  }

  Map<String, Object?> open(String sealed) {
    final envelope = jsonDecode(sealed) as Map<String, dynamic>;
    if (envelope['companyId'] != companyId) {
      throw StateError('SYNC_VAULT_COMPANY_MISMATCH');
    }
    final nonce = base64Decode(envelope['nonce'] as String);
    final ciphertextWithTag = base64Decode(envelope['data'] as String);
    final aad = Uint8List.fromList(utf8.encode(companyId));
    final Uint8List plaintext;
    try {
      plaintext = _gcm(forEncryption: false, nonce: nonce, aad: aad).process(ciphertextWithTag);
    } on InvalidCipherTextException {
      throw StateError('SYNC_VAULT_MAC_INVALID');
    }
    final decoded = jsonDecode(utf8.decode(plaintext)) as Map<String, dynamic>;
    return decoded.cast<String, Object?>();
  }

  GCMBlockCipher _gcm({required bool forEncryption, required Uint8List nonce, required Uint8List aad}) {
    return GCMBlockCipher(AESEngine())
      ..init(forEncryption, AEADParameters(KeyParameter(_deriveKey()), _macLengthBits, nonce, aad));
  }

  /// Standard SHA-256 key derivation from the shared secret and companyId.
  /// This is not the cipher itself - AES-GCM above provides the actual
  /// confidentiality and integrity guarantee; this only turns an arbitrary
  /// secret string into a fixed-length AES-256 key.
  Uint8List _deriveKey() {
    final digest = sha256.convert(utf8.encode('invexa-sync-vault-v2|$companyId|$secret'));
    return Uint8List.fromList(digest.bytes.sublist(0, _keyLengthBytes));
  }

  Uint8List _randomBytes(int length) {
    final random = Random.secure();
    return Uint8List.fromList(List<int>.generate(length, (_) => random.nextInt(256)));
  }
}
