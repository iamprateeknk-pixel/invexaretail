import '../models/models.dart';

/// Blueprint v4 §1/§7: an operational user is never offered a zero-stock item
/// or lot as something to act on. Given the branch's stock rows (the server
/// already omits zero rows for store users), keep only items - and only the
/// lots of those items - that actually have stock at [locationId].
List<CatalogItem> stockedCandidates(List<CatalogItem> items, List<StockRow> stock, String locationId) {
  final stockedLots = <String, Set<String>>{};
  final wholeItem = <String>{};
  for (final row in stock) {
    if (row.locationId != locationId || (row.physicalQuantity ?? 0) <= 0) continue;
    final lotId = row.lotId;
    if (lotId == null || lotId.isEmpty) {
      wholeItem.add(row.itemId);
    } else {
      stockedLots.putIfAbsent(row.itemId, () => <String>{}).add(lotId);
    }
  }
  final result = <CatalogItem>[];
  for (final item in items) {
    if (wholeItem.contains(item.id)) {
      result.add(item);
      continue;
    }
    final lotIds = stockedLots[item.id];
    if (lotIds == null) continue;
    final lots = item.lots.where((lot) => lotIds.contains(lot.id)).toList();
    if (lots.isEmpty) continue;
    result.add(CatalogItem(id: item.id, code: item.code, name: item.name, unit: item.unit, lots: lots));
  }
  return result;
}
