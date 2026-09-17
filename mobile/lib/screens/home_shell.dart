import 'package:flutter/material.dart';

import '../config/role_home.dart';
import '../config/theme.dart';
import '../state/session_controller.dart';
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
