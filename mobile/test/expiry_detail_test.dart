import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/expiry_detail_screen.dart';

void main() {
  final now = DateTime(2026, 10, 1);
  final items = [
    const CatalogItem(id: 'i1', code: 'RICE', name: 'Rice 5kg', lots: [
      LotRecord(id: 'l1', lotNo: 'OLD', expiryDate: '2026-09-20T00:00:00Z'),
      LotRecord(id: 'l2', lotNo: 'SOON', expiryDate: '2026-10-03T00:00:00Z'),
      LotRecord(id: 'l3', lotNo: 'FAR', expiryDate: '2026-12-01T00:00:00Z'),
      LotRecord(id: 'l4', lotNo: 'NODATE'),
    ]),
    const CatalogItem(id: 'i2', code: 'OIL', name: 'Oil 1L', lots: [
      LotRecord(id: 'l5', lotNo: 'ZERO', expiryDate: '2026-09-15T00:00:00Z'),
    ]),
  ];
  final stock = [
    const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l1', physicalQuantity: 3),
    const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l2', physicalQuantity: 5),
    const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l3', physicalQuantity: 9),
    const StockRow(itemId: 'i2', locationId: 'loc-1', lotId: 'l5', physicalQuantity: 0),
    // Different location: must not count toward loc-1's view.
    const StockRow(itemId: 'i1', locationId: 'loc-2', lotId: 'l1', physicalQuantity: 100),
  ];

  test('expired-only lists only lots past their date, with stock, at this location', () {
    final rows = buildExpiryRows(items: items, stock: stock, locationId: 'loc-1', expiredOnly: true, now: now);
    expect(rows.length, 1);
    expect(rows.single.lotNo, 'OLD');
    expect(rows.single.quantity, 3);
    expect(rows.single.isExpired, isTrue);
  });

  test('a zero-stock expired lot is not shown even though it is genuinely past its date', () {
    final rows = buildExpiryRows(items: items, stock: stock, locationId: 'loc-1', expiredOnly: true, now: now);
    expect(rows.any((row) => row.lotNo == 'ZERO'), isFalse);
  });

  test('near-expiry excludes already-expired and far-future lots, sorted soonest first', () {
    final rows = buildExpiryRows(items: items, stock: stock, locationId: 'loc-1', expiredOnly: false, now: now);
    expect(rows.map((row) => row.lotNo), ['SOON', 'FAR']);
  });

  test('a lot with no expiry date is never listed in either view', () {
    final expired = buildExpiryRows(items: items, stock: stock, locationId: 'loc-1', expiredOnly: true, now: now);
    final upcoming = buildExpiryRows(items: items, stock: stock, locationId: 'loc-1', expiredOnly: false, now: now);
    expect([...expired, ...upcoming].any((row) => row.lotNo == 'NODATE'), isFalse);
  });

  test('stock at a different location is not counted toward this one', () {
    final rows = buildExpiryRows(items: items, stock: stock, locationId: 'loc-2', expiredOnly: true, now: now);
    expect(rows.single.quantity, 100);
  });
}
