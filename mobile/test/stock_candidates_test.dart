import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/stock_candidates.dart';

const rice = CatalogItem(id: 'i1', code: 'SKU-1', name: 'Rice', lots: [
  LotRecord(id: 'l1', lotNo: 'LOT-A'),
  LotRecord(id: 'l2', lotNo: 'LOT-B'),
]);
const milk = CatalogItem(id: 'i2', code: 'SKU-2', name: 'Milk', lots: [LotRecord(id: 'l3', lotNo: 'LOT-M')]);
const flour = CatalogItem(id: 'i3', code: 'SKU-3', name: 'Flour', lots: [LotRecord(id: 'l4', lotNo: 'LOT-F')]);

void main() {
  test('items and lots without stock at the branch are never offered', () {
    final stock = [
      const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l1', physicalQuantity: 5),
      const StockRow(itemId: 'i1', locationId: 'loc-1', lotId: 'l2', physicalQuantity: 0),
      const StockRow(itemId: 'i2', locationId: 'loc-2', lotId: 'l3', physicalQuantity: 9),
    ];
    final result = stockedCandidates([rice, milk, flour], stock, 'loc-1');
    expect(result.map((item) => item.id), ['i1']);
    expect(result.single.lots.map((lot) => lot.lotNo), ['LOT-A']);
  });

  test('a stock row without a lot keeps every lot of that item', () {
    final result = stockedCandidates([rice], [const StockRow(itemId: 'i1', locationId: 'loc-1', physicalQuantity: 3)], 'loc-1');
    expect(result.single.lots, hasLength(2));
  });

  test('nothing is offered when the branch has no stock', () {
    expect(stockedCandidates([rice, milk], const [], 'loc-1'), isEmpty);
  });
}
