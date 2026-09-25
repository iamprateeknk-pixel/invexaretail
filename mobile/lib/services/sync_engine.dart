class SyncEngine {
  SyncEngine({this.minimumAppVersion = '2.0.0'});

  final String minimumAppVersion;
  final Map<String, SyncMutation> _queue = {};
  final Map<String, int> _ledger = {};

  int onHand(String companyId, String itemId) =>
      _ledger[_key(companyId, itemId)] ?? 0;

  void seedStock(String companyId, String itemId, int quantity) {
    _ledger[_key(companyId, itemId)] = quantity;
  }

  SyncMutation enqueue(SyncMutation mutation) {
    final existing = _queue[mutation.mutationId];
    if (existing != null) return existing;
    final processed = _apply(mutation);
    _queue[processed.mutationId] = processed;
    return processed;
  }

  bool allowsOfflineCompanySwitch() => false;

  bool requiresOnlineLogin() => true;

  bool supportsAppVersion(String version) =>
      version.compareTo(minimumAppVersion) >= 0;

  SyncMutation _apply(SyncMutation mutation) {
    if (mutation.payload['permissionRevoked'] == true) {
      return mutation.copyWith(
        status: SyncStatus.rejected,
        lastError: 'Permission revoked while offline',
      );
    }
    if (mutation.actionType == 'STOCK_ADJUST') {
      final quantity = mutation.payload['quantity'];
      final delta = mutation.payload['delta'];
      if (quantity != null && delta == null) {
        return mutation.copyWith(
          status: SyncStatus.rejected,
          lastError: 'NEVER_LAST_WRITE_WINS_STOCK',
        );
      }
      if (delta is! num) {
        return mutation.copyWith(
          status: SyncStatus.rejected,
          lastError: 'Stock mutations must submit a movement delta',
        );
      }
      final itemId = '${mutation.payload['itemId'] ?? 'item-1'}';
      final key = _key(mutation.companyId, itemId);
      _ledger[key] = onHand(mutation.companyId, itemId) + delta.toInt();
      return mutation.copyWith(
        status: SyncStatus.synced,
        result: {'itemId': itemId, 'onHand': _ledger[key]},
      );
    }
    return mutation.copyWith(status: SyncStatus.synced, result: {'ok': true});
  }

  String _key(String companyId, String itemId) => '$companyId:$itemId';
}

enum SyncStatus { pending, synced, rejected, conflict }

class SyncMutation {
  const SyncMutation({
    required this.mutationId,
    required this.companyId,
    required this.actionType,
    required this.payload,
    this.status = SyncStatus.pending,
    this.lastError,
    this.result,
  });

  final String mutationId;
  final String companyId;
  final String actionType;
  final Map<String, Object?> payload;
  final SyncStatus status;
  final String? lastError;
  final Map<String, Object?>? result;

  SyncMutation copyWith({
    SyncStatus? status,
    String? lastError,
    Map<String, Object?>? result,
  }) {
    return SyncMutation(
      mutationId: mutationId,
      companyId: companyId,
      actionType: actionType,
      payload: payload,
      status: status ?? this.status,
      lastError: lastError ?? this.lastError,
      result: result ?? this.result,
    );
  }
}
