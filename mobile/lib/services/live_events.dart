import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

// Blueprint v4 §11 mobile side: an authenticated SSE stream held open while
// the app is in the foreground. Events are payload-free invalidations; the
// app refetches only the slices they name through the normal scoped
// endpoints. On resume the client reconnects with its cursor so the server
// replays what was missed (or tells us to resync everything).

enum LiveStatus { connecting, live, reconnecting, stale, offline, unauthorized }

class SseFrame {
  const SseFrame({this.id, required this.event, required this.data});

  final String? id;
  final String event;
  final String data;
}

class SseParseResult {
  const SseParseResult(this.frames, this.rest);

  final List<SseFrame> frames;
  final String rest;
}

/// Splits an SSE text buffer into complete frames plus the unfinished tail.
SseParseResult parseSseBuffer(String buffer) {
  final parts = buffer.replaceAll('\r\n', '\n').split('\n\n');
  final rest = parts.removeLast();
  final frames = <SseFrame>[];
  for (final part in parts) {
    String? id;
    var event = 'message';
    var data = '';
    var any = false;
    for (final line in part.split('\n')) {
      if (line.isEmpty || line.startsWith(':')) continue;
      final colon = line.indexOf(':');
      final field = colon == -1 ? line : line.substring(0, colon);
      var value = colon == -1 ? '' : line.substring(colon + 1);
      if (value.startsWith(' ')) value = value.substring(1);
      if (field == 'id') {
        id = value;
        any = true;
      } else if (field == 'event') {
        event = value;
        any = true;
      } else if (field == 'data') {
        data = data.isEmpty ? value : '$data\n$value';
        any = true;
      }
    }
    if (any) frames.add(SseFrame(id: id, event: event, data: data));
  }
  return SseParseResult(frames, rest);
}

Duration backoffDelay(int attempt, [double Function()? random]) {
  final base = min(30000, 1000 * pow(2, attempt).toInt());
  final jitter = 0.8 + (random ?? Random().nextDouble)() * 0.4;
  return Duration(milliseconds: (base * jitter).round());
}

/// Which slices of client state a set of topics invalidates. '*' means the
/// stream cannot vouch for continuity (server restart / cursor too old).
Set<String> invalidationsForTopics(Iterable<String> topics) {
  final out = <String>{};
  for (final topic in topics) {
    switch (topic) {
      case '*':
        out.addAll(['counts', 'assignments', 'stock', 'items', 'transfers', 'dashboard', 'putaway']);
      case 'permission.changed' || 'config.changed':
        out.add('full');
      case 'count.changed' || 'assignment.changed' || 'campaign.changed':
        out.addAll(['counts', 'assignments', 'dashboard']);
      case 'stock.changed' || 'receipt.changed':
        out.addAll(['stock', 'dashboard']);
      case 'putaway.changed':
        out.addAll(['putaway', 'stock']);
      case 'pick.changed' || 'transfer.changed':
        out.addAll(['transfers', 'stock', 'dashboard']);
      case 'item.changed' || 'lot.changed' || 'import.committed':
        out.addAll(['items', 'stock', 'dashboard']);
      case 'exception.changed' || 'approval.changed' || 'connector.changed':
        out.add('dashboard');
    }
  }
  return out;
}

class LiveEventClient {
  LiveEventClient({
    required this.url,
    required this.tokenProvider,
    required this.onEvents,
    this.onStatus,
    this.onUnauthorized,
    http.Client Function()? clientFactory,
    Future<void> Function(Duration)? sleep,
    double Function()? random,
    DateTime Function()? now,
  })  : _clientFactory = clientFactory ?? http.Client.new,
        _sleep = sleep ?? Future<void>.delayed,
        _random = random,
        _now = now ?? DateTime.now;

  static const _staleAfter = Duration(seconds: 70);
  static const _watchdogEvery = Duration(seconds: 15);

  final String url;
  final String? Function() tokenProvider;
  final void Function(List<String> topics) onEvents;
  final void Function(LiveStatus status)? onStatus;
  // Return true if a fresh token is now available and the stream should retry.
  final Future<bool> Function()? onUnauthorized;
  final http.Client Function() _clientFactory;
  final Future<void> Function(Duration) _sleep;
  final double Function()? _random;
  final DateTime Function() _now;

