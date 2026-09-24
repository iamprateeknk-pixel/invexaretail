import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

/// Channel orders in the caller's scope (read-only). The Orders destination
/// used to open the Transfers list by mistake; this shows real orders from
/// `GET /api/v1/orders`.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  late Future<List<Map<String, dynamic>>> _orders = _load();

  Future<List<Map<String, dynamic>>> _load() async {
    final payload = await widget.controller.api.sendRaw('GET', '/api/v1/orders');
    return asList(payload['orders']).map(asMap).toList();
  }

  Future<void> _refresh() async {
    setState(() => _orders = _load());
    await _orders.catchError((_) => <Map<String, dynamic>>[]);
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: _refresh,
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _orders,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return ListView(children: const [Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))]);
          }
          if (snapshot.hasError) {
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const Text('Orders could not be loaded.', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Text('${snapshot.error}', style: const TextStyle(color: invexaMuted)),
                const SizedBox(height: 16),
                FilledButton(onPressed: _refresh, child: const Text('Retry')),
              ],
            );
          }
          final orders = snapshot.data ?? const [];
          if (orders.isEmpty) {
            return ListView(children: const [
              Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Text('No orders in scope.', textAlign: TextAlign.center, style: TextStyle(color: invexaMuted)),
              ),
            ]);
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              for (final order in orders)
                Card(
                  child: ListTile(
                    title: Text('${asString(order['channel'], 'Order')} · ${asString(order['externalId'] ?? order['id'])}'),
                    subtitle: Text('${asList(order['lines']).length} line(s)'),
                    trailing: Text(
                      asString(order['status']).replaceAll('_', ' '),
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: invexaEmerald),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
