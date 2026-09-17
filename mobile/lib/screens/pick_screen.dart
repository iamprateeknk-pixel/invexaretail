import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class PickScreen extends StatelessWidget {
  const PickScreen({super.key, required this.controller});

  final SessionController controller;

  Future<void> _pick(TransferRecord transfer) async {
    final lines = transfer.lines
        .map((line) => {
              'itemId': line.itemId,
              'lotId': line.lotId,
              'quantity': line.quantity,
              'inputMethod': 'SCAN',
              'scanCode': line.lotId,
            })
        .toList();
    await controller.runOrQueue(
      type: 'PICK',
      method: 'POST',
      path: '/api/v1/picker/transfers/${transfer.id}/pick-slips',
      body: {'lines': lines, 'exceptions': <Map<String, dynamic>>[]},
    );
  }

  @override
  Widget build(BuildContext context) {
    final picks = controller.transfers.where((row) {
      final status = row.status.toUpperCase();
      return status.contains('PICK') || status == 'REQUESTED';
    }).toList();

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Scan-first picking. Confirm a slip only after the bin walk. Offline picks queue until the API is back.',
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
              return Card(
                child: ListTile(
                  title: Text(lookupItemName(controller.items, transfer.lines.isEmpty ? '' : transfer.lines.first.itemId)),
                  subtitle: Text('${transfer.status} · qty ${transfer.totalQuantity}'),
                  trailing: TextButton(
                    onPressed: controller.busy ? null : () => _pick(transfer),
                    child: const Text('Pick'),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
