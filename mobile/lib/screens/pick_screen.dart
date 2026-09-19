import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/pick_session.dart';
import '../services/scan_feedback.dart';
import '../state/session_controller.dart';
import '../widgets/barcode_scan_sheet.dart';

/// Pick tasks for the warehouse. Each one opens a real pick: scan pieces one by
/// one, enter a weight for loose KG (the server chooses the lots), report a
/// problem with a reason, save progress or finish. Blueprint v4 §15.
class PickScreen extends StatelessWidget {
  const PickScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    final picks = controller.transfers.where((row) {
      final status = row.status.toUpperCase();
      return status.contains('PICK') || status == 'REQUESTED' || status == 'PARTIAL';
    }).toList();

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Open a task, then scan each piece. Loose KG: enter the weight and the lots are chosen for you. Saved work is kept if you close the app.',
            style: TextStyle(color: invexaMuted),
          ),
          const SizedBox(height: 16),
          if (picks.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Text('No pick tasks.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted)),
            )
          else
            ...picks.map((transfer) {
              final to = lookupLocationName(controller.locations, transfer.destinationLocationId);
              return Card(
                child: ListTile(
                  title: Text('To $to · ${transfer.lines.length} item${transfer.lines.length == 1 ? '' : 's'}'),
                  subtitle: Text('${transfer.status} · qty ${formatQty(transfer.totalQuantity)}'),
                  trailing: const Icon(Icons.chevron_right, color: invexaMuted),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => PickDetailScreen(transferId: transfer.id, controller: controller)),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class PickDetailScreen extends StatefulWidget {
  const PickDetailScreen({super.key, required this.transferId, required this.controller});

  final String transferId;
  final SessionController controller;

  @override
  State<PickDetailScreen> createState() => _PickDetailScreenState();
}

class _PickDetailScreenState extends State<PickDetailScreen> {
  PickSession? _session;
  String? _error;
  String _message = '';
  bool _busy = false;
  // One key per slip being built: a retry after a timeout carries the same one.
  String _requestId = newRequestId();
  final Map<String, TextEditingController> _weights = {};
  final Map<String, List<Map<String, dynamic>>> _previews = {};

  SessionController get _controller => widget.controller;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final field in _weights.values) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final payload = await _controller.api.pickerTransfer(widget.transferId);
      if (!mounted) return;
      setState(() {
        _session = PickSession.fromServer(payload);
        _error = null;
      });
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _scanPiece() async {
    final session = _session;
    if (session == null) return;
    final code = await showBarcodeScanner(context, title: 'Scan item or lot');
    if (code == null || !mounted) return;
    final result = session.scan(code);
    result.accepted ? await ScanFeedback.accepted() : await ScanFeedback.rejected();
    setState(() => _message = result.message);
  }

  Future<void> _previewWeight(PickLine line) async {
    final session = _session!;
    final kg = double.tryParse(_weights[line.itemId]?.text.trim() ?? '');
    if (kg == null || kg <= 0) {
      setState(() => _message = 'Enter a weight first.');
      return;
    }
    final result = session.setWeight(line.itemId, kg);
    if (!result.accepted) {
      await ScanFeedback.rejected();
      setState(() => _message = result.message);
      return;
    }
    try {
      final allocations = await _controller.api.allocationPreview(widget.transferId, line.itemId, kg);
      await ScanFeedback.accepted();
      if (!mounted) return;
      setState(() {
        _previews[line.itemId] = allocations;
        _message = result.message;
      });
    } on ApiException catch (err) {
      session.setWeight(line.itemId, 0);
      await ScanFeedback.rejected();
      if (mounted) setState(() => _message = err.message);
    }
  }

  Future<void> _report(PickLine line) async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final entry in pickReasons.entries) ListTile(title: Text(entry.value), onTap: () => Navigator.of(context).pop(entry.key)),
          ],
        ),
      ),
    );
    if (reason == null || !mounted) return;
    final left = _session!.leftFor(line.itemId);
    if (left <= 0) return;
    setState(() {
      _session!.report(line.itemId, reason, left);
      _message = '${line.itemName}: reported as ${pickReasons[reason]!.toLowerCase()}.';
    });
  }

  Future<void> _save({required bool finished}) async {
    final session = _session!;
    if (!session.hasPending && !finished) return;
    setState(() => _busy = true);
    final ok = await _controller.runOrQueue(
      type: 'PICK',
      method: 'POST',
      path: '/api/v1/picker/transfers/${widget.transferId}/pick-slips',
      body: session.slipBody(requestId: _requestId, finished: finished),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok) {
      await ScanFeedback.rejected();
      return;
    }
    await ScanFeedback.saved();
    _requestId = newRequestId();
    session.clearPending();
    _previews.clear();
    for (final field in _weights.values) {
      field.clear();
    }
    if (finished && mounted) {
      Navigator.of(context).pop();
      return;
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    return Scaffold(
      appBar: AppBar(title: Text('Pick ${widget.transferId}')),
      body: session == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Padding(padding: const EdgeInsets.all(24), child: Text(_error!, style: const TextStyle(color: invexaRose))))
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                if (_message.isNotEmpty)
                  Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_message, style: const TextStyle(fontWeight: FontWeight.w600))),
                if (_controller.error != null)
                  Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_controller.error!, style: const TextStyle(color: invexaRose))),
                if (session.lines.isEmpty)
                  const Padding(padding: EdgeInsets.symmetric(vertical: 40), child: Text('Everything on this task is picked.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted))),
                for (final line in session.lines) _lineCard(session, line),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const ValueKey('pick-save'),
                        onPressed: _busy || !session.hasPending ? null : () => _save(finished: false),
                        child: const Text('Save progress'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        key: const ValueKey('pick-finish'),
                        onPressed: _busy ? null : () => _save(finished: true),
                        child: const Text('Finish pick'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _lineCard(PickSession session, PickLine line) {
    final left = session.leftFor(line.itemId);
    final unit = line.pooled ? ' ${line.unit}' : '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(line.itemName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            Text(
              [
                line.itemCode,
                if (!line.pooled) 'Lots ${line.lots.map((lot) => lot.lotNo).join(', ')}',
              ].where((part) => part.isNotEmpty).join(' · '),
              style: const TextStyle(color: invexaMuted, fontSize: 12),
            ),
            const SizedBox(height: 8),
            Text('${formatQty(left < 0 ? 0 : left)}$unit left of ${formatQty(line.remaining)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            if (line.pooled) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      key: ValueKey('pick-weight-${line.itemId}'),
                      controller: _weights.putIfAbsent(line.itemId, () => TextEditingController()),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(labelText: 'Weight (${line.unit})', helperText: 'Lots are chosen for you.'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.tonal(onPressed: () => _previewWeight(line), child: const Text('Preview')),
                ],
              ),
              for (final row in _previews[line.itemId] ?? const <Map<String, dynamic>>[])
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('Take ${formatQty(asDouble(row['quantity']))} ${line.unit} from lot ${row['lotNo']}${row['expiryDate'] == null ? '' : ' (exp ${asString(row['expiryDate']).split('T').first})'}'),
                ),
            ] else
              Row(
                children: [
                  FilledButton.tonalIcon(key: ValueKey('pick-scan-${line.itemId}'), onPressed: _scanPiece, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan')),
                  const SizedBox(width: 8),
                  Text('${formatQty(session.scannedFor(line.itemId))} scanned'),
                  const Spacer(),
                  IconButton(tooltip: 'Undo last scan', onPressed: session.scannedFor(line.itemId) > 0 ? () => setState(() => session.undoScan(line.itemId)) : null, icon: const Icon(Icons.undo)),
                ],
              ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: left > 0 ? () => _report(line) : null, child: const Text('Report a problem')),
            ),
          ],
        ),
      ),
    );
  }
}
