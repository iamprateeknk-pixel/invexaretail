import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class ReceiveScreen extends StatelessWidget {
  const ReceiveScreen({super.key, required this.controller});

  final SessionController controller;

  Future<void> _receive(TransferRecord transfer) async {
    final locationId = controller.selectedLocationId;
    final lines = transfer.lines
        .map((line) => {
              'itemId': line.itemId,
              'lotId': line.lotId,
              'receivedQty': line.quantity,
              'damagedQty': 0,
              'shortageQty': 0,
              'excessQty': 0,
            })
        .toList();
    await controller.runOrQueue(
      type: 'TRANSFER_RECEIVE',
      method: 'POST',
      path: '/api/v1/transfers/${transfer.id}/receive',
      body: {
        'requestId': 'mobile-${DateTime.now().microsecondsSinceEpoch}',
        'lines': lines,
        if (locationId != null) 'locationId': locationId,
      },
    );
  }

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
            'Receive inbound transfers for this branch. Offline receipts wait in the action queue.',
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
              return Card(
                child: ListTile(
                  title: Text(lookupItemName(controller.items, transfer.lines.isEmpty ? '' : transfer.lines.first.itemId)),
                  subtitle: Text('$from · qty ${transfer.totalQuantity} · ${transfer.status}'),
                  trailing: TextButton(
                    onPressed: controller.busy ? null : () => _receive(transfer),
                    child: const Text('Receive'),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
