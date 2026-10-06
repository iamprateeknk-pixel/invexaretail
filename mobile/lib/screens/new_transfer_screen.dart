import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/transfer_draft.dart';
import '../state/session_controller.dart';

/// Start a stock transfer for one item from the current location. Needs a
/// connection: the server reserves the stock atomically, so this is not queued
/// offline the way counts are.
class NewTransferScreen extends StatefulWidget {
  const NewTransferScreen({super.key, required this.controller, required this.item, this.initialLotId});

  final SessionController controller;
  final CatalogItem item;
  final String? initialLotId;

  @override
  State<NewTransferScreen> createState() => _NewTransferScreenState();
}

class _NewTransferScreenState extends State<NewTransferScreen> {
  final _quantity = TextEditingController();
  String? _destinationId;
  String? _lotId;
  String? _error;
  bool _sending = false;

  String get _sourceId => widget.controller.selectedLocationId ?? '';

  /// Lots of this item that actually have stock here, with how much.
  Map<String, double> get _stockByLot {
    final byLot = <String, double>{};
    for (final row in widget.controller.stock) {
      if (row.itemId != widget.item.id || row.locationId != _sourceId) continue;
      final lotId = row.lotId;
      final qty = row.physicalQuantity ?? 0;
      if (lotId == null || lotId.isEmpty || qty <= 0) continue;
      byLot[lotId] = (byLot[lotId] ?? 0) + qty;
    }
    return byLot;
  }

  @override
  void initState() {
    super.initState();
    final stocked = _stockByLot;
    final initial = widget.initialLotId;
    _lotId = initial != null && stocked.containsKey(initial) ? initial : (stocked.length == 1 ? stocked.keys.first : null);
  }

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final available = _lotId == null ? 0.0 : (_stockByLot[_lotId] ?? 0);
    final draft = TransferDraft(
      sourceLocationId: _sourceId,
      destinationLocationId: _destinationId,
      itemId: widget.item.id,
      lotId: _lotId,
      quantity: double.tryParse(_quantity.text.trim().replaceAll(',', '.')),
      availableQuantity: available,
    );
    final problem = draft.problem;
    if (problem != null) {
      setState(() => _error = transferProblemMessage(problem));
      return;
    }
    setState(() {
      _error = null;
      _sending = true;
    });
    try {
      await widget.controller.api.createTransfer(draft.toRequestBody());
      await widget.controller.refreshAll();
      widget.controller.setNotice('Transfer requested for ${widget.item.name}.');
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final stocked = _stockByLot;
    final lots = widget.item.lots.where((lot) => stocked.containsKey(lot.id)).toList();
    final destinations = controller.locations.where((location) => location.id != _sourceId).toList();
    final from = lookupLocationName(controller.locations, _sourceId);
    return Scaffold(
      appBar: AppBar(title: const Text('New transfer')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(widget.item.name, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text('From $from', style: const TextStyle(color: invexaMuted)),
          const SizedBox(height: 20),
          DropdownButtonFormField<String>(
            key: const ValueKey('transfer-destination'),
            initialValue: _destinationId,
            decoration: const InputDecoration(labelText: 'Send to'),
            items: [for (final location in destinations) DropdownMenuItem(value: location.id, child: Text(location.name))],
            onChanged: _sending ? null : (value) => setState(() => _destinationId = value),
          ),
          const SizedBox(height: 16),
          if (lots.isEmpty)
            const Text('No lot of this item has stock at this location.', style: TextStyle(color: invexaRose))
          else
            DropdownButtonFormField<String>(
              key: const ValueKey('transfer-lot'),
              initialValue: _lotId,
              decoration: const InputDecoration(labelText: 'Lot'),
              items: [
                for (final lot in lots) DropdownMenuItem(value: lot.id, child: Text('${lot.lotNo} · ${formatQty(stocked[lot.id] ?? 0)} in stock')),
              ],
              onChanged: _sending ? null : (value) => setState(() => _lotId = value),
            ),
          const SizedBox(height: 16),
          TextField(
            key: const ValueKey('transfer-quantity'),
            controller: _quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'Quantity${widget.item.unit == null ? '' : ' (${widget.item.unit})'}'),
            onSubmitted: (_) => _submit(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: invexaRose)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('transfer-submit'),
            onPressed: _sending || lots.isEmpty ? null : _submit,
            child: _sending
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Request transfer'),
          ),
        ],
      ),
    );
  }
}
