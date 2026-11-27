import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../config/platform_caps.dart';
import '../config/theme.dart';
import '../services/scan_feedback.dart';

/// Opens a full-screen camera scanner and returns the first decoded
/// barcode value, or null if the user backs out or types it manually.
/// A single reusable entry point so every "scan" action in the app uses
/// the same real camera component instead of a bare text field.
/// On a platform without a camera scanner (Windows), the same entry point opens
/// a focused input instead: a USB/Bluetooth scanner types the code and Enter.
Future<String?> showBarcodeScanner(BuildContext context, {String title = 'Scan barcode'}) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute(
      builder: (_) => PlatformCaps.hasCameraScanner ? _BarcodeScanScreen(title: title) : KeyboardScanScreen(title: title),
    ),
  );
}

/// Scanner screen for keyboard-wedge scanners and typed codes. The field is
/// focused on open, so the first scan lands without a click.
class KeyboardScanScreen extends StatefulWidget {
  const KeyboardScanScreen({super.key, required this.title});

  final String title;

  @override
  State<KeyboardScanScreen> createState() => _KeyboardScanScreenState();
}

class _KeyboardScanScreenState extends State<KeyboardScanScreen> {
  final _code = TextEditingController();
  bool _handled = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _accept(String value) {
    final code = value.trim();
    if (_handled || code.isEmpty) return;
    _handled = true;
    ScanFeedback.accepted();
    Navigator.of(context).pop(code);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.qr_code_scanner, size: 56, color: invexaEmerald),
                const SizedBox(height: 16),
                const Text(
                  'Scan with your barcode scanner, or type the code and press Enter.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16),
                ),
                const SizedBox(height: 20),
                TextField(
                  key: const ValueKey('keyboard-scan-field'),
                  controller: _code,
                  autofocus: true,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(
                    labelText: 'Barcode, item code or lot',
                    prefixIcon: Icon(Icons.qr_code_2),
                  ),
                  onSubmitted: _accept,
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => _accept(_code.text),
                    child: const Text('Use code'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
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
