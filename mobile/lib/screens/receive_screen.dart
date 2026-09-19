import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/scan_feedback.dart';
import '../state/session_controller.dart';
import '../widgets/barcode_scan_sheet.dart';

class ReceiveScreen extends StatefulWidget {
  const ReceiveScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<ReceiveScreen> createState() => _ReceiveScreenState();
}

class _ReceiveScreenState extends State<ReceiveScreen> {
  final _code = TextEditingController();

  SessionController get controller => widget.controller;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  List<TransferRecord> get _inbound => controller.transfers.where((row) {
        final status = row.status.toUpperCase();
        return status.contains('TRANSIT') || status.contains('DISPATCH') || status.contains('PARTIAL');
      }).toList();

  void _open(TransferRecord transfer) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => TransferDetailScreen(transfer: transfer, controller: controller)),
    );
  }

  // Blueprint v4 §18: scan a carton label (or type the transfer id) and the
  // expected lines load. Falls back to the server when the list is stale.
  Future<void> _openByCode(String raw) async {
    final code = raw.trim();
    if (code.isEmpty) return;
    TransferRecord? match;
    for (final transfer in _inbound) {
      if (transfer.matchesCode(code)) {
        match = transfer;
        break;
      }
    }
    if (match == null) {
      try {
        match = await controller.api.transferByPackage(code);
      } on ApiException {
        match = null;
      }
    }
    if (!mounted) return;
    if (match == null) {
      await ScanFeedback.rejected();
      controller.setError('No transfer waiting to be received matches "$code".');
      return;
    }
    await ScanFeedback.accepted();
    _code.clear();
    _open(match);
  }

  Future<void> _scan() async {
    final code = await showBarcodeScanner(context, title: 'Scan carton or transfer');
    if (code == null || !mounted) return;
    await _openByCode(code);
  }

  @override
  Widget build(BuildContext context) {
    final inbound = _inbound;

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Scan a carton label or open a transfer to see its items, quantities and photos before confirming receipt.',
            style: TextStyle(color: invexaMuted),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('receive-code'),
            controller: _code,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              labelText: 'Carton or transfer code',
              suffixIcon: IconButton(
                key: const ValueKey('receive-scan'),
                tooltip: 'Scan carton',
                icon: const Icon(Icons.qr_code_scanner),
                onPressed: _scan,
              ),
            ),
            onSubmitted: _openByCode,
          ),
          if (controller.error != null) ...[
            const SizedBox(height: 8),
            Text(controller.error!, style: const TextStyle(color: invexaRose)),
          ],
          const SizedBox(height: 16),
          if (inbound.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Text('Nothing waiting to receive.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted)),
            )
          else
            ...inbound.map((transfer) {
              final from = lookupLocationName(controller.locations, transfer.sourceLocationId);
              final itemCount = transfer.lines.length;
              final open = transfer.lines.fold<double>(0, (sum, line) => sum + line.remaining);
              return Card(
                child: ListTile(
                  title: Text('$from · $itemCount item${itemCount == 1 ? '' : 's'}'),
                  subtitle: Text([
                    'Open ${formatQty(open)} of ${formatQty(transfer.totalQuantity)}',
                    transfer.status,
                    if (transfer.cartons.isNotEmpty) '${transfer.cartons.length} carton${transfer.cartons.length == 1 ? '' : 's'}',
                  ].join(' · ')),
                  trailing: transfer.delayed
                      ? const Chip(label: Text('Delayed'), visualDensity: VisualDensity.compact)
                      : const Icon(Icons.chevron_right, color: invexaMuted),
                  onTap: () => _open(transfer),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class TransferDetailScreen extends StatefulWidget {
  const TransferDetailScreen({super.key, required this.transfer, required this.controller});

  final TransferRecord transfer;
  final SessionController controller;

  @override
  State<TransferDetailScreen> createState() => _TransferDetailScreenState();
}

class _TransferDetailScreenState extends State<TransferDetailScreen> {
  late final List<TextEditingController> _receivedQty;
  late final List<TextEditingController> _damagedQty;
  // One key for this receipt, kept across taps and retries: if the first
  // attempt timed out but reached the server, the retry returns that result
  // instead of posting the stock a second time.
  final String _requestId = newRequestId();
  bool _closeShort = false;
  bool _loadingPhotos = true;
  String? _photoError;
  List<_TransferPhoto> _photos = [];

  TransferRecord get _transfer => widget.transfer;
  SessionController get _controller => widget.controller;

  @override
  void initState() {
    super.initState();
    _receivedQty = _transfer.lines.map((line) => TextEditingController(text: formatQty(line.remaining))).toList();
    _damagedQty = _transfer.lines.map((_) => TextEditingController(text: '0')).toList();
    _loadPhotos();
  }

  @override
  void dispose() {
    for (final c in [..._receivedQty, ..._damagedQty]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadPhotos() async {
    setState(() {
      _loadingPhotos = true;
      _photoError = null;
    });
    try {
      final entries = await _controller.api.transferEvidence(_transfer.id);
      final loaded = <_TransferPhoto>[];
      for (final entry in entries) {
        final id = asString(entry['id']);
        final bytes = await _controller.api.transferEvidencePhoto(_transfer.id, id);
        loaded.add(_TransferPhoto(id: id, fileName: asString(entry['fileName']), bytes: bytes));
      }
      if (!mounted) return;
      setState(() {
        _photos = loaded;
        _loadingPhotos = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _photoError = err.message;
        _loadingPhotos = false;
      });
    }
  }

  bool _allowsDecimal(TransferLine line) {
    for (final item in _controller.items) {
      if (item.id == line.itemId) return item.allowsDecimal;
    }
    return false;
  }

  // Whole numbers for pieces, up to 3 decimals for KG-style items.
  double? _parse(String text, TransferLine line) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return 0;
    if (_allowsDecimal(line)) {
      final value = double.tryParse(trimmed);
      return value == null || value < 0 ? null : (value * 1000).round() / 1000;
    }
    final whole = int.tryParse(trimmed);
    return whole == null || whole < 0 ? null : whole.toDouble();
  }

  Future<void> _confirmReceive() async {
    final lines = <Map<String, dynamic>>[];
    for (var i = 0; i < _transfer.lines.length; i++) {
      final line = _transfer.lines[i];
      final open = line.remaining;
      if (open <= 0) continue;
      final counted = _parse(_receivedQty[i].text, line);
      final damaged = _parse(_damagedQty[i].text, line);
      if (counted == null || damaged == null) {
        await ScanFeedback.rejected();
        _controller.setError('Enter a valid quantity for every line.');
        return;
      }
      if (damaged > open + 0.0005) {
        await ScanFeedback.rejected();
        _controller.setError('Damaged quantity cannot be more than what is still open on a line.');
        return;
      }
      // More than the open quantity arrived: the extra is declared as excess
      // (held for a decision), never silently added to sellable stock.
      final good = counted + damaged > open ? (open - damaged).clamp(0, open).toDouble() : counted;
      final excess = counted + damaged > open ? counted + damaged - open : 0.0;
      final short = _closeShort ? (open - good - damaged).clamp(0, open).toDouble() : 0.0;
      if (good + damaged + short + excess <= 0) continue;
      lines.add({
        'itemId': line.itemId,
        'lotId': line.lotId,
        'receivedQty': good,
        'damagedQty': damaged,
        'shortageQty': (short * 1000).round() / 1000,
        'excessQty': (excess * 1000).round() / 1000,
      });
    }
    if (lines.isEmpty) {
      await ScanFeedback.rejected();
      _controller.setError('Nothing to receive - enter what arrived on at least one open line.');
      return;
    }
    final ok = await _controller.runOrQueue(
      type: 'TRANSFER_RECEIVE',
      method: 'POST',
      path: '/api/v1/transfers/${_transfer.id}/receive',
      body: {
        'requestId': _requestId,
        'lines': lines,
        if (_controller.selectedLocationId != null) 'locationId': _controller.selectedLocationId,
      },
    );
    if (ok && mounted) {
      await ScanFeedback.saved();
      if (mounted) Navigator.of(context).pop();
    }
  }

  void _openPhoto(_TransferPhoto photo) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(photo.fileName)),
        body: Center(child: InteractiveViewer(child: Image.memory(photo.bytes))),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final from = lookupLocationName(controller.locations, _transfer.sourceLocationId);
    final to = lookupLocationName(controller.locations, _transfer.destinationLocationId);

    return Scaffold(
      appBar: AppBar(title: Text('Transfer ${_transfer.id}')),
      body: RefreshIndicator(
        color: invexaEmerald,
        onRefresh: _loadPhotos,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('$from → $to', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(
                      'Status ${_transfer.status}'
                      '${_transfer.cartonCount != null ? ' · ${_transfer.cartonCount} cartons' : ''}'
                      '${_transfer.createdAt != null ? ' · ${_transfer.createdAt!.split('T').first}' : ''}',
                      style: const TextStyle(color: invexaMuted),
                    ),
                    if (_transfer.dispatch != null && !_transfer.dispatch!.isEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        [
                          if (_transfer.dispatch!.carrier != null) _transfer.dispatch!.carrier!,
                          if (_transfer.dispatch!.vehicleNo != null) 'Vehicle ${_transfer.dispatch!.vehicleNo}',
                          if (_transfer.dispatch!.awb != null) 'AWB ${_transfer.dispatch!.awb}',
                        ].join(' · '),
                      ),
                      if (_transfer.dispatch!.expectedArrivalAt != null)
                        Text(
                          '${_transfer.delayed ? 'Was due' : 'Due'} ${_transfer.dispatch!.expectedArrivalAt!.replaceFirst('T', ' ').split('.').first}',
                          style: TextStyle(color: _transfer.delayed ? invexaRose : invexaMuted, fontSize: 12),
                        ),
                    ],
                    if (_transfer.cartons.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          for (final carton in _transfer.cartons)
                            Chip(
                              visualDensity: VisualDensity.compact,
                              label: Text('${carton.packageId} · ${formatQty(carton.quantity)}'),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text('Items (${_transfer.lines.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            for (var i = 0; i < _transfer.lines.length; i++) ...[
              _TransferLineTile(
                line: _transfer.lines[i],
                items: controller.items,
                receivedQtyController: _receivedQty[i],
                damagedQtyController: _damagedQty[i],
                decimal: _allowsDecimal(_transfer.lines[i]),
              ),
              const SizedBox(height: 8),
            ],
            SwitchListTile(
              key: const ValueKey('close-short'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Close what did not arrive as short'),
              subtitle: const Text('Off: the missing quantity stays open for a later delivery. On: it is booked as short and a case is opened.'),
              value: _closeShort,
              onChanged: (value) => setState(() => _closeShort = value),
            ),
            const SizedBox(height: 20),
            const Text('Photos', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            if (_loadingPhotos)
              const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()))
            else if (_photoError != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_photoError!, style: const TextStyle(color: invexaRose)),
                      const SizedBox(height: 8),
                      OutlinedButton(onPressed: _loadPhotos, child: const Text('Retry')),
                    ],
                  ),
                ),
              )
            else if (_photos.isEmpty)
              const Text('No photos saved for this transfer.', style: TextStyle(color: invexaMuted))
            else
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _photos.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 8, mainAxisSpacing: 8),
                itemBuilder: (context, index) {
                  final photo = _photos[index];
                  return GestureDetector(
                    onTap: () => _openPhoto(photo),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.memory(photo.bytes, fit: BoxFit.cover),
                    ),
                  );
                },
              ),
            if (controller.error != null) ...[
              const SizedBox(height: 16),
              Text(controller.error!, style: const TextStyle(color: invexaRose)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: controller.busy ? null : _confirmReceive,
              child: const Text('Confirm receipt'),
            ),
          ],
        ),
      ),
    );
  }
}

