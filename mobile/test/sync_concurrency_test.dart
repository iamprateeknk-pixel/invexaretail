// Data-safety regressions: work queued while a sync is in flight is never lost,
// overlapping syncs never send the same item twice, and a slow stock response
// for a location the user has already left never overwrites the new location.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/api_client.dart';
import 'package:invexaretail_mobile/services/local_store.dart';
import 'package:invexaretail_mobile/state/session_controller.dart';

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

const alice = AuthUser(id: 'alice', name: 'Alice', email: 'alice@x.local', role: 'STORE_USER', companyId: 'co-a');

QueuedCount _count(String id) => QueuedCount(
      localId: id,
      userId: 'alice',
      requestId: 'req-$id',
      itemId: 'item-$id',
      locationId: 'loc-1',
      physicalQuantity: 3,
      createdAt: '2026-11-27T00:00:00Z',
    );

SessionController _controller(LocalStore store, Future<http.Response> Function(http.Request) handler) {
  final controller = SessionController(api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient(handler)), store: store)
    ..restoring = false
    ..user = alice;
  controller.api.token = 'jwt';
  return controller;
}

void main() {
  test('a count queued while a sync is waiting on the network is kept, in memory and on disk', () async {
    final store = MemoryStore();
    final release = Completer<void>();
    final controller = _controller(store, (request) async {
      if (request.method == 'POST') {
        await release.future; // hold the first replay in flight
        return _json({'count': {'id': 'srv-1'}});
      }
      return _json({'counts': [], 'dashboard': {}});
    })
      ..queuedCounts = [_count('c-1')];

    final flushing = controller.flushQueue();
    await Future<void>.delayed(Duration.zero);
    // The person keeps working offline-first while the replay is still waiting.
    await controller.enqueueCount(itemId: 'item-new', locationId: 'loc-1', physicalQuantity: 7);
    release.complete();
    await flushing;

    expect(controller.queuedCounts.map((row) => row.itemId), ['item-new'],
        reason: 'the replayed count leaves the queue; the one added meanwhile must stay');
    expect((await store.loadQueuedCounts('co-a', 'alice')).map((row) => row.itemId), ['item-new']);
  });

  test('a count discarded during a sync is not brought back by it', () async {
    final store = MemoryStore();
    final release = Completer<void>();
    final controller = _controller(store, (request) async {
      if (request.method == 'POST') {
        await release.future;
        return _json({'error': 'conflict'}, 409);
      }
      return _json({});
    })
      ..queuedCounts = [_count('c-1')];

    final flushing = controller.flushQueue();
    await Future<void>.delayed(Duration.zero);
    await controller.dismissQueued('c-1');
    release.complete();
    await flushing;

    expect(controller.queuedCounts, isEmpty);
    expect(await store.loadQueuedCounts('co-a', 'alice'), isEmpty);
  });

  test('overlapping syncs (resume + refresh) send each queued count exactly once', () async {
    final store = MemoryStore();
    final posts = <String>[];
    final controller = _controller(store, (request) async {
      if (request.method == 'POST') {
        posts.add(jsonDecode(request.body)['requestId'] as String);
        await Future<void>.delayed(const Duration(milliseconds: 5));
        return _json({'count': {'id': 'srv'}});
      }
      return _json({'counts': [], 'dashboard': {}});
    })
      ..queuedCounts = [_count('c-1'), _count('c-2')];

    await Future.wait([controller.flushQueue(), controller.flushQueue(), controller.flushQueue()]);

    expect(posts, ['req-c-1', 'req-c-2']);
    expect(controller.queuedCounts, isEmpty);
  });

  test('a slow stock response for the previous location never replaces the new location\'s stock', () async {
    final store = MemoryStore();
    final slowLoc1 = Completer<void>();
    final controller = _controller(store, (request) async {
      final path = request.url.path;
      if (path == '/api/v1/stock/loc-1') {
        await slowLoc1.future;
        return _json({'items': [{'itemId': 'from-loc-1', 'locationId': 'loc-1'}]});
      }
      if (path == '/api/v1/stock/loc-2') {
        return _json({'items': [{'itemId': 'from-loc-2', 'locationId': 'loc-2'}]});
      }
      return _json({'tasks': []});
    })
      ..selectedLocationId = 'loc-0';

    final first = controller.selectLocation('loc-1');
    await Future<void>.delayed(Duration.zero);
    await controller.selectLocation('loc-2');
    slowLoc1.complete();
    await first;

    expect(controller.selectedLocationId, 'loc-2');
    expect(controller.stock.map((row) => row.itemId), ['from-loc-2']);
  });

  test('a save the server accepted is reported as saved even if the refresh after it fails', () async {
    final posts = <String>[];
    final controller = _controller(MemoryStore(), (request) async {
      if (request.method == 'POST') {
        posts.add(request.url.path);
        return _json({'ok': true});
      }
      return _json({'error': 'dashboard down'}, 500); // every re-read fails
    });

    final ok = await controller.runOrQueue(type: 'Putaway', method: 'POST', path: '/api/v1/putaway-tasks/t1/confirm', body: {'scannedBinCode': 'B'});

    expect(ok, isTrue, reason: 'reporting failure here makes the person tap again and post twice');
    expect(controller.error, isNull);
    expect(controller.notice, contains('saved'));
    expect(controller.busy, isFalse);
    expect(posts, hasLength(1));
  });

  test('sign-in succeeds and lands on home even when the first data load fails', () async {
    final controller = SessionController(
      api: InvexaApi(baseUrl: 'http://api.test', httpClient: MockClient((request) async {
        if (request.url.path == '/api/v1/auth/login') {
          return _json({
            'token': 'jwt',
            'refreshToken': 'r1',
            'user': {'id': 'alice', 'name': 'Alice', 'email': 'alice@x.local', 'role': 'STORE_USER', 'companyId': 'co-a'},
          });
        }
        return _json({'error': 'Service unavailable'}, 500);
      })),
      store: MemoryStore(),
    )..restoring = false;

    final ok = await controller.login('alice@x.local', 'pw');

    expect(ok, isTrue);
    expect(controller.isSignedIn, isTrue);
    expect(controller.error, isNotNull, reason: 'the reason is still shown on the home screen');
    controller.stopLive();
  });
}
