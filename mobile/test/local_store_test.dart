import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/local_store.dart';

void main() {
  test('queued counts stay inside the company that saved them', () async {
    final store = MemoryStore();
    await store.saveQueuedCounts([
      QueuedCount(
        localId: 'g-1',
        itemId: 'item-1001',
        locationId: 'loc-1',
        physicalQuantity: 4,
        createdAt: '2026-09-15T00:00:00Z',
      ),
    ], 'default-company');
    await store.saveQueuedCounts([
      QueuedCount(
        localId: 'j-1',
        itemId: 'item-jaipur-1',
        locationId: 'loc-jaipur-1',
        physicalQuantity: 2,
        createdAt: '2026-09-15T00:00:00Z',
      ),
    ], 'company-jaipur');

    final grocery = await store.loadQueuedCounts('default-company');
    final jaipur = await store.loadQueuedCounts('company-jaipur');
    expect(grocery.single.localId, 'g-1');
    expect(jaipur.single.localId, 'j-1');
  });

  test('sealed envelopes are namespaced by companyId', () async {
    final store = MemoryStore();
    await store.saveSealedQueue('default-company', ['grocery-envelope']);
    await store.saveSealedQueue('company-jaipur', ['jaipur-envelope']);
    expect(await store.loadSealedQueue('default-company'), ['grocery-envelope']);
    expect(await store.loadSealedQueue('company-jaipur'), ['jaipur-envelope']);
    await store.clearSealedQueue('default-company');
    expect(await store.loadSealedQueue('default-company'), isEmpty);
    expect(await store.loadSealedQueue('company-jaipur'), ['jaipur-envelope']);
  });
}
