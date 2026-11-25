// Release checklist (Android): "Cold-start offline ... pass". The last good answer of each read-only feed
// is kept per company + user, so starting the app with no network still shows the last known items,
// locations and stock - marked as a snapshot - and a signed-out phone keeps none of it.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/screens/home_shell.dart' show snapshotAge;
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/services/mobile_offline_policy.dart';
import 'package:invexaretail_mobile/services/native_database.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

const alice = AuthUser(id: 'alice', name: 'Alice', email: 'alice@x.local', role: 'ADMIN', companyId: 'co-a');

Map<String, Object> _feed(String path) {
  if (path.startsWith('/api/v1/locations')) return {'locations': [{'id': 'loc-1', 'name': 'Main Store', 'type': 'store'}]};
  if (path.startsWith('/api/v1/items')) return {'items': [{'id': 'item-1', 'code': 'RICE', 'name': 'Basmati Rice'}]};
  if (path.startsWith('/api/v1/stock/')) return {'items': []};
  if (path.startsWith('/api/v1/putaway-tasks')) return {'tasks': []};
  if (path.startsWith('/api/v1/counts')) return {'counts': []};
  if (path.startsWith('/api/v1/transfers')) return {'transfers': []};
  if (path.startsWith('/api/v1/dashboard')) return {'dashboard': {}};
  return {};
}

