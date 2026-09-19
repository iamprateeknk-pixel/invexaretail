import 'package:flutter/material.dart';

import '../config/role_home.dart';
import '../config/theme.dart';
import '../services/live_events.dart';
import '../state/session_controller.dart';
import 'conflict_center_screen.dart';
import 'count_screen.dart';
import 'dashboard_screen.dart';
import 'pick_screen.dart';
import 'putaway_screen.dart';
import 'receive_screen.dart';
import 'scan_screen.dart';
import 'stock_screen.dart';
import 'transfers_screen.dart';
import 'workspace_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.controller});

  final SessionController controller;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  String? _role;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final home = mobileHomeForRole(controller.user?.role ?? '');
    if (_role != controller.user?.role) {
      _role = controller.user?.role;
      final defaultIndex = home.destinations.indexWhere((row) => row.id == home.defaultDestination);
      _index = defaultIndex < 0 ? 0 : defaultIndex;
    }
    final safeIndex = _index.clamp(0, home.destinations.length - 1);
    final pages = home.destinations.map((dest) => _pageFor(dest.id, controller)).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(home.destinations[safeIndex].id == 'home' ? home.title : home.destinations[safeIndex].label),
        actions: [
          _LiveStatusIcon(status: controller.liveStatus),
          if (controller.queuedCounts.isNotEmpty || controller.queuedActions.isNotEmpty)
            IconButton(
              key: const ValueKey('open-sync-center'),
              tooltip: controller.attentionCount > 0 ? 'Sync center - ${controller.attentionCount} need your decision' : 'Sync center',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => ConflictCenterScreen(controller: controller)),
              ),
              icon: Badge(
                isLabelVisible: controller.attentionCount > 0,
                label: Text('${controller.attentionCount}'),
                child: const Icon(Icons.sync_problem_outlined),
              ),
            ),
          IconButton(
            tooltip: 'Full workspace',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const WorkspaceScreen(),
                ),
              );
            },
            icon: const Icon(Icons.open_in_browser_outlined),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: controller.logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: pages[safeIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: safeIndex,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: [
          for (final dest in home.destinations)
            NavigationDestination(
              icon: Icon(dest.icon),
              selectedIcon: Icon(dest.icon, color: invexaEmerald),
              label: dest.label,
            ),
        ],
      ),
    );
  }

  Widget _pageFor(String id, SessionController controller) {
    switch (id) {
      case 'stock':
        return StockScreen(controller: controller);
      case 'count':
        return CountScreen(controller: controller);
      case 'transfers':
        return TransfersScreen(controller: controller);
      case 'receive':
        return ReceiveScreen(controller: controller);
      case 'pick':
        return PickScreen(controller: controller);
      case 'putaway':
        return PutawayScreen(controller: controller);
      case 'scan':
        return ScanScreen(controller: controller);
      case 'orders':
        return TransfersScreen(controller: controller);
      default:
        return DashboardScreen(controller: controller);
    }
  }
}

class _LiveStatusIcon extends StatelessWidget {
  const _LiveStatusIcon({required this.status});

  final LiveStatus status;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, Color color, String label) = switch (status) {
      LiveStatus.live => (Icons.bolt, invexaEmerald, 'Live - changes appear automatically'),
      LiveStatus.connecting || LiveStatus.reconnecting => (Icons.sync, Colors.amber.shade800, 'Reconnecting to live updates'),
      LiveStatus.stale => (Icons.sync_problem, Colors.amber.shade800, 'Live updates went quiet - reconnecting'),
      LiveStatus.offline => (Icons.cloud_off, invexaMuted, 'Offline - showing the last synced data'),
      LiveStatus.unauthorized => (Icons.lock_outline, invexaRose, 'Session expired - sign in again'),
    };
    return Tooltip(
      message: label,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Icon(icon, size: 20, color: color),
      ),
    );
  }
}
