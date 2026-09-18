import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';
import '../widgets/barcode_scan_sheet.dart';
import '../widgets/item_search_field.dart';

class CountScreen extends StatefulWidget {
  const CountScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<CountScreen> createState() => _CountScreenState();
}

class _CountScreenState extends State<CountScreen> {
  String? _itemId;
  String? _lotNo;
  String? _locationId;
  String? _selectedBatchKey;
  final _qty = TextEditingController();

  @override
  void initState() {
    super.initState();
    _locationId = widget.controller.selectedLocationId;
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  // Every item assigned to this user in one admin action shares the same
  // location, assigner, and countDate - grouping on that lets each batch
  // show up as its own separate stock count to work through, instead of
  // dumping every item ever assigned into one flat list.
  Map<String, List<CountAssignment>> get _batches {
    final byBatch = <String, List<CountAssignment>>{};
    for (final row in widget.controller.assignments) {
      byBatch.putIfAbsent(row.batchKey, () => []).add(row);
    }
    return byBatch;
  }

  List<CountAssignment> get _selectedBatchRows => _batches[_selectedBatchKey] ?? const [];

  // Once items are actually assigned to this user, the count list is
  // locked to exactly those items - no role, including an ad-hoc-capable
  // one, should be able to see beyond an assignment that was explicitly
  // handed to them. Ad-hoc (whole-catalog) counting only applies when
  // nothing has been assigned. When assignments exist, the list is further
  // scoped to whichever single batch the user picked, not every batch.
  List<CatalogItem> get _countableItems {
    final controller = widget.controller;
    if (controller.assignments.isEmpty) {
      return controller.allowAdHocCount ? controller.items : const [];
    }
    final assignedIds = _selectedBatchRows.map((row) => row.itemId).toSet();
    return controller.items.where((item) => assignedIds.contains(item.id)).toList();
  }

  void _selectBatch(String batchKey, List<CountAssignment> rows) {
    setState(() {
      _selectedBatchKey = batchKey;
      _locationId = rows.first.locationId;
      _itemId = null;
      _lotNo = null;
      _qty.clear();
    });
  }

  Future<void> _submit() async {
    final itemId = _itemId;
    final locationId = _locationId ?? widget.controller.selectedLocationId;
    final qty = int.tryParse(_qty.text.trim());
    if (itemId == null || locationId == null || qty == null || qty < 0) {
      widget.controller.setError('Choose an item, location, and a non-negative quantity.');
      return;
    }
    final ok = await widget.controller.submitCount(
      itemId: itemId,
      locationId: locationId,
      physicalQuantity: qty,
      lotNo: _lotNo,
    );
    if (ok && mounted) {
      _qty.clear();
    }
  }

  Future<void> _scanItem(List<CatalogItem> items) async {
    final code = await showBarcodeScanner(context, title: 'Scan item barcode');
    if (code == null || !mounted) return;
    final normalized = code.trim().toLowerCase();
    CatalogItem? match;
    LotRecord? matchedLot;
    for (final item in items) {
      if (item.code.trim().toLowerCase() == normalized) {
        match = item;
        break;
      }
      for (final lot in item.lots) {
        if (lot.lotNo.trim().toLowerCase() == normalized) {
          match = item;
          matchedLot = lot;
          break;
        }
      }
      if (match != null) break;
    }
    if (match == null) {
      widget.controller.setError('No assigned item matches barcode "$code".');
      return;
    }
    setState(() {
      _itemId = match!.id;
      _lotNo = matchedLot?.lotNo ?? (match.lots.isEmpty ? null : match.lots.first.lotNo);
    });
  }

  // Physical counting by repeated scan: every successful scan of the
  // selected item's own barcode (or one of its lot codes) adds one unit,
  // instead of typing a number. A scan of a different item's barcode is
  // rejected rather than silently counted against the wrong item.
  Future<void> _scanToIncrement(CatalogItem item) async {
    final code = await showBarcodeScanner(context, title: 'Scan ${item.name} to add +1');
    if (code == null || !mounted) return;
    final normalized = code.trim().toLowerCase();
    final matchesItem = normalized == item.code.trim().toLowerCase();
    final matchesLot = item.lots.any((lot) => lot.lotNo.trim().toLowerCase() == normalized);
    if (!matchesItem && !matchesLot) {
      widget.controller.setError('Scanned barcode does not match ${item.name}.');
      return;
    }
    final current = int.tryParse(_qty.text.trim()) ?? 0;
    setState(() => _qty.text = (current + 1).toString());
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final batches = _batches;
    final hasAssignments = controller.assignments.isNotEmpty;
    if (hasAssignments && !batches.containsKey(_selectedBatchKey)) {
      final sortedKeys = batches.keys.toList()
        ..sort((a, b) => (batches[a]!.first.countDate ?? '').compareTo(batches[b]!.first.countDate ?? ''));
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _selectBatch(sortedKeys.first, batches[sortedKeys.first]!);
      });
    }
    final items = _countableItems;
    CatalogItem? selectedItem;
    for (final item in items) {
      if (item.id == _itemId) {
        selectedItem = item;
        break;
      }
    }
    final lots = selectedItem?.lots ?? const <LotRecord>[];

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Submit a blind count. Book quantity stays on the server.',
            style: TextStyle(color: invexaMuted),
          ),
          const SizedBox(height: 16),
          if (!controller.allowAdHocCount && !hasAssignments)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text('No count assignments. Ask an admin to assign items at your location.'),
              ),
            )
          else ...[
            if (hasAssignments) ...[
              Text('Pending counts (${batches.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              for (final entry in batches.entries)
                _BatchCard(
                  rows: entry.value,
                  locationName: lookupLocationName(controller.locations, entry.value.first.locationId),
                  selected: entry.key == _selectedBatchKey,
                  onTap: () => _selectBatch(entry.key, entry.value),
                ),
              const SizedBox(height: 20),
            ] else
              DropdownButtonFormField<String>(
                key: const ValueKey('count-location'),
                initialValue: controller.locations.any((location) => location.id == _locationId)
                    ? _locationId
                    : (controller.locations.isEmpty ? null : controller.locations.first.id),
                decoration: const InputDecoration(labelText: 'Location'),
                items: [
                  for (final location in controller.locations)
                    DropdownMenuItem(value: location.id, child: Text(location.name)),
                ],
                onChanged: (value) => setState(() => _locationId = value),
              ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: ItemSearchField(
                    key: const ValueKey('count-item'),
                    items: items,
                    selectedItemId: _itemId,
                    onChanged: (value) {
                      setState(() {
                        _itemId = value;
                        final next = items.where((item) => item.id == value).toList();
                        _lotNo = next.isEmpty || next.first.lots.isEmpty ? null : next.first.lots.first.lotNo;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  key: const ValueKey('count-scan-item'),
                  tooltip: 'Scan item barcode',
                  icon: const Icon(Icons.qr_code_scanner),
                  onPressed: () => _scanItem(items),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (lots.isNotEmpty)
              DropdownButtonFormField<String>(
                key: ValueKey('count-lot-$_itemId'),
                initialValue: lots.any((lot) => lot.lotNo == _lotNo) ? _lotNo : lots.first.lotNo,
                decoration: const InputDecoration(labelText: 'Lot'),
                items: [
                  for (final lot in lots)
                    DropdownMenuItem(value: lot.lotNo, child: Text(lot.lotNo)),
                ],
                onChanged: (value) => setState(() => _lotNo = value),
              ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('count-qty'),
                    controller: _qty,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Physical quantity'),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  key: const ValueKey('count-scan-qty'),
                  tooltip: 'Scan barcode to add +1',
                  icon: const Icon(Icons.add_a_photo_outlined),
                  onPressed: selectedItem == null ? null : () => _scanToIncrement(selectedItem!),
                ),
              ],
            ),
            if (controller.error != null) ...[
              const SizedBox(height: 12),
              Text(controller.error!, style: const TextStyle(color: invexaRose)),
            ],
            if (controller.notice != null) ...[
              const SizedBox(height: 12),
              Text(controller.notice!, style: const TextStyle(color: invexaEmerald, fontWeight: FontWeight.w600)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: controller.busy ? null : _submit,
              child: const Text('Submit count'),
            ),
          ],
          const SizedBox(height: 28),
          const Text('Recent counts', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (controller.counts.isEmpty)
            const Text('No counts yet.', style: TextStyle(color: invexaMuted))
          else
            ...controller.counts.take(20).map((count) {
              final book = controller.showBookQuantity && count.bookQty != null ? ' · book ${count.bookQty}' : '';
              return Card(
                child: ListTile(
                  title: Text(lookupItemName(controller.items, count.itemId)),
                  subtitle: Text(
                    '${lookupLocationName(controller.locations, count.locationId)} · qty ${count.physicalQuantity}$book',
                  ),
                  trailing: Text(count.status ?? 'PENDING_REVIEW', style: const TextStyle(fontSize: 12, color: invexaMuted)),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _BatchCard extends StatelessWidget {
  const _BatchCard({
    required this.rows,
    required this.locationName,
    required this.selected,
    required this.onTap,
  });

  final List<CountAssignment> rows;
  final String locationName;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dueDate = rows.first.dueDate;
    final priority = rows.first.priority;
    final instructions = rows.first.instructions;
    return Card(
      color: selected ? invexaEmerald.withValues(alpha: 0.12) : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? invexaEmerald : invexaBorder, width: selected ? 2 : 1),
      ),
      child: ListTile(
        onTap: onTap,
        title: Text('$locationName · ${rows.length} item${rows.length == 1 ? '' : 's'}'),
        subtitle: Text([
          if (instructions != null && instructions.trim().isNotEmpty) instructions.trim(),
          if (priority != null && priority != 'NORMAL') priority,
          if (dueDate != null) 'Due ${dueDate.split('T').first}',
        ].join(' · ')),
        trailing: selected ? const Icon(Icons.check_circle, color: invexaEmerald) : const Icon(Icons.chevron_right, color: invexaMuted),
      ),
    );
  }
}
