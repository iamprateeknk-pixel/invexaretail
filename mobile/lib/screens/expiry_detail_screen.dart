import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

/// One lot worth showing: an item, a lot, and how many days until (or since)
/// its expiry at the current location.
class ExpiryRow {
  const ExpiryRow({required this.itemName, required this.itemCode, required this.lotNo, required this.quantity, required this.daysToExpiry});

  final String itemName;
  final String itemCode;
  final String lotNo;
  final double quantity;
  final int daysToExpiry;

  bool get isExpired => daysToExpiry < 0;
}

/// Builds the rows the dashboard's "Expired lots"/"Near expiry" tiles drill into, from data the
/// app already has loaded (items + their lots, and on-hand per lot at this location) - no extra
/// network round trip just to open this screen.
List<ExpiryRow> buildExpiryRows({
  required List<CatalogItem> items,
  required List<StockRow> stock,
  required String? locationId,
  required bool expiredOnly,
  DateTime? now,
}) {
  final today = now ?? DateTime.now();
  final todayDay = DateTime(today.year, today.month, today.day);
  final rows = <ExpiryRow>[];
  for (final item in items) {
    for (final lot in item.lots) {
      if (lot.expiryDate == null) continue;
      final expiry = DateTime.tryParse(lot.expiryDate!);
      if (expiry == null) continue;
      final expiryDay = DateTime(expiry.year, expiry.month, expiry.day);
      final daysToExpiry = expiryDay.difference(todayDay).inDays;
      if (expiredOnly && daysToExpiry >= 0) continue;
      if (!expiredOnly && daysToExpiry < 0) continue;
      final onHand = stock
          .where((row) => row.itemId == item.id && row.lotId == lot.id && (locationId == null || row.locationId == locationId))
          .fold<double>(0, (sum, row) => sum + (row.physicalQuantity ?? 0));
      if (onHand <= 0) continue;
      rows.add(ExpiryRow(itemName: item.name, itemCode: item.code, lotNo: lot.lotNo, quantity: onHand, daysToExpiry: daysToExpiry));
    }
  }
  rows.sort((a, b) => a.daysToExpiry.compareTo(b.daysToExpiry));
  return rows;
}

class ExpiryDetailScreen extends StatelessWidget {
  const ExpiryDetailScreen({super.key, required this.controller, required this.expiredOnly});

  final SessionController controller;
  final bool expiredOnly;

  @override
  Widget build(BuildContext context) {
    final rows = buildExpiryRows(
      items: controller.items,
      stock: controller.stock,
      locationId: controller.selectedLocationId,
      expiredOnly: expiredOnly,
    );
    return Scaffold(
      appBar: AppBar(title: Text(expiredOnly ? 'Expired lots' : 'Near-expiry lots')),
      body: RefreshIndicator(
        color: invexaEmerald,
        onRefresh: controller.refreshAll,
        child: rows.isEmpty
            ? ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 64),
                    child: Center(
                      child: Text(
                        expiredOnly ? 'Nothing expired here right now.' : 'Nothing expiring soon here.',
                        style: const TextStyle(color: invexaMuted),
                      ),
                    ),
                  ),
                ],
              )
            : ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                itemCount: rows.length,
                itemBuilder: (context, index) {
                  final row = rows[index];
                  final badgeColor = row.isExpired ? invexaRose : (row.daysToExpiry <= 7 ? invexaAmber : invexaMuted);
                  final badgeText = row.isExpired ? '${-row.daysToExpiry}d overdue' : '${row.daysToExpiry}d left';
                  return Card(
                    child: ListTile(
                      title: Text(row.itemName, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${row.itemCode} · Lot ${row.lotNo} · ${formatQty(row.quantity)} on hand'),
                      trailing: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: badgeColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                        child: Text(badgeText, style: TextStyle(color: badgeColor, fontWeight: FontWeight.w700, fontSize: 12)),
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
