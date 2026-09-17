import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Company-scoped sealed queue for offline mutations. The envelope is bound to
/// [companyId]; a grocery key cannot open a Jaipur payload.
class SyncVault {
  SyncVault({required this.companyId, required this.secret});

  final String companyId;
  final String secret;

  String seal(Map<String, Object?> payload) {
    final iv = List<int>.generate(16, (_) => Random.secure().nextInt(256));
    final body = utf8.encode(jsonEncode({'companyId': companyId, ...payload}));
    final key = _streamKey(iv, body.length);
    final cipher = Uint8List(body.length);
    for (var i = 0; i < body.length; i++) {
      cipher[i] = body[i] ^ key[i];
    }
    final mac = Hmac(sha256, utf8.encode(secret))
        .convert([...utf8.encode(companyId), ...iv, ...cipher])
        .bytes;
    return jsonEncode({
      'v': 1,
      'companyId': companyId,
      'iv': base64Encode(iv),
      'data': base64Encode(cipher),
      'mac': base64Encode(mac),
    });
  }

  Map<String, Object?> open(String sealed) {
    final envelope = jsonDecode(sealed) as Map<String, dynamic>;
    if (envelope['companyId'] != companyId) {
      throw StateError('SYNC_VAULT_COMPANY_MISMATCH');
    }
    final iv = base64Decode(envelope['iv'] as String);
    final cipher = base64Decode(envelope['data'] as String);
    final mac = base64Decode(envelope['mac'] as String);
    final expected = Hmac(sha256, utf8.encode(secret))
        .convert([...utf8.encode(companyId), ...iv, ...cipher])
        .bytes;
    if (!_constantEquals(mac, expected)) {
      throw StateError('SYNC_VAULT_MAC_INVALID');
    }
    final key = _streamKey(iv, cipher.length);
    final plain = Uint8List(cipher.length);
    for (var i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i] ^ key[i];
    }
    final decoded = jsonDecode(utf8.decode(plain)) as Map<String, dynamic>;
    return decoded.cast<String, Object?>();
  }

  Uint8List _streamKey(List<int> iv, int length) {
    final out = Uint8List(length);
    var filled = 0;
    var counter = 0;
    while (filled < length) {
      final block = Hmac(sha256, utf8.encode(secret))
          .convert([...utf8.encode('enc|$companyId|$counter'), ...iv])
          .bytes;
      counter += 1;
      for (final byte in block) {
        if (filled >= length) break;
        out[filled++] = byte;
      }
    }
    return out;
  }

  bool _constantEquals(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}