  http.Client? _client;
  Timer? _watchdog;
  bool _stopped = true;
  bool _immediate = false;
  int _generation = 0;
  int? _cursor;
  String? _epoch;
  LiveStatus? _status;
  DateTime _lastByteAt = DateTime.fromMillisecondsSinceEpoch(0);

  int? get cursor => _cursor;
  LiveStatus? get status => _status;

  void _setStatus(LiveStatus next) {
    if (_status == next) return;
    _status = next;
    onStatus?.call(next);
  }

  bool _isCurrent(int generation) => !_stopped && generation == _generation;

  /// Starts (or resumes) the stream. The cursor and epoch survive stop(), so
  /// a foreground resume replays what was missed instead of refetching all.
  void start() {
    _stopped = false;
    _generation++;
    _watchdog?.cancel();
    _watchdog = Timer.periodic(_watchdogEvery, (_) {
      if (_status == LiveStatus.live && _now().difference(_lastByteAt) > _staleAfter) {
        _setStatus(LiveStatus.stale);
        _client?.close();
      }
    });
    unawaited(_run(_generation));
  }

  void stop() {
    _stopped = true;
    _generation++;
    _watchdog?.cancel();
    _watchdog = null;
    _client?.close();
  }

  void reconnectNow() {
    if (_stopped) return;
    _immediate = true;
    _client?.close();
  }

  void markOffline() => _setStatus(LiveStatus.offline);

  Future<void> _run(int generation) async {
    var attempt = 0;
    while (_isCurrent(generation)) {
      try {
        await _connectOnce(generation, attempt);
        if (!_isCurrent(generation)) return;
        attempt = 0;
      } catch (_) {
        if (!_isCurrent(generation)) return;
        attempt++;
      }
      if (!_isCurrent(generation)) return;
      if (_immediate) {
        _immediate = false;
        attempt = 0;
        continue;
      }
      if (_status != LiveStatus.stale) _setStatus(LiveStatus.reconnecting);
      await _sleep(backoffDelay(attempt, _random));
    }
  }

  Future<void> _connectOnce(int generation, int attempt) async {
    _setStatus(attempt == 0 ? LiveStatus.connecting : LiveStatus.reconnecting);
    final token = tokenProvider();
    if (token == null || token.isEmpty) {
      _setStatus(LiveStatus.unauthorized);
      _stopped = true;
      return;
    }
    final client = _clientFactory();
    _client = client;
    try {
      final query = _epoch == null ? '' : '?epoch=${Uri.encodeQueryComponent(_epoch!)}';
      final request = http.Request('GET', Uri.parse('$url$query'))
        ..headers.addAll({
          'Authorization': 'Bearer $token',
          'Accept': 'text/event-stream',
          if (_cursor != null) 'Last-Event-ID': '$_cursor',
        });
      final response = await client.send(request);
      if (response.statusCode == 401 || response.statusCode == 403) {
        if (response.statusCode == 401 && onUnauthorized != null && await onUnauthorized!()) return;
        _setStatus(LiveStatus.unauthorized);
        _stopped = true;
        return;
      }
      if (response.statusCode != 200) {
        throw StateError('live stream failed: ${response.statusCode}');
      }
      _lastByteAt = _now();
      var buffer = '';
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        if (!_isCurrent(generation)) return;
        _lastByteAt = _now();
        buffer += chunk;
        final parsed = parseSseBuffer(buffer);
        buffer = parsed.rest;
        final topics = <String>[];
        for (final frame in parsed.frames) {
          Map<String, dynamic> data = const {};
          try {
            final decoded = frame.data.isEmpty ? null : jsonDecode(frame.data);
            if (decoded is Map<String, dynamic>) data = decoded;
          } catch (_) {}
          if (frame.event == 'hello') {
            final nextEpoch = data['epoch'] as String?;
            final changed = _epoch != null && nextEpoch != null && nextEpoch != _epoch;
            _epoch = nextEpoch ?? _epoch;
            if (changed) {
              _cursor = null;
              topics.add('*');
            }
            _setStatus(LiveStatus.live);
          } else if (frame.event == 'reset') {
            _cursor = null;
            topics.add('*');
          } else if (frame.id != null) {
            final id = int.tryParse(frame.id!);
            if (id != null) {
              if (_cursor != null && id <= _cursor!) continue;
              _cursor = id;
            }
            topics.add(frame.event);
          }
        }
        if (topics.isNotEmpty) onEvents(topics);
      }
    } finally {
      client.close();
      if (identical(_client, client)) _client = null;
    }
  }
}
