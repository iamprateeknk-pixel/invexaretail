import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../state/session_controller.dart';
import '../widgets/barcode_scan_sheet.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _waveId = TextEditingController();
  final _bin = TextEditingController();
  int _index = 0;
  String? _walkHint;

  @override
  void dispose() {
    _waveId.dispose();
    _bin.dispose();
    super.dispose();
  }

  Future<void> _scanBin() async {
    final code = await showBarcodeScanner(context, title: 'Scan bin barcode');
    if (code == null || !mounted) return;
    setState(() => _bin.text = code);
    await _scan();
  }

  Future<void> _scan() async {
    final waveId = _waveId.text.trim();
    final scanned = _bin.text.trim();
    if (waveId.isEmpty || scanned.isEmpty) {
      widget.controller.setError('Scan the next bin in the guided walk.');
      return;
    }
    try {
      final result = await widget.controller.api.scanPickWave(
        waveId: waveId,
        scannedBinCode: scanned,
        scannedIndex: _index,
      );
      setState(() {
        _index = (result['scannedIndex'] as num?)?.toInt() ?? _index + 1;
        _walkHint = result['nextBin'] == null ? 'Walk complete.' : 'Next bin ${result['nextBin']}';
      });
      widget.controller.setNotice('Bin accepted.');
    } catch (err) {
      widget.controller.setError(err.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        const Text(
          'Guided bin walk. Scanning ahead or the wrong bin is blocked.',
          style: TextStyle(color: invexaMuted),
        ),
        const SizedBox(height: 16),
        TextField(controller: _waveId, decoration: const InputDecoration(labelText: 'Pick wave id')),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(controller: _bin, decoration: const InputDecoration(labelText: 'Scan next bin')),
            ),
            const SizedBox(width: 8),
            IconButton.filledTonal(
              tooltip: 'Scan bin barcode',
              icon: const Icon(Icons.qr_code_scanner),
              onPressed: _scanBin,
            ),
          ],
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: _scan, child: const Text('Confirm scan')),
        if (_walkHint != null) ...[
          const SizedBox(height: 12),
          Text(_walkHint!, style: const TextStyle(color: invexaEmerald, fontWeight: FontWeight.w600)),
        ],
      ],
    );
  }
}
