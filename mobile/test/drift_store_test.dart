import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/drift_store.dart';
import 'package:invexaretail_mobile/services/native_database.dart';

void main() {
  test('DriftStore keeps sealed envelopes inside the saving company', () async {
    final store = DriftStore.inMemory();
    await store.saveSealedQueue('default-company', ['grocery-envelope']);
    await store.saveSealedQueue('company-jaipur', ['jaipur-envelope']);
    expect(await store.loadSealedQueue('default-company'), ['grocery-envelope']);
    expect(await store.loadSealedQueue('company-jaipur'), ['jaipur-envelope']);
    await store.clearSealedQueue('default-company');
    expect(await store.loadSealedQueue('default-company'), isEmpty);
    expect(await store.loadSealedQueue('company-jaipur'), ['jaipur-envelope']);
  });

  test('DriftStore namespaces queued counts by companyId', () async {
    final store = DriftStore.inMemory();
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
    expect((await store.loadQueuedCounts('default-company')).single.localId, 'g-1');
    expect((await store.loadQueuedCounts('company-jaipur')).single.localId, 'j-1');
  });

  test('NativeDatabase.file reopens company-scoped tables from disk', () async {
    final file = File('${Directory.systemTemp.path}/invexa_drift_test_${DateTime.now().microsecondsSinceEpoch}.sqlite');
    addTearDown(() {
      if (file.existsSync()) file.deleteSync();
    });
    final first = DriftStore.native(NativeDatabase.file(file));
    await first.saveSealedQueue('default-company', ['persisted-envelope']);
    await first.saveQueuedCounts([
      QueuedCount(
        localId: 'p-1',
        itemId: 'item-1001',
        locationId: 'loc-1',
        physicalQuantity: 9,
        createdAt: '2026-09-15T00:00:00Z',
      ),
    ], 'default-company');
    first.close();

    final second = DriftStore.native(NativeDatabase.file(file));
    expect(await second.loadSealedQueue('default-company'), ['persisted-envelope']);
    expect((await second.loadQueuedCounts('default-company')).single.localId, 'p-1');
    expect(await second.loadSealedQueue('company-jaipur'), isEmpty);
    second.close();
  });

  test('NativeDatabase schema matches drift_schema.sql tables', () {
    expect(driftNativeSchema, contains('CREATE TABLE IF NOT EXISTS sessions'));
    expect(driftNativeSchema, contains('CREATE TABLE IF NOT EXISTS sealed_mutations'));
    expect(driftNativeSchema, contains('CREATE TABLE IF NOT EXISTS queued_counts'));
    expect(driftNativeSchema, isNot(contains('stock_ledger')));
  });
}