class _TransferLineTile extends StatelessWidget {
  const _TransferLineTile({
    required this.line,
    required this.items,
    required this.receivedQtyController,
    required this.damagedQtyController,
    this.decimal = false,
  });

  final TransferLine line;
  final List<CatalogItem> items;
  final TextEditingController receivedQtyController;
  final TextEditingController damagedQtyController;
  final bool decimal;

  @override
  Widget build(BuildContext context) {
    final name = lookupItemName(items, line.itemId);
    final lotNo = lookupLotNo(items, line.itemId, line.lotId);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    '${lotNo.isNotEmpty ? 'Lot $lotNo · ' : ''}Sent ${formatQty(line.quantity)}'
                    '${line.receivedQty > 0 ? ' · received ${formatQty(line.receivedQty)}' : ''}'
                    '${line.remaining <= 0 ? ' · complete' : ' · open ${formatQty(line.remaining)}'}',
                    style: const TextStyle(color: invexaMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
            if (line.remaining > 0) ...[
              SizedBox(
                width: 80,
                child: TextField(
                  controller: receivedQtyController,
                  keyboardType: TextInputType.numberWithOptions(decimal: decimal),
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(labelText: 'Received', isDense: true),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 72,
                child: TextField(
                  controller: damagedQtyController,
                  keyboardType: TextInputType.numberWithOptions(decimal: decimal),
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(labelText: 'Damaged', isDense: true),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TransferPhoto {
  const _TransferPhoto({required this.id, required this.fileName, required this.bytes});

  final String id;
  final String fileName;
  final Uint8List bytes;
}
