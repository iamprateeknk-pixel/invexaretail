import 'package:flutter/material.dart';

class MobileDestination {
  const MobileDestination({required this.id, required this.label, required this.icon});

  final String id;
  final String label;
  final IconData icon;
}

class MobileRoleHome {
  const MobileRoleHome({
    required this.title,
    required this.subtitle,
    required this.defaultDestination,
    required this.destinations,
  });

  final String title;
  final String subtitle;
  final String defaultDestination;
  final List<MobileDestination> destinations;
}

const _home = MobileDestination(id: 'home', label: 'Home', icon: Icons.dashboard_outlined);
const _stock = MobileDestination(id: 'stock', label: 'Stock', icon: Icons.inventory_2_outlined);
const _count = MobileDestination(id: 'count', label: 'Count', icon: Icons.fact_check_outlined);
const _transfers = MobileDestination(id: 'transfers', label: 'Transfers', icon: Icons.local_shipping_outlined);
const _scan = MobileDestination(id: 'scan', label: 'Scan', icon: Icons.qr_code_scanner_outlined);
const _work = MobileDestination(id: 'work', label: 'Work', icon: Icons.task_alt_outlined);
const _orders = MobileDestination(id: 'orders', label: 'Orders', icon: Icons.shopping_bag_outlined);

MobileRoleHome mobileHomeForRole(String role) {
  switch (role) {
    case 'WAREHOUSE_PICKER':
      return const MobileRoleHome(
        title: 'Pick & putaway',
        subtitle: 'Scan-first warehouse work. Walk bins in order; wrong scans are blocked.',
        defaultDestination: 'work',
        destinations: [_home, _work, _scan],
      );
    case 'STORE_USER':
      return const MobileRoleHome(
        title: 'Store floor',
        subtitle: 'Blind counts and inbound receiving for your branch.',
        defaultDestination: 'work',
        destinations: [_home, _work, _stock],
      );
    case 'AUDITOR':
      return const MobileRoleHome(
        title: 'Audit',
        subtitle: 'Review stock truth and count evidence. No warehouse execution.',
        defaultDestination: 'count',
        destinations: [_home, _stock, _count],
      );
    case 'BRANCH_MANAGER':
      return const MobileRoleHome(
        title: 'Branch operations',
        subtitle: 'Stock, counts and transfers for your locations.',
        defaultDestination: 'home',
        destinations: [_home, _stock, _count, _transfers],
      );
    case 'ADMIN':
    case 'ADMIN_USER':
      return const MobileRoleHome(
        title: 'Control center',
        subtitle: 'Network stock, counts, transfers and channel orders.',
        defaultDestination: 'home',
        destinations: [_home, _stock, _count, _transfers, _orders],
      );
    default:
      return const MobileRoleHome(
        title: 'Invexa Retail',
        subtitle: 'Frontline operations',
        defaultDestination: 'home',
        destinations: [_home, _stock, _count, _transfers],
      );
  }
}
