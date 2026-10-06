import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/sync_display.dart';
import '../state/session_controller.dart';

/// Blueprint v4 §38 Conflict Center: everything the phone could not sync on
/// its own, with the reason and an explicit Retry or Discard. Nothing here is
/// ever resubmitted silently, and nothing is dropped without the user saying so.
class ConflictCenterScreen extends StatelessWidget {
  const ConflictCenterScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final counts = controller.queuedCounts;
        final actions = controller.queuedActions;
        final needsAttention = [
          ...counts.where((row) => row.status != 'pending').map((row) => _Entry.count(row)),
          ...actions.where((row) => row.status != 'pending').map((row) => _Entry.action(row)),
        ];
        final waiting = [
          ...counts.where((row) => row.status == 'pending').map((row) => _Entry.count(row)),
          ...actions.where((row) => row.status == 'pending').map((row) => _Entry.action(row)),
        ];
        return Scaffold(
          appBar: AppBar(
            title: const Text('Sync center'),
            actions: [
              IconButton(
                tooltip: 'Sync now',
                onPressed: waiting.isEmpty && needsAttention.isEmpty ? null : controller.flushQueue,
                icon: const Icon(Icons.sync),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              if (needsAttention.isEmpty && waiting.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Column(
                    children: [
                      Icon(Icons.cloud_done_outlined, size: 40, color: invexaEmerald),
                      SizedBox(height: 8),
                      Text('Everything is synced.', style: TextStyle(color: invexaMuted)),
                    ],
                  ),
                ),
              if (needsAttention.isNotEmpty) ...[
                Text('Needs your decision (${needsAttention.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text(
                  'The server did not accept these. Retry sends the same request again; Discard removes it from this phone.',
                  style: TextStyle(color: invexaMuted, fontSize: 12),
                ),
                const SizedBox(height: 8),
                if (needsAttention.length > 1)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      key: const ValueKey('retry-all'),
                      onPressed: () async {
                        for (final entry in needsAttention) {
                          if (entry.count != null) {
                            await controller.retryQueuedCount(entry.localId);
                          } else {
                            await controller.retryQueuedAction(entry.localId);
                          }
                        }
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry all'),
                    ),
                  ),
                for (final entry in needsAttention) _EntryCard(controller: controller, entry: entry),
              ],
              if (waiting.isNotEmpty) ...[
                const SizedBox(height: 20),
                Text('Waiting for connection (${waiting.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('These send automatically when the phone is online.', style: TextStyle(color: invexaMuted, fontSize: 12)),
                const SizedBox(height: 8),
                for (final entry in waiting) _EntryCard(controller: controller, entry: entry),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// One queued mutation, whichever queue it lives in.
class _Entry {
  _Entry.count(QueuedCount this.count) : action = null;
  _Entry.action(QueuedAction this.action) : count = null;

  final QueuedCount? count;
  final QueuedAction? action;

  String get localId => count != null ? count!.localId : action!.localId;
  String get status => count != null ? count!.status : action!.status;
  String? get lastError => count != null ? count!.lastError : action!.lastError;
  int get attempts => count != null ? count!.attempts : action!.attempts;
  String get createdAt => count != null ? count!.createdAt : action!.createdAt;
}

/// What the status means in plain words, and what the user can do about it.
String syncReason(String status) {
  switch (status) {
    case 'conflict':
      return 'Conflict: the data changed on the server after you saved this. Check the current state, then retry or discard.';
    case 'rejected':
      return 'Rejected: the server will not accept this as it is (for example the task was cancelled or access changed). Discard it, then redo the work if it is still needed.';
    default:
      return 'Saved on this phone, waiting to sync.';
  }
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.controller, required this.entry});

  final SessionController controller;
  final _Entry entry;

  Future<void> _confirmDiscard(BuildContext context, String title, bool isCount) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Discard this?'),
        content: Text('"$title" is saved only on this phone. Discarding removes it permanently; you would need to redo the work.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Keep')),
          FilledButton(
            key: const ValueKey('confirm-discard'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    if (isCount) {
      await controller.dismissQueued(entry.localId);
    } else {
      await controller.dismissQueuedAction(entry.localId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final count = entry.count;
    final title = count != null
        ? '${lookupItemName(controller.items, count.itemId)} · ${count.mode == 'weight' ? 'weight ' : 'qty '}${formatQty(count.physicalQuantity)}'
        : queuedActionLabel(entry.action!.type);
    final where = count != null ? lookupLocationName(controller.locations, count.locationId) : 'Saved on this phone';
    final attention = entry.status != 'pending';
    final color = entry.status == 'conflict' ? invexaAmber : invexaRose;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: attention ? color : invexaBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(attention ? Icons.warning_amber_rounded : Icons.schedule, color: attention ? color : invexaMuted, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700))),
              ],
            ),
            const SizedBox(height: 4),
            Text(where, style: const TextStyle(color: invexaMuted, fontSize: 12)),
            const SizedBox(height: 8),
            Text(syncReason(entry.status), style: const TextStyle(fontSize: 13)),
            if (entry.lastError != null && attention) ...[
              const SizedBox(height: 6),
              Text('Server said: ${entry.lastError}', style: TextStyle(color: color, fontSize: 12)),
            ],
            const SizedBox(height: 4),
            Text(
              'Saved ${relativeSavedTime(entry.createdAt, DateTime.now())}${entry.attempts > 0 ? ' · tried ${entry.attempts} time${entry.attempts == 1 ? '' : 's'}' : ''}',
              style: const TextStyle(color: invexaMuted, fontSize: 11),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  key: ValueKey('discard-${entry.localId}'),
                  onPressed: () => _confirmDiscard(context, title, count != null),
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Discard'),
                ),
                if (attention)
                  FilledButton.icon(
                    key: ValueKey('retry-${entry.localId}'),
                    onPressed: () => count != null ? controller.retryQueuedCount(entry.localId) : controller.retryQueuedAction(entry.localId),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
