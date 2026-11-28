class OfflinePermit {
  const OfflinePermit(this.token, this.expiresAt);

  final String token;
  final DateTime expiresAt;

  String? get currentToken => DateTime.now().isBefore(expiresAt) ? token : null;

  static OfflinePermit? fromJson(Object? value) {
    if (value is! Map) return null;
    final token = value['token'];
    final expiry = value['expiresAt'];
    final expiresAt = expiry is String ? DateTime.tryParse(expiry) : null;
    if (token is! String || token.isEmpty || expiresAt == null) return null;
    return OfflinePermit(token, expiresAt);
  }
}

class MobileOfflinePolicy {
  MobileOfflinePolicy(this.maxAge, this.scopes);

  final Duration maxAge;
  final Set<String> scopes;
  static const supportedScopes = {
    'stock',
    'counts',
    'picks',
    'putaway',
    'transfers',
    'receiving',
    'dashboard',
  };

  factory MobileOfflinePolicy.fromJson(Map<String, dynamic> policy) {
    final hours = policy['offlineMaxHours'];
    final scope = policy['syncScope'];
    return MobileOfflinePolicy(
      hours is num && hours.isFinite && hours > 0
          ? Duration(seconds: (hours.clamp(0, 8760) * 3600).floor())
          : Duration.zero,
      scope is List
          ? scope.whereType<String>().where(supportedScopes.contains).toSet()
          : {},
    );
  }

  bool allows(String path) {
    if (maxAge == Duration.zero || scopes.isEmpty) return false;
    final uri = Uri.parse(path);
    final feed = uri.path;
    if (feed == '/api/v1/locations') return true;
    if (feed == '/api/v1/items') {
      return scopes.any(
        {'stock', 'counts', 'picks', 'transfers', 'receiving'}.contains,
      );
    }
    if (feed == '/api/v1/dashboard') return scopes.contains('dashboard');
    if (feed.startsWith('/api/v1/stock/')) return scopes.contains('stock');
    if (feed == '/api/v1/counts' || feed == '/api/v1/count-assignments/mine') {
      return scopes.contains('counts');
    }
    if (feed == '/api/v1/mobile/work') {
      return scopes.contains('counts') || scopes.contains('receiving');
    }
    if (feed == '/api/v1/putaway-tasks') return scopes.contains('putaway');
    if (feed.startsWith('/api/v1/picker/transfers/')) {
      return scopes.contains('picks');
    }
    if (feed == '/api/v1/transfers/list') {
      return scopes.any({'transfers', 'picks', 'receiving'}.contains);
    }
    if (feed.startsWith('/api/v1/transfers/by-package/')) {
      return scopes.contains('receiving');
    }
    return false;
  }

  bool isFresh(DateTime fetchedAt, DateTime now) {
    final age = now.difference(fetchedAt);
    return !age.isNegative && age < maxAge;
  }

  Map<String, dynamic> cachePayload(String path, Map<String, dynamic> payload) {
    final feed = Uri.parse(path).path;
    if (feed == '/api/v1/mobile/work') {
      return {
        if (scopes.contains('counts')) 'countTasks': payload['countTasks'],
        if (scopes.contains('receiving'))
          'receiveTasks': payload['receiveTasks'],
      };
    }
    if (feed == '/api/v1/transfers/list' && !scopes.contains('transfers')) {
      final rows = payload['transfers'];
      return {
        'transfers':
            rows is List
                ? rows
                    .whereType<Map>()
                    .where((row) {
                      final status =
                          row['status']?.toString().toUpperCase() ?? '';
                      return (scopes.contains('picks') &&
                              (status.contains('PICK') ||
                                  status == 'REQUESTED' ||
                                  status == 'PARTIAL')) ||
                          (scopes.contains('receiving') &&
                              (status.contains('TRANSIT') ||
                                  status.contains('DISPATCH') ||
                                  status.contains('PARTIAL')));
                    })
                    .toList(growable: false)
                : [],
      };
    }
    return payload;
  }
}
