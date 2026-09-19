import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';

/// A tappable field that opens a full-screen, searchable item picker
/// instead of a native dropdown - a dropdown with dozens/hundreds of
/// items is unusable to scroll through, this lets the user type to
/// filter by name or code instead.
class ItemSearchField extends StatelessWidget {
  const ItemSearchField({
    super.key,
    required this.items,
    required this.selectedItemId,
    required this.onChanged,
    this.label = 'Item',
  });

  final List<CatalogItem> items;
  final String? selectedItemId;
  final ValueChanged<String> onChanged;
  final String label;

  CatalogItem? get _selected {
    for (final item in items) {
      if (item.id == selectedItemId) return item;
    }
    return null;
  }

  Future<void> _open(BuildContext context) async {
    final picked = await Navigator.of(context).push<CatalogItem>(
      MaterialPageRoute(builder: (_) => _ItemSearchScreen(items: items, title: label)),
    );
    if (picked != null) onChanged(picked.id);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return InkWell(
      onTap: items.isEmpty ? null : () => _open(context),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: const Icon(Icons.search),
        ),
        child: Text(
          selected == null ? 'Tap to search…' : '${selected.name} (${selected.code})',
          style: selected == null ? const TextStyle(color: invexaMuted) : null,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

class _ItemSearchScreen extends StatefulWidget {
  const _ItemSearchScreen({required this.items, required this.title});

  final List<CatalogItem> items;
  final String title;

  @override
  State<_ItemSearchScreen> createState() => _ItemSearchScreenState();
}

class _ItemSearchScreenState extends State<_ItemSearchScreen> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  List<CatalogItem> get _filtered {
    final needle = _query.text.trim().toLowerCase();
    if (needle.isEmpty) return widget.items;
    return widget.items
        .where((item) =>
            item.name.toLowerCase().contains(needle) ||
            item.code.toLowerCase().contains(needle) ||
            (item.barcode ?? '').toLowerCase().contains(needle) ||
            item.lots.any((lot) => lot.lotNo.toLowerCase().contains(needle)))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final results = _filtered;
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _query,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Search by name, code, or lot…',
            border: InputBorder.none,
          ),
          onChanged: (_) => setState(() {}),
        ),
      ),
      body: results.isEmpty
          ? const Center(child: Text('No matching items.', style: TextStyle(color: invexaMuted)))
          : ListView.builder(
              itemCount: results.length,
              itemBuilder: (context, index) {
                final item = results[index];
                return ListTile(
                  title: Text(item.name),
                  subtitle: Text(item.code),
                  onTap: () => Navigator.of(context).pop(item),
                );
              },
            ),
    );
  }
}
