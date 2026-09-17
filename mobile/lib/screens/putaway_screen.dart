import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../state/session_controller.dart';

class PutawayScreen extends StatefulWidget {
  const PutawayScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<PutawayScreen> createState() => _PutawayScreenState();
}

class _PutawayScreenState extends State<PutawayScreen> {
  final _scan = TextEditingController();

  @override
  void dispose() {
    _scan.dispose();
    super.dispose();
  }

  Future<void> _confirm(Map<String, dynamic> task) async {
    final scanned = _scan.text.trim();
    if (scanned.isEmpty) {
      widget.controller.setError('Scan the destination bin before confirming putaway.');
      return;
    }
    await widget.controller.runOrQueue(
      type: 'PUTAWAY',
      method: 'POST',
      path: '/api/v1/putaway-tasks/${task['id']}/confirm',
      body: {'scannedBinCode': scanned, 'requireScan': true},
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            'Warehouse putaway is scan-first. A wrong bin is blocked unless a supervisor overrides on web.',
            style: TextStyle(color: invexaMuted),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _scan,
            decoration: const InputDecoration(labelText: 'Scan bin barcode'),
          ),
          const SizedBox(height: 16),
          if (controller.putawayTasks.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Text('Nothing waiting to put away.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted)),
            )
          else
            ...controller.putawayTasks.map((task) {
              final item = task['item'] is Map ? Map<String, dynamic>.from(task['item'] as Map) : <String, dynamic>{};
              final suggested = task['suggestedBin'] is Map ? Map<String, dynamic>.from(task['suggestedBin'] as Map) : <String, dynamic>{};
              return Card(
                child: ListTile(
                  title: Text('${item['code'] ?? task['itemId']} · qty ${task['quantity']}'),
                  subtitle: Text('Suggested ${suggested['code'] ?? 'no bin'}'),
                  trailing: TextButton(
                    onPressed: controller.busy ? null : () => _confirm(task),
                    child: const Text('Confirm'),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
