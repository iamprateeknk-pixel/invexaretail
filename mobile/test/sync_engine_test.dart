import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/sync_engine.dart';
import 'package:invexaretail_mobile/services/sync_vault.dart';

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

  test('sealed offline queue cannot be opened with another company key', () {
    final grocery = SyncEngine(
      vault: SyncVault(companyId: 'default-company', secret: 'grocery-secret'),
    );
    grocery.seedStock('default-company', 'item-1', 10);
    grocery.enqueue(const SyncMutation(
      mutationId: 'mut-enc-1',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'delta': -1},
    ));
    final sealed = grocery.sealedQueue().single;
    final opened = grocery.openSealed(sealed);
    expect(opened['companyId'], 'default-company');
    expect(opened['mutationId'], 'mut-enc-1');

    final jaipur = SyncEngine(
      vault: SyncVault(companyId: 'company-jaipur', secret: 'jaipur-secret'),
    );
    expect(() => jaipur.openSealed(sealed), throwsStateError);
  });

  test('sealed queue persists per company and cannot be restored across tenants', () async {
    final store = MemoryStore();
    final grocery = SyncEngine(
      vault: SyncVault(companyId: 'default-company', secret: 'grocery-secret'),
    );
    grocery.seedStock('default-company', 'item-1', 10);
    grocery.enqueue(const SyncMutation(
      mutationId: 'mut-store-1',
      companyId: 'default-company',
      actionType: 'STOCK_ADJUST',
      payload: {'itemId': 'item-1', 'delta': -1},
    ));
    await grocery.persistSealed(store);

    final jaipur = SyncEngine(
      vault: SyncVault(companyId: 'company-jaipur', secret: 'jaipur-secret'),
    );
    await jaipur.restoreSealed(store);
    expect(jaipur.sealedQueue(), isEmpty);

    final restoredGrocery = SyncEngine(
      vault: SyncVault(companyId: 'default-company', secret: 'grocery-secret'),
    );
    await restoredGrocery.restoreSealed(store);
    expect(restoredGrocery.sealedQueue(), isNotEmpty);
    expect(restoredGrocery.openSealed(restoredGrocery.sealedQueue().single)['mutationId'], 'mut-store-1');
    expect(() => jaipur.openSealed(restoredGrocery.sealedQueue().single), throwsStateError);
  });
}
