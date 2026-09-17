import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';

void main() {
  final base = Platform.environment['INVEXA_API_BASE'];

  test('logs in and loads dashboard, stock, and transfers from a live API', () async {
    if (base == null || base.trim().isEmpty) {
      return;
    }

    final api = InvexaApi(baseUrl: base, httpClient: http.Client());
    final login = await api.login(
      Platform.environment['INVEXA_LOGIN_EMAIL'] ?? 'admin@retail.local',
      Platform.environment['INVEXA_LOGIN_PASSWORD'] ?? 'ChangeMe123!',
    );
    expect(login.token, isNotEmpty);
    expect(login.user.role, isNotEmpty);

    final dashboard = await api.dashboard();
    expect(dashboard.pendingCounts, greaterThanOrEqualTo(0));

    final locations = await api.locations();
    expect(locations, isNotEmpty);

    final items = await api.items();
    expect(items, isNotEmpty);
    expect(lookupItemName(items, items.first.id), items.first.name);

    final stock = await api.stock(locations.first.id);
    expect(stock, isNotEmpty);

    final transfers = await api.transfers();
    expect(transfers, isNotEmpty);

    final yoghurt = items.firstWhere((item) => item.id == 'item-1004', orElse: () => items.first);
    final count = await api.submitCount(
      itemId: yoghurt.id,
      locationId: locations.first.id,
      physicalQuantity: 4,
      lotNo: yoghurt.lots.isEmpty ? null : yoghurt.lots.first.lotNo,
    );
    expect(count.itemId, yoghurt.id);
    expect(count.physicalQuantity, 4);
  }, skip: (base == null || base.trim().isEmpty) ? 'Set INVEXA_API_BASE to run live API checks' : false);

  test('login contract fixture still matches a captured production-shaped body', () {
    const fixture = '''
    {
      "success": true,
      "token": "x",
      "refreshToken": "y",
      "user": {"id": "1", "name": "A", "email": "a@b.c", "role": "ADMIN", "branchIds": []}
    }
    ''';
    expect(LoginResult.fromJson(jsonDecode(fixture) as Map<String, dynamic>).user.role, 'ADMIN');
  });
}
