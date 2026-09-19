import '../models/models.dart';

/// One item to pick on a transfer, as the picker sees it. Lots with nothing on
/// the shelf are never listed (blueprint v4 §15 "no zero-stock lot offered").
class PickLine {
  PickLine({
    required this.itemId,
    required this.itemCode,
    required this.itemName,
    required this.unit,
    required this.pooled,
    required this.remaining,
    required this.lots,
  });

  final String itemId;
  final String itemCode;
  final String itemName;
  final String unit;
  // KG loose: the picker states a weight and the server chooses the lots.
  final bool pooled;
  final double remaining;
  final List<PickLot> lots;

  bool get decimal => pooled || unit.toUpperCase() == 'KG';
}

class PickLot {
  const PickLot({required this.lotId, required this.lotNo, required this.remaining, required this.available});

  final String lotId;
  final String lotNo;
  final double remaining;
  final double available;
}

class ScanResult {
  const ScanResult.ok(this.message) : accepted = true;
  const ScanResult.rejected(this.message) : accepted = false;

  final bool accepted;
  final String message;
}

const pickReasons = {
  'NO_STOCK': 'No stock',
  'WRONG_ITEM': 'Wrong item',
  'DAMAGED_ITEM': 'Damaged',
};

double _round3(double value) => (value * 1000).round() / 1000;

/// The state of one pick: what is left on the server, what this phone has
/// picked but not yet saved, and any problems reported. Reopening the task
/// rebuilds it from the server, so closing the app never loses saved work.
class PickSession {
  PickSession(this.transferId, List<PickLine> lines) : lines = List.unmodifiable(lines);

  final String transferId;
  final List<PickLine> lines;
  // Piece scans, per item -> lot -> count; weights, per item.
  final Map<String, Map<String, double>> _scanned = {};
  final Map<String, double> _weights = {};
  // The code that was actually scanned for each lot: the server re-checks it.
  final Map<String, String> _codes = {};
  final List<Map<String, dynamic>> exceptions = [];

  /// Builds the session from `GET /picker/transfers/:id`.
  factory PickSession.fromServer(Map<String, dynamic> payload) {
    final transfer = asMap(payload['transfer']);
    final byItem = <String, PickLine>{};
    for (final raw in asList(transfer['lines'])) {
      final row = asMap(raw);
      final remaining = asDouble(row['remainingQty']);
      final available = asDouble(row['lotAvailable']);
      final blocked = asString(row['lotStatus'], 'AVAILABLE') != 'AVAILABLE';
      final pooled = asString(row['pickMethod']) == 'ITEM_QTY_FIFO';
      final itemId = asString(row['itemId']);
      final existing = byItem[itemId];
      final lots = <PickLot>[
        ...?existing?.lots,
        // A pooled item is picked from the whole shelf, so its lots are not the picker's business.
        if (!pooled && remaining > 0 && available > 0 && !blocked)
          PickLot(lotId: asString(row['lotId']), lotNo: asString(row['lotNo']), remaining: remaining, available: available),
      ];
      byItem[itemId] = PickLine(
        itemId: itemId,
        itemCode: asString(row['itemCode']),
        itemName: asString(row['itemName'], itemId),
        unit: asString(row['unit'], 'PCS'),
        pooled: pooled,
        remaining: _round3((existing?.remaining ?? 0) + remaining),
        lots: lots,
      );
    }
    final lines = byItem.values.where((line) => line.remaining > 0 && (line.pooled || line.lots.isNotEmpty)).toList();
    return PickSession(asString(transfer['id']), lines);
  }

  PickLine? line(String itemId) {
    for (final row in lines) {
      if (row.itemId == itemId) return row;
    }
    return null;
  }

  double scannedFor(String itemId) => _scanned[itemId]?.values.fold<double>(0, (a, b) => a + b) ?? 0;

  double pendingFor(String itemId) => scannedFor(itemId) + (_weights[itemId] ?? 0);

  double leftFor(String itemId) => _round3((line(itemId)?.remaining ?? 0) - pendingFor(itemId));

  bool get hasPending => _scanned.isNotEmpty || _weights.isNotEmpty || exceptions.isNotEmpty;

