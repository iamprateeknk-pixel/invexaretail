import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../state/session_controller.dart';
import 'count_screen.dart';
import 'pick_screen.dart';
import 'putaway_screen.dart';
import 'receive_screen.dart';

/// Blueprint v4 §37: "Work - tabs: Count / Pick / Receive / Putaway; only
/// actionable tasks". One place to see what needs doing today, with how many
/// tasks each tab holds.
class WorkScreen extends StatelessWidget {
  const WorkScreen({super.key, required this.controller, required this.tabs});

  final SessionController controller;
  // Any of: count, pick, receive, putaway - in the order they should appear.
  final List<String> tabs;

  int _open(String tab) {
    switch (tab) {
      case 'count':
        return controller.countTasks.isNotEmpty ? controller.countTasks.length : controller.assignments.length;
      case 'receive':
        return controller.transfers.where((row) {
          final status = row.status.toUpperCase();
          return status.contains('TRANSIT') || status.contains('DISPATCH') || status.contains('PARTIAL');
        }).length;
      case 'pick':
        return controller.transfers.where((row) {
          final status = row.status.toUpperCase();
          return status.contains('PICK') || status == 'REQUESTED' || status == 'PARTIAL';
        }).length;
      case 'putaway':
        return controller.putawayTasks.length;
    }
    return 0;
  }

  static const _labels = {'count': 'Count', 'pick': 'Pick', 'receive': 'Receive', 'putaway': 'Putaway'};

  Widget _body(String tab) {
    switch (tab) {
      case 'count':
        return CountScreen(controller: controller);
      case 'pick':
        return PickScreen(controller: controller);
      case 'receive':
        return ReceiveScreen(controller: controller);
      default:
        return PutawayScreen(controller: controller);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: tabs.length,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).scaffoldBackgroundColor,
            child: TabBar(
              indicatorColor: invexaEmerald,
              labelColor: invexaInk,
              tabs: [
                for (final tab in tabs)
                  Tab(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_labels[tab] ?? tab),
                        if (_open(tab) > 0) ...[
                          const SizedBox(width: 6),
                          Badge(label: Text('${_open(tab)}'), backgroundColor: invexaEmerald),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Expanded(child: TabBarView(children: [for (final tab in tabs) _body(tab)])),
        ],
      ),
    );
  }
}
