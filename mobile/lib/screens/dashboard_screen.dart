import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/pick_session.dart';
import '../state/session_controller.dart';
import 'count_screen.dart';
import 'expiry_detail_screen.dart';
import 'pick_screen.dart';
import 'putaway_screen.dart';
import 'transfers_screen.dart';

/// How urgent a tile's number is - drives the colour so the branch's state reads at a glance,
/// not just as a bare number (the same green/amber/red convention used elsewhere in the app).
enum TileSeverity { good, warn, bad, neutral }

Color _severityColor(TileSeverity severity) {
  switch (severity) {
    case TileSeverity.good:
      return invexaEmerald;
    case TileSeverity.warn:
      return invexaAmber;
    case TileSeverity.bad:
      return invexaRose;
    case TileSeverity.neutral:
      return invexaMuted;
  }
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard;
    final user = controller.user;
    final locationName = controller.selectedLocation?.name;

    return RefreshIndicator(
      color: invexaEmerald,
      onRefresh: controller.refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
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
                  ],
                ),
              ),
              if (locationName != null) _BranchChip(name: locationName),
            ],
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
            ..._liveActivitySection(context),
            const SizedBox(height: 20),
            const Text('Branch health', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(locationName == null ? 'Live counts for your assigned branches.' : 'Live counts for $locationName.', style: const TextStyle(color: invexaMuted, fontSize: 12)),
            const SizedBox(height: 10),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.25,
              children: [
                _MetricCard(
                  label: 'Pending counts', value: '${dashboard.pendingCounts}', icon: Icons.pending_actions_outlined,
                  severity: dashboard.pendingCounts > 0 ? TileSeverity.warn : TileSeverity.good,
                  onTap: () => _pushPage(context, 'Count', CountScreen(controller: controller)),
                ),
                _MetricCard(
                  label: 'Transfer requests', value: '${dashboard.transferRequests}', icon: Icons.swap_horiz,
                  severity: dashboard.transferRequests > 0 ? TileSeverity.warn : TileSeverity.good,
                  onTap: () => _pushPage(context, 'Transfers', TransfersScreen(controller: controller)),
                ),
                _MetricCard(
                  label: 'Expired lots', value: '${dashboard.expiredTillDate}', icon: Icons.event_busy_outlined,
                  severity: dashboard.expiredTillDate > 0 ? TileSeverity.bad : TileSeverity.good,
                  onTap: () => _push(context, ExpiryDetailScreen(controller: controller, expiredOnly: true)),
                ),
                _MetricCard(
                  label: 'Near expiry', value: '${dashboard.nearExpiryThisMonth}', icon: Icons.schedule_outlined,
                  severity: dashboard.nearExpiryThisMonth > 0 ? TileSeverity.warn : TileSeverity.good,
                  onTap: () => _push(context, ExpiryDetailScreen(controller: controller, expiredOnly: false)),
                ),
                _MetricCard(
                  label: 'Count completion', value: '${dashboard.countCompletionPercent.round()}%', icon: Icons.task_alt_outlined,
                  severity: _percentSeverity(dashboard.countCompletionPercent),
                ),
                _MetricCard(
                  label: 'Stock accuracy', value: '${dashboard.stockAccuracyPercent.round()}%', icon: Icons.verified_outlined,
                  severity: _percentSeverity(dashboard.stockAccuracyPercent),
                ),
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

  /// Role-aware "what's actually happening right now" tiles, built from data the session already
  /// has loaded (no extra network round trip to show them). Every role sees the same card format -
  /// only which tiles appear, and what they count, differs by what that role's work actually is.
  List<Widget> _liveActivitySection(BuildContext context) {
    final role = controller.user?.role;
    final tiles = <Widget>[];
    if (role == 'WAREHOUSE_PICKER') {
      final openPicks = openPickTransfers(controller.transfers).length;
      tiles.add(_ActivityTile(
        label: 'Pick tasks open', value: openPicks, icon: Icons.local_shipping_outlined,
        severity: openPicks > 0 ? TileSeverity.warn : TileSeverity.good,
        onTap: () => _pushPage(context, 'Pick', PickScreen(controller: controller)),
      ));
      final putawayOpen = controller.putawayTasks.length;
      tiles.add(_ActivityTile(
        label: 'Putaway tasks', value: putawayOpen, icon: Icons.inventory_2_outlined,
        severity: putawayOpen > 0 ? TileSeverity.warn : TileSeverity.good,
        onTap: () => _pushPage(context, 'Putaway', PutawayScreen(controller: controller)),
      ));
    }
    if (controller.isBlindCountWorker) {
      final batchKeys = controller.assignments.where((row) => row.status == null || row.status == 'ASSIGNED').map((row) => row.batchKey).toSet();
      tiles.add(_ActivityTile(
        label: 'Count batches open', value: batchKeys.length, icon: Icons.fact_check_outlined,
        severity: batchKeys.isNotEmpty ? TileSeverity.warn : TileSeverity.good,
        onTap: () => _pushPage(context, 'Count', CountScreen(controller: controller)),
      ));
    }
    final transfersInScope = controller.transfers.length;
    tiles.add(_ActivityTile(
      label: 'Transfers in scope', value: transfersInScope, icon: Icons.swap_horiz,
      severity: TileSeverity.neutral,
      onTap: () => _pushPage(context, 'Transfers', TransfersScreen(controller: controller)),
    ));
    if (tiles.isEmpty) return const [];
    return [
      const Text('Live activity', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      SizedBox(
        height: 92,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: tiles.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (context, index) => tiles[index],
        ),
      ),
    ];
  }

  TileSeverity _percentSeverity(double percent) {
    if (percent >= 90) return TileSeverity.good;
    if (percent >= 70) return TileSeverity.warn;
    return TileSeverity.bad;
  }

  /// Count, Transfers, Pick and Putaway are tab bodies with no Scaffold of their own. Pushed bare they
  /// draw on the route's black background with no Material (text with yellow underlines, no back button).
  void _pushPage(BuildContext context, String title, Widget body) {
    _push(context, Scaffold(appBar: AppBar(title: Text(title)), body: body));
  }

  void _push(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }

  String _roleLabel(String role) {
    return role.replaceAll('_', ' ').toLowerCase().replaceFirstMapped(
      RegExp(r'^[a-z]'),
      (match) => match.group(0)!.toUpperCase(),
    );
  }
}

class _BranchChip extends StatelessWidget {
  const _BranchChip({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: invexaEmerald.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.storefront_outlined, size: 14, color: invexaEmerald),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 120),
            child: Text(name, style: const TextStyle(color: invexaEmerald, fontWeight: FontWeight.w700, fontSize: 12), overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value, required this.icon, required this.severity, this.onTap});

  final String label;
  final String value;
  final IconData icon;
  final TileSeverity severity;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = _severityColor(severity);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: color),
                  const Spacer(),
                  if (onTap != null) const Icon(Icons.chevron_right, size: 18, color: invexaMuted),
                ],
              ),
              const Spacer(),
              Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: invexaInk)),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(fontSize: 12, color: invexaMuted)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.label, required this.value, required this.icon, required this.severity, required this.onTap});

  final String label;
  final int value;
  final IconData icon;
  final TileSeverity severity;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _severityColor(severity);
    return Material(
      color: invexaCard,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          width: 150,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: invexaBorder)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(children: [Icon(icon, size: 18, color: color), const Spacer(), Text('$value', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: color))]),
              Text(label, style: const TextStyle(fontSize: 12, color: invexaMuted), maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ),
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
          '${lookupLocationName(controller.locations, item.locationId)} · qty ${formatQty(item.physicalQuantity)}${item.mode == 'weight' ? ' (weight)' : ''}'
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
