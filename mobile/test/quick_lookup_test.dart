import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/quick_lookup.dart';

const rice = CatalogItem(id: 'i1', code: 'SKU-1', name: 'Rice', barcode: '890100', lots: [
  LotRecord(id: 'l1', lotNo: 'LOT-A'),
  LotRecord(id: 'l2', lotNo: 'LOT-B'),
]);
final stock = [
  const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l1', physicalQuantity: 5),
  const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l2', physicalQuantity: 3),
  const StockRow(itemId: 'i1', locationId: 'loc-2', lotId: 'l1', physicalQuantity: 99),
];

void main() {
  test('barcode match sums on-hand across lots at this branch only', () {
    final result = quickLookup([rice], stock, 'loc-1', ' 890100 ');
    expect(result!.item.id, 'i1');
    expect(result.lot, isNull);
    expect(result.onHand, 8);
  });

  test('lot number match narrows on-hand to that lot', () {
    final result = quickLookup([rice], stock, 'loc-1', 'lot-b');
    expect(result!.lot!.id, 'l2');
    expect(result.onHand, 3);
  });

  test('unknown and blank codes return null', () {
    expect(quickLookup([rice], stock, 'loc-1', 'nope'), isNull);
    expect(quickLookup([rice], stock, 'loc-1', '  '), isNull);
  });
}
