import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class _ItemStockSummary {
  _ItemStockSummary({required this.itemId, required this.name, required this.code});

  final String itemId;
  final String name;
  final String code;
  final List<StockRow> rows = [];

  int get lotCount => rows.length;
  int get totalPhysical => rows.fold(0, (sum, row) => sum + (row.physicalQuantity ?? 0));
  int? get totalBook {
    if (rows.any((row) => row.bookQuantity == null)) return null;
    return rows.fold<int>(0, (sum, row) => sum + (row.bookQuantity ?? 0));
  }
}

class StockScreen extends StatefulWidget {
  const StockScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  List<_ItemStockSummary> _summaries(SessionController controller) {
    final byItem = <String, _ItemStockSummary>{};
    for (final row in controller.stock) {
      final summary = byItem.putIfAbsent(
        row.itemId,
        () => _ItemStockSummary(
          itemId: row.itemId,
          name: lookupItemName(controller.items, row.itemId),
          code: _itemCode(controller.items, row.itemId),
        ),
      );
      summary.rows.add(row);
    }
    final needle = _query.text.trim().toLowerCase();
    final list = byItem.values.where((summary) {
      if (needle.isEmpty) return true;
      return summary.name.toLowerCase().contains(needle) || summary.code.toLowerCase().contains(needle);
    }).toList();
    list.sort((a, b) => a.name.compareTo(b.name));
    return list;
  }

  static String _itemCode(List<CatalogItem> items, String itemId) {
    for (final item in items) {
      if (item.id == itemId) return item.code;
    }
    return itemId;
  }

  void _openDetail(_ItemStockSummary summary) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => _ItemStockDetailSheet(summary: summary, controller: widget.controller),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final locations = controller.locations;
    final selected = controller.selectedLocationId;
    final summaries = _summaries(controller);

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          if (locations.isEmpty)
            const Text('No locations are assigned to this account.', style: TextStyle(color: invexaMuted))
          else
            DropdownButtonFormField<String>(
              key: const ValueKey('stock-location'),
              initialValue: locations.any((location) => location.id == selected) ? selected : locations.first.id,
              decoration: const InputDecoration(labelText: 'Location'),
              items: [
                for (final location in locations)
                  DropdownMenuItem(value: location.id, child: Text('${location.name} (${location.type})')),
              ],
              onChanged: (value) {
                if (value != null) controller.selectLocation(value);
              },
            ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('stock-search'),
            controller: _query,
            decoration: const InputDecoration(
              labelText: 'Search items',
              hintText: 'Name or code…',
              prefixIcon: Icon(Icons.search),
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),
          if (summaries.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 48),
              child: Text(
                controller.stock.isEmpty ? 'No stock rows for this location.' : 'No items match "${_query.text}".',
                textAlign: TextAlign.center,
                style: const TextStyle(color: invexaMuted),
              ),
            )
          else
            ...summaries.map((summary) => _StockTile(
                  summary: summary,
                  showBookQuantity: controller.showBookQuantity,
                  onTap: () => _openDetail(summary),
                )),
        ],
      ),
    );
  }
}

class _StockTile extends StatelessWidget {
  const _StockTile({required this.summary, required this.showBookQuantity, required this.onTap});

  final _ItemStockSummary summary;
  final bool showBookQuantity;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final book = showBookQuantity && summary.totalBook != null ? ' · Book ${summary.totalBook}' : '';
    return Card(
      child: ListTile(
        title: Text(summary.name),
        subtitle: Text('${summary.code} · ${summary.lotCount} lot${summary.lotCount == 1 ? '' : 's'} · On hand ${summary.totalPhysical}$book'),
        trailing: const Icon(Icons.chevron_right, color: invexaMuted),
        onTap: onTap,
      ),
    );
  }
}

class _ItemStockDetailSheet extends StatelessWidget {
  const _ItemStockDetailSheet({required this.summary, required this.controller});

  final _ItemStockSummary summary;
  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(summary.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text(summary.code, style: const TextStyle(color: invexaMuted)),
            const SizedBox(height: 12),
            Row(
              children: [
                _StatChip(label: 'Lots', value: '${summary.lotCount}'),
                const SizedBox(width: 8),
                _StatChip(label: 'On hand', value: '${summary.totalPhysical}'),
                if (controller.showBookQuantity && summary.totalBook != null) ...[
                  const SizedBox(width: 8),
                  _StatChip(label: 'Book', value: '${summary.totalBook}'),
                ],
              ],
            ),
            const SizedBox(height: 16),
            const Text('Lots', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.4),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: summary.rows.length,
                separatorBuilder: (context, index) => const Divider(height: 16),
                itemBuilder: (context, index) {
                  final row = summary.rows[index];
                  final lotNo = lookupLotNo(controller.items, row.itemId, row.lotId);
                  final physical = row.physicalQuantity == null ? 'hidden' : '${row.physicalQuantity}';
                  final book = controller.showBookQuantity && row.bookQuantity != null ? ' · book ${row.bookQuantity}' : '';
                  return Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(child: Text(lotNo.isEmpty ? 'No lot' : lotNo)),
                      Text('qty $physical$book', style: const TextStyle(color: invexaMuted)),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: invexaSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: invexaBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: invexaMuted)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
