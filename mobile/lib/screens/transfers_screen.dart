import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class TransfersScreen extends StatelessWidget {
  const TransfersScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Transfers stay on the pick → confirm → dispatch → receive path.',
            style: TextStyle(color: invexaMuted),
          ),
          const SizedBox(height: 16),
          if (controller.transfers.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Text('No transfers in scope.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted)),
            )
          else
            ...controller.transfers.map((transfer) {
              final from = lookupLocationName(controller.locations, transfer.sourceLocationId);
              final to = lookupLocationName(controller.locations, transfer.destinationLocationId);
              final firstItem = transfer.lines.isEmpty
                  ? 'No lines'
                  : lookupItemName(controller.items, transfer.lines.first.itemId);
              return Card(
                child: ListTile(
                  title: Text(firstItem),
                  subtitle: Text(
                    '$from → $to · qty ${transfer.totalQuantity}'
                    '${transfer.cartonCount == null ? '' : ' · cartons ${transfer.cartonCount}'}',
                  ),
                  trailing: Text(
                    transfer.status.replaceAll('_', ' '),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: invexaEmerald),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