void main() {
  group('NativeDatabase read model', () {
    test('policy metadata survives read-cache eviction and stays scoped to the role', () {
      final db = NativeDatabase.memory();
      const scope = 'co-a|alice|ADMIN';
      db.saveMobilePolicy(scope, '{"offlineMaxHours":4}');
      db.putReadModel(scope, '/api/v1/items', '{}');
      db.clearReadModel(scope);
      expect(db.loadMobilePolicy(scope), '{"offlineMaxHours":4}');
      expect(db.loadMobilePolicy('co-a|alice|STORE_USER'), isNull);
      db.saveMobilePolicy(scope, null);
      expect(db.loadMobilePolicy(scope), isNull);
      db.close();
    });

    test('is scoped per identity, replaced in place, and cleared per scope', () {
      final db = NativeDatabase.memory();
      db.putReadModel('co-a|alice', '/api/v1/items', '{"items":[1]}');
      db.putReadModel('co-a|alice', '/api/v1/items', '{"items":[1,2]}');
      db.putReadModel('co-a|bob', '/api/v1/items', '{"items":["bob"]}');
      expect(db.getReadModel('co-a|alice', '/api/v1/items')!.body, '{"items":[1,2]}');
      expect(db.getReadModel('co-a|bob', '/api/v1/items')!.body, '{"items":["bob"]}');
      expect(db.getReadModel('co-b|alice', '/api/v1/items'), isNull, reason: 'another company never sees it');
      db.clearReadModel('co-a|alice');
      expect(db.getReadModel('co-a|alice', '/api/v1/items'), isNull);
      expect(db.getReadModel('co-a|bob', '/api/v1/items'), isNotNull, reason: 'clearing one identity leaves the others');
      db.close();
    });

    test('is bounded and refuses an unusually large feed', () {
      final db = NativeDatabase.memory();
      for (var i = 0; i < 230; i += 1) {
        db.putReadModel('s', '/api/v1/items?page=$i', '{}', now: DateTime.utc(2026, 10, 7, 0, 0, i % 60, i));
      }
      final kept = [for (var i = 0; i < 230; i += 1) if (db.getReadModel('s', '/api/v1/items?page=$i') != null) i];
      expect(kept.length, 200);
      db.putReadModel('s', '/big', 'x' * (2 * 1024 * 1024 + 1));
      expect(db.getReadModel('s', '/big'), isNull);
      db.close();
    });
  });

  group('InvexaApi read-through cache', () {
    test('serves the last good answer when the network is unreachable, and says when it is from', () async {
      var online = true;
      final store = MemoryStore();
      final api = InvexaApi(
        baseUrl: 'http://api.test',
        httpClient: MockClient((request) async {
          if (!online) throw const SocketException('no network');
          return _json(_feed(request.url.path));
        }),
      )
        ..cacheScope = 'co-a|alice'
        ..cachePut = store.putReadModel
        ..cacheGet = (scope, path) async {
          final row = await store.getReadModel(scope, path);
          return row == null ? null : (body: row.body, fetchedAt: row.fetchedAt);
        };
      api.token = 'jwt';

      expect((await api.items()).single.name, 'Basmati Rice');
      expect(api.servedFromCacheAt, isNull, reason: 'a live answer is not a snapshot');

      online = false;
      expect((await api.items()).single.name, 'Basmati Rice');
      expect(api.servedFromCacheAt, isNotNull);

      await expectLater(api.counts(), throwsA(isA<ApiException>()), reason: 'a feed never fetched while online has nothing to fall back to');
    });

    test('never caches or serves writes, auth, or another identity\'s data', () async {
      final store = MemoryStore();
      var online = true;
      final api = InvexaApi(
        baseUrl: 'http://api.test',
        httpClient: MockClient((request) async {
          if (!online) throw const SocketException('no network');
          return _json(request.method == 'GET' ? _feed(request.url.path) : {'success': true});
        }),
      )
        ..cacheScope = 'co-a|alice'
        ..cachePut = store.putReadModel
        ..cacheGet = (scope, path) async {
          final row = await store.getReadModel(scope, path);
          return row == null ? null : (body: row.body, fetchedAt: row.fetchedAt);
        };
      api.token = 'jwt';
      await api.items();
      await api.sendRaw('POST', '/api/v1/items', body: {'name': 'x'});
      expect(store.readModel.keys, ['co-a|alice|/api/v1/items'], reason: 'only the GET feed was remembered');

      online = false;
      api.cacheScope = 'co-a|bob';
      await expectLater(api.items(), throwsA(isA<ApiException>()), reason: 'a different user on the same phone gets no cached data');
      api.cacheScope = 'co-a|alice';
      await expectLater(api.sendRaw('POST', '/api/v1/items', body: {'name': 'x'}), throwsA(isA<ApiException>()), reason: 'writes are never answered from the cache');
    });
  });

  group('cold start with no network', () {
    test('published policy survives restart, limits scope, and expires snapshots', () async {
      const scope = 'co-a|alice|ADMIN';
      final store = MemoryStore();
      await store.saveSession(const PersistedSession(token: 'jwt', user: alice));
      var online = true;
      var syncScope = ['stock'];
      var now = DateTime.now();
      SessionController build() => SessionController(
        api: InvexaApi(baseUrl: 'http://api.test', now: () => now, httpClient: MockClient((request) async {
          if (!online) throw const SocketException('no network');
          if (request.url.path == '/api/v1/runtime/config') {
            return _json({'runtime': {'mobilePolicy': {
              'offlineMaxHours': 1, 'syncScope': syncScope, 'navigation': ['dashboard', 'stock'],
            }}});
          }
          return _json(_feed(request.url.path));
        })),
        store: store,
      );
      final first = build();
      await first.restore();
      first.stopLive();
      expect(await store.getReadModel(scope, '/api/v1/items'), isNotNull);
      expect(await store.getReadModel(scope, '/api/v1/transfers/list'), isNull);
      expect(await store.getReadModel(scope, '/api/v1/counts'), isNull);

      online = false;
      now = DateTime.now().add(const Duration(minutes: 30));
      final cold = build();
      await cold.restore();
      cold.stopLive();
      expect(cold.mobileNavigation, ['dashboard', 'stock']);
      expect(cold.items.single.name, 'Basmati Rice');
      expect(cold.error, isNull);
      expect(cold.offlineReadsUnavailable, isTrue);

      // A snapshot already on screen must disappear when the window expires.
      final savedAt = cold.snapshotFetchedAt!;
      now = savedAt.add(const Duration(minutes: 59, seconds: 59));
      await cold.refreshAll();
      expect(cold.items, isNotEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 1100));
      expect(cold.items, isEmpty);
      expect(cold.snapshotFetchedAt, isNull);

      now = now.add(const Duration(hours: 1));
      await cold.refreshAll();
      expect(cold.items, isEmpty);
      expect(cold.snapshotFetchedAt, isNull);
      online = true;
      syncScope = ['counts'];
      await cold.refreshAll();
      expect(await store.getReadModel(scope, '/api/v1/stock/loc-1'), isNull);
      expect(await store.getReadModel(scope, '/api/v1/counts'), isNotNull);
      await cold.logout(notify: false);
      expect(await store.loadMobilePolicy(scope), isNull);
    });

    test('restore() shows the last known data marked as a snapshot, and sign-out erases it', () async {
      final store = MemoryStore();
      await store.saveSession(const PersistedSession(token: 'jwt', refreshToken: 'r', user: alice));
      var online = true;
      SessionController build() => SessionController(
            api: InvexaApi(
              baseUrl: 'http://api.test',
              httpClient: MockClient((request) async {
                if (!online) throw const SocketException('no network');
                return _json(_feed(request.url.path));
              }),
            ),
            store: store,
          );

      // First run, online: everything is fetched and remembered.
      final first = build();
      await first.restore();
      expect(first.items.single.name, 'Basmati Rice');
      expect(first.snapshotFetchedAt, isNull);

      // Process death, then a start with the network gone.
      online = false;
      final cold = build();
      await cold.restore();
      expect(cold.error, isNull, reason: 'offline start is not an error screen');
      expect(cold.isSignedIn, isTrue);
      expect(cold.items.single.name, 'Basmati Rice');
      expect(cold.locations.single.name, 'Main Store');
      expect(cold.snapshotFetchedAt, isNotNull);

      await cold.logout(notify: false);
      final afterLogout = await store.getReadModel('co-a|alice|ADMIN', '/api/v1/items');
      expect(afterLogout, isNull, reason: 'a signed-out phone keeps no stock data');
    });
  });

  test('scopes strip unrelated rows from mixed feeds and zero hours disables storage', () {
    final policy = MobileOfflinePolicy.fromJson({'offlineMaxHours': 2, 'syncScope': ['receiving']});
    expect(policy.cachePayload('/api/v1/mobile/work', {'countTasks': [1], 'receiveTasks': [2]}), {'receiveTasks': [2]});
    expect(policy.cachePayload('/api/v1/transfers/list', {'transfers': [
      {'status': 'DISPATCHED'}, {'status': 'PICKING'}, {'status': 'CANCELLED'},
    ]}), {'transfers': [{'status': 'DISPATCHED'}]});
    final disabled = MobileOfflinePolicy.fromJson({'offlineMaxHours': 0, 'syncScope': ['stock']});
    expect(disabled.allows('/api/v1/items'), isFalse);
  });

  test('snapshotAge words the age of the data in plain terms', () {
    final now = DateTime.utc(2026, 10, 7, 12);
    expect(snapshotAge(now.subtract(const Duration(seconds: 20)), now: now), 'just now');
    expect(snapshotAge(now.subtract(const Duration(minutes: 5)), now: now), '5 min ago');
    expect(snapshotAge(now.subtract(const Duration(hours: 3)), now: now), '3 h ago');
    expect(snapshotAge(now.subtract(const Duration(days: 4)), now: now), '4 d ago');
  });
}
