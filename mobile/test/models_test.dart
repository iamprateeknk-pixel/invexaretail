import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';

void main() {
  test('parses POST /api/v1/auth/login payload', () {
    final login = LoginResult.fromJson({
      'success': true,
      'token': 'access-token',
      'refreshToken': 'refresh-token',
      'user': {
        'id': 'user-admin-1',
        'name': 'Admin User',
        'email': 'admin@retail.local',
        'role': 'ADMIN',
        'companyId': 'co-1',
        'branchIds': ['loc-1'],
      },
    });

    expect(login.token, 'access-token');
    expect(login.refreshToken, 'refresh-token');
    expect(login.user.role, 'ADMIN');
    expect(login.user.email, 'admin@retail.local');
  });

  test('parses GET /api/v1/dashboard KPIs instead of totalItems', () {
    final dashboard = DashboardSummary.fromJson({
      'dashboard': {
        'pendingCounts': 2,
        'transferRequests': 1,
        'expiredTillDate': 1,
        'nearExpiryThisMonth': 1,
        'nearExpiryNextMonth': 0,
        'countCompletionPercent': 50.5,
        'transferSlaPercent': 0,
        'stockAccuracyPercent': 100,
      },
    });

    expect(dashboard.pendingCounts, 2);
    expect(dashboard.transferRequests, 1);
    expect(dashboard.expiredTillDate, 1);
    expect(dashboard.countCompletionPercent, 50.5);
  });

  test('parses stock rows that omit itemName and bookQuantity', () {
    final row = StockRow.fromJson({
      'itemId': 'item-1001',
      'lotId': 'lot-1001',
      'locationId': 'loc-1',
      'physicalQuantity': 28,
    });

    expect(row.itemId, 'item-1001');
    expect(row.bookQuantity, isNull);
    expect(row.physicalQuantity, 28);
  });

  test('parses counts and transfers using server field names', () {
    final count = CountRecord.fromJson({
      'id': 'count-1',
      'itemId': 'item-1001',
      'lotId': 'lot-1001',
      'locationId': 'loc-1',
      'physicalQuantity': 28,
      'mode': 'manual',
      'submittedBy': 'user-admin-1',
      'status': 'PENDING_REVIEW',
    });
    final transfer = TransferRecord.fromJson({
      'id': 'transfer-1',
      'sourceLocationId': 'loc-1',
      'destinationLocationId': 'wh-1',
      'status': 'REQUESTED',
      'cartonCount': 2,
      'lines': [
        {'itemId': 'item-1001', 'lotId': 'lot-1001', 'quantity': 12},
      ],
    });

    expect(count.physicalQuantity, 28);
    expect(count.status, 'PENDING_REVIEW');
    expect(transfer.cartonCount, 2);
    expect(transfer.totalQuantity, 12);
  });

  test('joins catalog names onto stock and queued counts', () {
    final items = [
      CatalogItem.fromJson({
        'id': 'item-1001',
        'code': 'SKU-1001',
        'name': 'Rice 5kg',
        'lots': [
          {'id': 'lot-1001', 'itemId': 'item-1001', 'lotNo': 'LOT-01'},
        ],
      }),
    ];
    expect(lookupItemName(items, 'item-1001'), 'Rice 5kg');
    expect(lookupLotNo(items, 'item-1001', 'lot-1001'), 'LOT-01');
    expect(lookupItemName(items, 'missing'), 'missing');
  });

  test('store users stay blind to book quantity', () {
    expect(canSeeBookQuantity('STORE_USER'), isFalse);
    expect(canSeeBookQuantity('ADMIN'), isTrue);
    expect(canSubmitAdHocCount('STORE_USER'), isFalse);
    expect(canSubmitAdHocCount('ADMIN'), isTrue);
    expect(isCountWorkerRole('BRANCH_MANAGER'), isTrue);
    expect(isCountWorkerRole('WAREHOUSE_PICKER'), isTrue);
    expect(isCountWorkerRole('AUDITOR'), isFalse);
    expect(isCountWorkerRole('ADMIN'), isFalse);
  });

  test('queued counts round-trip through JSON', () {
    final raw = encodeQueuedCounts([
      QueuedCount(
        localId: 'local-1',
        itemId: 'item-1004',
        locationId: 'loc-1',
        physicalQuantity: 4,
        lotNo: 'LOT-EXP',
        createdAt: '2026-09-14T00:00:00.000Z',
      ),
    ]);
    final decoded = decodeQueuedCounts(raw);
    expect(decoded, hasLength(1));
    expect(decoded.first.itemId, 'item-1004');
    expect(decoded.first.lotNo, 'LOT-EXP');
    expect(decoded.first.status, 'pending');
    expect(decodeQueuedCounts('not-json'), isEmpty);
  });

  test('a queued count saved before the sync-status field existed still decodes as pending', () {
    final decoded = QueuedCount.fromJson({
      'localId': 'local-legacy',
      'itemId': 'item-1004',
      'locationId': 'loc-1',
      'physicalQuantity': 4,
      'createdAt': '2026-09-14T00:00:00.000Z',
    });
    expect(decoded.status, 'pending');
  });

  test('queued actions round-trip for receive, pick, putaway and exceptions', () {
    final raw = encodeQueuedActions([
      QueuedAction(
        localId: 'act-1',
        type: 'PUTAWAY',
        method: 'POST',
        path: '/api/v1/putaway-tasks/t1/confirm',
        body: {'scannedBinCode': 'A-01'},
        createdAt: '2026-09-15T00:00:00.000Z',
      ),
    ]);
    final decoded = decodeQueuedActions(raw);
    expect(decoded, hasLength(1));
    expect(decoded.first.type, 'PUTAWAY');
    expect(decoded.first.body['scannedBinCode'], 'A-01');
    expect(decoded.first.status, 'pending');
  });
}
