import '../models/models.dart';

/// Result of a one-scan lookup: the item, the lot the code matched (if the
/// code was a lot number), and how much of it the branch holds.
class QuickLookupResult {
  const QuickLookupResult({required this.item, this.lot, required this.onHand});

  final CatalogItem item;
  final LotRecord? lot;
  final double onHand;
}

/// Matches a scanned or typed [code] against item barcode, item code and lot
/// number (case-insensitive, trimmed). Returns null when nothing matches.
QuickLookupResult? quickLookup(List<CatalogItem> items, List<StockRow> stock, String locationId, String code) {
  final needle = code.trim().toLowerCase();
  if (needle.isEmpty) return null;
  for (final item in items) {
    LotRecord? matchedLot;
    var hit = item.barcode?.toLowerCase() == needle || item.code.toLowerCase() == needle;
    if (!hit) {
      for (final lot in item.lots) {
        if (lot.lotNo.toLowerCase() == needle) {
          matchedLot = lot;
          hit = true;
          break;
        }
      }
    }
    if (!hit) continue;
    var onHand = 0.0;
    for (final row in stock) {
      if (row.itemId != item.id || row.locationId != locationId) continue;
      if (matchedLot != null && row.lotId != matchedLot.id) continue;
      onHand += row.physicalQuantity ?? 0;
    }
    return QuickLookupResult(item: item, lot: matchedLot, onHand: onHand);
  }
  return null;
}
