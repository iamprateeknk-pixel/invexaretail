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

  // Once items are actually assigned to this user, the count list is
  // locked to exactly those items - no role, including an ad-hoc-capable
  // one, should be able to see beyond an assignment that was explicitly
  // handed to them. Ad-hoc (whole-catalog) counting only applies when
  // nothing has been assigned.
  List<CatalogItem> get _countableItems {
    final controller = widget.controller;
    final assignedIds = controller.assignments.map((row) => row.itemId).toSet();
    if (assignedIds.isEmpty) {
      return controller.allowAdHocCount ? controller.items : const [];
    }
    return controller.items.where((item) => assignedIds.contains(item.id)).toList();
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
    for (final item in items) {
      if (item.code.trim().toLowerCase() == normalized) {
        match = item;
        break;
      }
    }
    if (match == null) {
      widget.controller.setError('No assigned item matches barcode "$code".');
      return;
    }
    setState(() {
      _itemId = match!.id;
      _lotNo = match.lots.isEmpty ? null : match.lots.first.lotNo;
    });
  }

  // Physical counting by repeated scan: every successful scan of the
  // selected item's own barcode adds one unit, instead of typing a
  // number. A scan of a different item's barcode is rejected rather than
  // silently counted against the wrong item.
  Future<void> _scanToIncrement(CatalogItem item) async {
    final code = await showBarcodeScanner(context, title: 'Scan ${item.name} to add +1');
    if (code == null || !mounted) return;
    if (code.trim().toLowerCase() != item.code.trim().toLowerCase()) {
      widget.controller.setError('Scanned barcode does not match ${item.name}.');
      return;
    }
    final current = int.tryParse(_qty.text.trim()) ?? 0;
    setState(() => _qty.text = (current + 1).toString());
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
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
          if (!controller.allowAdHocCount && controller.assignments.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text('No count assignments. Ask an admin to assign items at your location.'),
              ),
            )
          else ...[
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
