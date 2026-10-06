import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../config/theme.dart';
import '../services/scan_feedback.dart';

/// Opens a full-screen camera scanner and returns the first decoded
/// barcode value, or null if the user backs out or types it manually.
/// A single reusable entry point so every "scan" action in the app uses
/// the same real camera component instead of a bare text field.
Future<String?> showBarcodeScanner(BuildContext context, {String title = 'Scan barcode'}) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute(builder: (_) => _BarcodeScanScreen(title: title)),
  );
}

class _BarcodeScanScreen extends StatefulWidget {
  const _BarcodeScanScreen({required this.title});

  final String title;

  @override
  State<_BarcodeScanScreen> createState() => _BarcodeScanScreenState();
}

class _BarcodeScanScreenState extends State<_BarcodeScanScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  final _manualCode = TextEditingController();
  bool _handled = false;
  String? _cameraError;

  @override
  void dispose() {
    _controller.dispose();
    _manualCode.dispose();
    super.dispose();
  }

  void _accept(String code) {
    if (_handled || code.trim().isEmpty) return;
    _handled = true;
    ScanFeedback.accepted();
    Navigator.of(context).pop(code.trim());
  }

  void _onDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue;
      if (value != null && value.isNotEmpty) {
        _accept(value);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(widget.title),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: ValueListenableBuilder(
              valueListenable: _controller,
              builder: (context, state, child) => Icon(
                state.torchState == TorchState.on ? Icons.flash_on : Icons.flash_off,
              ),
            ),
            onPressed: () => _controller.toggleTorch(),
          ),
          IconButton(
            icon: const Icon(Icons.cameraswitch),
            onPressed: () => _controller.switchCamera(),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: _onDetect,
                  errorBuilder: (context, error) {
                    _cameraError = error.errorDetails?.message ?? error.errorCode.name;
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'Camera unavailable: $_cameraError\nType the code below instead.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
                    );
                  },
                ),
                if (_cameraError == null)
                  Center(
                    child: Container(
                      width: 240,
                      height: 240,
                      decoration: BoxDecoration(
                        border: Border.all(color: invexaEmerald, width: 3),
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Container(
            color: Colors.black,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _manualCode,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      hintText: 'Or type the code manually',
                      hintStyle: TextStyle(color: invexaMuted),
                      enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: invexaMuted)),
                      focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: invexaEmerald)),
                    ),
                    onSubmitted: _accept,
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: () => _accept(_manualCode.text),
                  child: const Text('Use'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