  /// One piece scan. The code must be the item's own code or one of its listed lot numbers.
  ScanResult scan(String raw) {
    final code = raw.trim().toLowerCase();
    if (code.isEmpty) return const ScanResult.rejected('Empty scan.');
    PickLine? matched;
    PickLot? matchedLot;
    for (final row in lines) {
      if (row.pooled) continue;
      for (final lot in row.lots) {
        if (lot.lotNo.trim().toLowerCase() == code) {
          matched = row;
          matchedLot = lot;
        }
      }
      if (matched == null && row.itemCode.trim().toLowerCase() == code) matched = row;
      if (matched != null) break;
    }
    if (matched == null) return ScanResult.rejected('Wrong item: "$raw" is not on this pick.');
    if (matchedLot == null) {
      // An item code alone: take the first lot that still has something to pick and stock on the shelf.
      for (final lot in matched.lots) {
        if (_lotLeft(matched.itemId, lot) > 0) {
          matchedLot = lot;
          break;
        }
      }
    }
    if (matchedLot == null || _lotLeft(matched.itemId, matchedLot) < 1) {
      return ScanResult.rejected('${matched.itemName}: nothing left to pick${matchedLot == null ? '' : ' from lot ${matchedLot.lotNo}'}.');
    }
    final lots = _scanned.putIfAbsent(matched.itemId, () => {});
    lots[matchedLot.lotId] = (lots[matchedLot.lotId] ?? 0) + 1;
    _codes['${matched.itemId}|${matchedLot.lotId}'] = raw.trim();
    return ScanResult.ok('${matched.itemName} +1 (${leftFor(matched.itemId).round()} left)');
  }

  double _lotLeft(String itemId, PickLot lot) {
    final taken = _scanned[itemId]?[lot.lotId] ?? 0;
    final byLot = lot.remaining - taken;
    final byShelf = lot.available - taken;
    return byLot < byShelf ? byLot : byShelf;
  }

  /// A weight for a KG item. Never more than what is still to be picked.
  ScanResult setWeight(String itemId, double kg) {
    final row = line(itemId);
    if (row == null || !row.pooled) return const ScanResult.rejected('This item is picked by scanning its lot.');
    if (!(kg > 0)) {
      _weights.remove(itemId);
      return const ScanResult.ok('Cleared.');
    }
    final rounded = _round3(kg);
    if (rounded > row.remaining + 0.0005) {
      return ScanResult.rejected('Only ${row.remaining} ${row.unit} is still to be picked.');
    }
    _weights[itemId] = rounded;
    return ScanResult.ok('${row.itemName}: $rounded ${row.unit} to pick');
  }

  void undoScan(String itemId) {
    final lots = _scanned[itemId];
    if (lots == null || lots.isEmpty) return;
    final lastKey = lots.keys.last;
    final next = (lots[lastKey] ?? 0) - 1;
    if (next <= 0) {
      lots.remove(lastKey);
    } else {
      lots[lastKey] = next;
    }
    if (lots.isEmpty) _scanned.remove(itemId);
  }

  void report(String itemId, String reason, double quantity, {String? lotId}) {
    exceptions.add({'itemId': itemId, 'reason': reason, 'quantity': quantity, if (lotId != null) 'lotId': lotId});
  }

  void clearPending() {
    _scanned.clear();
    _weights.clear();
    _codes.clear();
    exceptions.clear();
  }

  /// The pick-slip request body. Piece lines name their lot and carry the scan that proved it;
  /// KG lines carry only item + weight - the server picks the lots.
  Map<String, dynamic> slipBody({required String requestId, required bool finished}) {
    final lots = <Map<String, dynamic>>[];
    _scanned.forEach((itemId, byLot) {
      final row = line(itemId)!;
      byLot.forEach((lotId, count) {
        final lot = row.lots.firstWhere((candidate) => candidate.lotId == lotId);
        lots.add({'itemId': itemId, 'lotId': lotId, 'quantity': count, 'inputMethod': 'SCAN', 'scanCode': _codes['$itemId|$lotId'] ?? lot.lotNo});
      });
    });
    _weights.forEach((itemId, kg) => lots.add({'itemId': itemId, 'quantity': kg, 'inputMethod': 'MANUAL'}));
    return {
      'requestId': requestId,
      'finished': finished,
      'lines': lots,
      'exceptions': exceptions.map((row) => Map<String, dynamic>.from(row)).toList(),
    };
  }
}
