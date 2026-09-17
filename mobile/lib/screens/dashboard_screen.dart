import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../state/session_controller.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard;
    final user = controller.user;

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(
            user == null ? 'Operations' : 'Hello, ${user.name}',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: invexaInk),
          ),
          const SizedBox(height: 4),
          Text(
            user == null ? '' : _roleLabel(user.role),
            style: const TextStyle(color: invexaMuted),
          ),
          if (controller.notice != null) ...[
            const SizedBox(height: 12),
            _Banner(text: controller.notice!, tone: invexaEmerald),
          ],
          if (controller.error != null) ...[
            const SizedBox(height: 12),
            _Banner(text: controller.error!, tone: invexaRose),
          ],
          const SizedBox(height: 16),
          if (dashboard == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else ...[
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.35,
              children: [
                _MetricCard(label: 'Pending counts', value: '${dashboard.pendingCounts}', icon: Icons.pending_actions_outlined),
                _MetricCard(label: 'Transfer requests', value: '${dashboard.transferRequests}', icon: Icons.swap_horiz),
                _MetricCard(label: 'Expired lots', value: '${dashboard.expiredTillDate}', icon: Icons.event_busy_outlined),
                _MetricCard(label: 'Near expiry', value: '${dashboard.nearExpiryThisMonth}', icon: Icons.schedule_outlined),
                _MetricCard(label: 'Count completion', value: '${dashboard.countCompletionPercent}%', icon: Icons.task_alt_outlined),
                _MetricCard(label: 'Stock accuracy', value: '${dashboard.stockAccuracyPercent}%', icon: Icons.verified_outlined),
              ],
            ),
            const SizedBox(height: 20),
            const Text('Queued counts', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            if (controller.queuedCounts.isEmpty)
              const Text('No offline counts waiting to sync.', style: TextStyle(color: invexaMuted))
            else
              ...controller.queuedCounts.map((item) => _QueueTile(controller: controller, item: item)),
            if (controller.queuedActions.isNotEmpty) ...[
              const SizedBox(height: 20),
              const Text('Queued actions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              ...controller.queuedActions.map((item) => _QueuedActionTile(controller: controller, item: item)),
            ],
          ],
        ],
      ),
    );
  }

  String _roleLabel(String role) {
    return role.replaceAll('_', ' ').toLowerCase().replaceFirstMapped(
      RegExp(r'^[a-z]'),
      (match) => match.group(0)!.toUpperCase(),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value, required this.icon});

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: invexaEmerald),
            const Spacer(),
            Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: invexaInk)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(fontSize: 12, color: invexaMuted)),
          ],
        ),
      ),
    );
  }
}

class _QueueTile extends StatelessWidget {
  const _QueueTile({required this.controller, required this.item});

  final SessionController controller;
  final QueuedCount item;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(lookupItemName(controller.items, item.itemId))),
            if (item.status != 'pending') ...[const SizedBox(width: 8), _SyncStatusBadge(status: item.status)],
          ],
        ),
        subtitle: Text(
          '${lookupLocationName(controller.locations, item.locationId)} · qty ${item.physicalQuantity}'
          '${item.lastError == null ? '' : '\n${item.lastError}'}',
        ),
        isThreeLine: item.lastError != null,
        trailing: item.status == 'pending'
            ? IconButton(
                tooltip: 'Remove from queue',
                onPressed: () => controller.dismissQueued(item.localId),
                icon: const Icon(Icons.close),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Retry',
                    onPressed: () => controller.retryQueuedCount(item.localId),
                    icon: const Icon(Icons.refresh),
                  ),
                  IconButton(
                    tooltip: 'Discard',
                    onPressed: () => controller.dismissQueued(item.localId),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
      ),
    );
  }
}

class _QueuedActionTile extends StatelessWidget {
  const _QueuedActionTile({required this.controller, required this.item});

  final SessionController controller;
  final QueuedAction item;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(item.type)),
            if (item.status != 'pending') ...[const SizedBox(width: 8), _SyncStatusBadge(status: item.status)],
          ],
        ),
        subtitle: item.lastError == null ? null : Text(item.lastError!),
        trailing: item.status == 'pending'
            ? IconButton(
                tooltip: 'Remove from queue',
                onPressed: () => controller.dismissQueuedAction(item.localId),
                icon: const Icon(Icons.close),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Retry',
                    onPressed: () => controller.retryQueuedAction(item.localId),
                    icon: const Icon(Icons.refresh),
                  ),
                  IconButton(
                    tooltip: 'Discard',
                    onPressed: () => controller.dismissQueuedAction(item.localId),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
      ),
    );
  }
}

class _SyncStatusBadge extends StatelessWidget {
  const _SyncStatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final isConflict = status == 'conflict';
    final color = isConflict ? invexaAmber : invexaRose;
    final label = isConflict ? 'Conflict' : 'Rejected';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.tone});

  final String text;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tone.withValues(alpha: 0.3)),
      ),
      child: Text(text, style: TextStyle(color: tone, fontWeight: FontWeight.w600)),
    );
  }
}
