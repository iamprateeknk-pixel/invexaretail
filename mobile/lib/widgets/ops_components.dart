import 'package:flutter/material.dart';

import '../config/theme.dart';

class OpsSectionHeader extends StatelessWidget {
  const OpsSectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
              if (subtitle != null) ...[
                const SizedBox(height: 3),
                Text(subtitle!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: invexaMuted)),
              ],
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class OpsMetricTile extends StatelessWidget {
  const OpsMetricTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.caption,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final String? caption;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: invexaEmerald.withValues(alpha: .10),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(icon, size: 19, color: invexaEmerald),
                  ),
                  const Spacer(),
                  if (onTap != null) const Icon(Icons.arrow_forward_ios_rounded, size: 13, color: invexaMuted),
                ],
              ),
              const SizedBox(height: 14),
              Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 2),
              Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              if (caption != null) ...[
                const SizedBox(height: 4),
                Text(caption!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: invexaMuted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class OpsProgressCard extends StatelessWidget {
  const OpsProgressCard({
    super.key,
    required this.title,
    required this.completed,
    required this.total,
    this.caption,
    this.trailing,
  });

  final String title;
  final num completed;
  final num total;
  final String? caption;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final progress = total <= 0 ? 0.0 : (completed / total).clamp(0, 1).toDouble();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            SizedBox(
              width: 64,
              height: 64,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CircularProgressIndicator(
                    value: progress,
                    strokeWidth: 7,
                    backgroundColor: invexaBorder,
                    strokeCap: StrokeCap.round,
                  ),
                  Center(
                    child: Text('${(progress * 100).round()}%', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text('$completed of $total completed', style: const TextStyle(fontSize: 12, color: invexaMuted)),
                  if (caption != null) ...[
                    const SizedBox(height: 3),
                    Text(caption!, style: const TextStyle(fontSize: 11, color: invexaMuted)),
                  ],
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}

class OpsTaskCard extends StatelessWidget {
  const OpsTaskCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.status,
    required this.icon,
    required this.onTap,
    this.progress,
    this.meta,
  });

  final String title;
  final String subtitle;
  final String status;
  final IconData icon;
  final VoidCallback onTap;
  final double? progress;
  final String? meta;

  Color get _statusColor {
    final value = status.toUpperCase();
    if (value.contains('OVERDUE') || value.contains('FAILED')) return invexaRose;
    if (value.contains('PENDING') || value.contains('RECOUNT')) return invexaAmber;
    return invexaEmerald;
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 10, 14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: _statusColor.withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: _statusColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800))),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(color: _statusColor.withValues(alpha: .10), borderRadius: BorderRadius.circular(999)),
                          child: Text(status, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: _statusColor)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: invexaMuted)),
                    if (meta != null) ...[
                      const SizedBox(height: 3),
                      Text(meta!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: invexaMuted)),
                    ],
                    if (progress != null) ...[
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: progress!.clamp(0, 1),
                          minHeight: 6,
                          backgroundColor: invexaBorder,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded, color: invexaMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class OpsSyncPill extends StatelessWidget {
  const OpsSyncPill({
    super.key,
    required this.label,
    this.syncing = false,
    this.offline = false,
  });

  final String label;
  final bool syncing;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final color = offline ? invexaAmber : invexaEmerald;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        border: Border.all(color: color.withValues(alpha: .22)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (syncing)
            SizedBox(width: 13, height: 13, child: CircularProgressIndicator(strokeWidth: 2, color: color))
          else
            Icon(offline ? Icons.cloud_off_rounded : Icons.cloud_done_rounded, size: 15, color: color),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color)),
        ],
      ),
    );
  }
}

class OpsPrimaryAction extends StatelessWidget {
  const OpsPrimaryAction({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    this.enabled = true,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: enabled ? onPressed : null,
      icon: Icon(icon),
      label: Text(label),
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
    );
  }
}
