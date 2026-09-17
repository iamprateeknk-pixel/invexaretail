import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class ReceiveScreen extends StatelessWidget {
  const ReceiveScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    final inbound = controller.transfers.where((row) {
      final status = row.status.toUpperCase();
      return status.contains('TRANSIT') || status.contains('DISPATCH') || status.contains('PARTIAL');
    }).toList();

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Tap a transfer to open the full document - items, quantities and photos - before confirming receipt.',
            style: TextStyle(color: invexaMuted),
          ),
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
              return Card(
                child: ListTile(
                  title: Text('$from · $itemCount item${itemCount == 1 ? '' : 's'}'),
                  subtitle: Text('Qty ${transfer.totalQuantity} · ${transfer.status}'),
                  trailing: const Icon(Icons.chevron_right, color: invexaMuted),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => TransferDetailScreen(transfer: transfer, controller: controller)),
                  ),
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
  bool _loadingPhotos = true;
  String? _photoError;
  List<_TransferPhoto> _photos = [];

  TransferRecord get _transfer => widget.transfer;
  SessionController get _controller => widget.controller;

  @override
  void initState() {
    super.initState();
    _receivedQty = _transfer.lines.map((line) => TextEditingController(text: '${line.quantity}')).toList();
    _loadPhotos();
  }

  @override
  void dispose() {
    for (final c in _receivedQty) {
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

  Future<void> _confirmReceive() async {
    final lines = <Map<String, dynamic>>[];
    for (var i = 0; i < _transfer.lines.length; i++) {
      final line = _transfer.lines[i];
      final qty = int.tryParse(_receivedQty[i].text.trim());
      if (qty == null || qty < 0) {
        _controller.setError('Enter a valid received quantity for every line.');
        return;
      }
      lines.add({
        'itemId': line.itemId,
        'lotId': line.lotId,
        'receivedQty': qty,
        'damagedQty': 0,
        'shortageQty': 0,
        'excessQty': 0,
      });
    }
    final ok = await _controller.runOrQueue(
      type: 'TRANSFER_RECEIVE',
      method: 'POST',
      path: '/api/v1/transfers/${_transfer.id}/receive',
      body: {
        'requestId': 'mobile-${DateTime.now().microsecondsSinceEpoch}',
        'lines': lines,
        if (_controller.selectedLocationId != null) 'locationId': _controller.selectedLocationId,
      },
    );
    if (ok && mounted) Navigator.of(context).pop();
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
              ),
              const SizedBox(height: 8),
            ],
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
  const _TransferLineTile({required this.line, required this.items, required this.receivedQtyController});

  final TransferLine line;
  final List<CatalogItem> items;
  final TextEditingController receivedQtyController;

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
                    '${lotNo.isNotEmpty ? 'Lot $lotNo · ' : ''}Ordered ${line.quantity}',
                    style: const TextStyle(color: invexaMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 90,
              child: TextField(
                controller: receivedQtyController,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(labelText: 'Received', isDense: true),
              ),
            ),
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
