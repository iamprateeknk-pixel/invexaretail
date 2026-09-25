import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/sync_engine.dart';

void main() {
  test('offline stock mutations are idempotent and never last-write-wins', () {
    final engine = SyncEngine();
    engine.seedStock('default-company', 'item-1', 10);

    final first = engine.enqueue(const SyncMutation(
      mutationId: 'mut-1',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'delta': -2},
    ));
    final retry = engine.enqueue(const SyncMutation(
      mutationId: 'mut-1',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'delta': -2},
    ));
    engine.enqueue(const SyncMutation(
      mutationId: 'mut-2',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'delta': -3},
    ));

    expect(first.status, SyncStatus.synced);
    expect(retry.result, first.result);
    expect(engine.onHand('default-company', 'item-1'), 5);

    final overwrite = engine.enqueue(const SyncMutation(
      mutationId: 'mut-3',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'quantity': 8},
    ));
    expect(overwrite.status, SyncStatus.rejected);
    expect(engine.allowsOfflineCompanySwitch(), isFalse);
    expect(engine.requiresOnlineLogin(), isTrue);
  });
}
