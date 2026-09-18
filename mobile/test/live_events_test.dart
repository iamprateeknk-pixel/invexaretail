import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:invexaretail_mobile/services/live_events.dart';

String frame(int id, String topic) => 'id: $id\nevent: $topic\ndata: {"id":$id,"topic":"$topic"}\n\n';
String hello(String epoch) => 'event: hello\ndata: {"epoch":"$epoch","latestEventId":0}\n\n';

http.StreamedResponse streamed(List<String> chunks, {int status = 200, bool holdOpen = false}) {
  final controller = StreamController<List<int>>();
  for (final chunk in chunks) {
    controller.add(utf8.encode(chunk));
  }
  if (!holdOpen) controller.close();
  return http.StreamedResponse(controller.stream, status);
}

void main() {
  test('parseSseBuffer returns whole frames and keeps a partial tail', () {
    final result = parseSseBuffer(': ping\n\n${frame(1, 'stock.changed')}id: 2\nevent: count.chan');
    expect(result.frames, hasLength(1));
    expect(result.frames.first.event, 'stock.changed');
    expect(result.frames.first.id, '1');
    expect(result.rest, 'id: 2\nevent: count.chan');
    final next = parseSseBuffer('${result.rest}ged\ndata: {}\n\n');
    expect(next.frames.first.event, 'count.changed');
  });

  test('backoff grows, is capped and stays inside the jitter bounds', () {
    expect(backoffDelay(0, () => 0.5), const Duration(milliseconds: 1000));
    expect(backoffDelay(3, () => 0.5), const Duration(milliseconds: 8000));
    expect(backoffDelay(20, () => 0.5), const Duration(milliseconds: 30000));
    expect(backoffDelay(2, () => 0).inMilliseconds, greaterThanOrEqualTo(3200));
    expect(backoffDelay(2, () => 1).inMilliseconds, lessThanOrEqualTo(4800));
  });

  test('topics map to targeted slices; unknown topics invalidate nothing', () {
    expect(invalidationsForTopics(['count.changed']), {'counts', 'assignments', 'dashboard'});
    expect(invalidationsForTopics(['stock.changed']).contains('items'), isFalse);
    expect(invalidationsForTopics(['permission.changed']), {'full'});
    final all = invalidationsForTopics(['*']);
    expect(all.contains('items') && !all.contains('full'), isTrue);
    expect(invalidationsForTopics(['something.else']), isEmpty);
  });

  test('client dispatches events, drops duplicates and resumes with Last-Event-ID + epoch', () async {
    final requests = <http.BaseRequest>[];
    final batches = <String>[];
    final statuses = <LiveStatus>[];
    var call = 0;
    late LiveEventClient client;
    client = LiveEventClient(
      url: 'http://x/api/v1/events',
      tokenProvider: () => 'tok',
      sleep: (_) async {},
      onEvents: (topics) => batches.addAll(topics),
      onStatus: statuses.add,
      clientFactory: () => MockClient.streaming((request, _) async {
        requests.add(request);
        call++;
        if (call == 1) {
          return streamed([hello('e1'), frame(1, 'stock.changed'), frame(2, 'count.changed'), frame(2, 'count.changed')]);
        }
        client.stop();
        return streamed([], holdOpen: true);
      }),
    );
    client.start();
    await Future<void>.delayed(const Duration(milliseconds: 100));

    expect(batches, ['stock.changed', 'count.changed']);
    expect(client.cursor, 2);
    expect(requests[0].headers['Authorization'], 'Bearer tok');
    expect(requests[0].headers.containsKey('Last-Event-ID'), isFalse);
    expect(requests[1].headers['Last-Event-ID'], '2');
    expect(requests[1].url.query, contains('epoch=e1'));
    expect(statuses, contains(LiveStatus.live));
    expect(statuses, contains(LiveStatus.reconnecting));
  });

  test('a new server epoch or an explicit reset asks for a full resync', () async {
    final batches = <String>[];
    var call = 0;
    late LiveEventClient client;
    client = LiveEventClient(
      url: 'http://x/events',
      tokenProvider: () => 'tok',
      sleep: (_) async {},
      onEvents: (topics) => batches.addAll(topics),
      clientFactory: () => MockClient.streaming((request, _) async {
        call++;
        if (call == 1) return streamed([hello('old'), frame(5, 'stock.changed')]);
        if (call == 2) return streamed([hello('new')]);
        if (call == 3) return streamed([hello('new'), 'event: reset\ndata: {}\n\n']);
        client.stop();
        return streamed([], holdOpen: true);
      }),
    );
    client.start();
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(batches, ['stock.changed', '*', '*']);
    expect(client.cursor, isNull);
  });

  test('a 401 tries a token refresh once, then stops instead of hammering the server', () async {
    var calls = 0;
    var refreshes = 0;
    final statuses = <LiveStatus>[];
    final client = LiveEventClient(
      url: 'http://x/events',
      tokenProvider: () => 'expired',
      sleep: (_) async {},
      onStatus: statuses.add,
      onUnauthorized: () async {
        refreshes++;
        return false;
      },
      onEvents: (_) {},
      clientFactory: () => MockClient.streaming((request, _) async {
        calls++;
        return streamed([], status: 401);
      }),
    );
    client.start();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(calls, 1);
    expect(refreshes, 1);
    expect(statuses.last, LiveStatus.unauthorized);
    client.stop();
  });

  test('a network failure retries with backoff instead of throwing', () async {
    var calls = 0;
    final sleeps = <Duration>[];
    late LiveEventClient client;
    client = LiveEventClient(
      url: 'http://x/events',
      tokenProvider: () => 'tok',
      random: () => 0.5,
      sleep: (duration) async => sleeps.add(duration),
      onEvents: (_) {},
      clientFactory: () => MockClient.streaming((request, _) async {
        calls++;
        if (calls < 3) throw http.ClientException('network down');
        client.stop();
        return streamed([], holdOpen: true);
      }),
    );
    client.start();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(calls, 3);
    expect(sleeps, [const Duration(milliseconds: 2000), const Duration(milliseconds: 4000)]);
  });
}
