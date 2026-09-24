import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/models.dart';
import 'local_store.dart';

const secureSessionKey = 'invexa.secure.session.v1';

abstract class SessionVault {
  Future<void> write(String value);
  Future<String?> read();
  Future<void> clear();
}

class PlatformSessionVault implements SessionVault {
  PlatformSessionVault([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
        );
  final FlutterSecureStorage _storage;
  @override
  Future<void> write(String value) => _storage.write(key: secureSessionKey, value: value);
  @override
  Future<String?> read() => _storage.read(key: secureSessionKey);
  @override
  Future<void> clear() => _storage.delete(key: secureSessionKey);
}

class MemorySessionVault implements SessionVault {
  String? value;
  @override
  Future<void> write(String next) async => value = next;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> clear() async => value = null;
}

class SecureLocalStore implements LocalStore {
  SecureLocalStore(this.delegate, this.vault);
  final LocalStore delegate;
  final SessionVault vault;

  @override
  Future<void> saveSession(PersistedSession session) async {
    await vault.write(jsonEncode({'token': session.token, 'refreshToken': session.refreshToken, 'user': session.user.toJson()}));
    await delegate.clearSession();
  }

  @override
  Future<PersistedSession?> loadSession() async {
    final secure = await vault.read();
    if (secure != null && secure.isNotEmpty) return _decode(secure);
    final legacy = await delegate.loadSession();
    if (legacy == null) return null;
    await saveSession(legacy);
    return legacy;
  }

  PersistedSession? _decode(String raw) {
    try {
      final value = asMap(jsonDecode(raw));
      final token = asString(value['token']);
      if (token.isEmpty) return null;
      final refresh = value['refreshToken']?.toString();
      return PersistedSession(token: token, refreshToken: refresh == null || refresh.isEmpty ? null : refresh, user: AuthUser.fromJson(asMap(value['user'])));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> clearSession() async { await vault.clear(); await delegate.clearSession(); }
  @override
  Future<List<QueuedCount>> loadQueuedCounts([String companyId = 'default-company']) => delegate.loadQueuedCounts(companyId);
  @override
  Future<void> saveQueuedCounts(List<QueuedCount> items, [String companyId = 'default-company']) => delegate.saveQueuedCounts(items, companyId);
  @override
  Future<List<String>> loadSealedQueue(String companyId) => delegate.loadSealedQueue(companyId);
  @override
  Future<void> saveSealedQueue(String companyId, List<String> envelopes) => delegate.saveSealedQueue(companyId, envelopes);
  @override
  Future<void> clearSealedQueue(String companyId) => delegate.clearSealedQueue(companyId);
  @override
  Future<List<QueuedAction>> loadQueuedActions() => delegate.loadQueuedActions();
  @override
  Future<void> saveQueuedActions(List<QueuedAction> items) => delegate.saveQueuedActions(items);
}
