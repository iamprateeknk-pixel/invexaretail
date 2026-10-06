import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/sync_display.dart';

void main() {
  test('known action types read as plain words, unknown ones are tidied', () {
    expect(queuedActionLabel('TRANSFER_RECEIVE'), 'Transfer receipt');
    expect(queuedActionLabel('STOCK_ADJUST'), 'Stock adjust');
    expect(queuedActionLabel(''), 'Saved action');
  });

  test('relative time buckets', () {
    final now = DateTime.utc(2026, 10, 6, 12);
    expect(relativeSavedTime('2026-10-06T11:59:40Z', now), 'just now');
    expect(relativeSavedTime('2026-10-06T11:30:00Z', now), '30 min ago');
    expect(relativeSavedTime('2026-10-06T09:00:00Z', now), '3 h ago');
    expect(relativeSavedTime('2026-10-04T12:00:00Z', now), '2 d ago');
    expect(relativeSavedTime('2026-09-01T12:00:00Z', now), '2026-09-01');
    expect(relativeSavedTime('2026-10-07T12:00:00Z', now), 'just now');
  });
}
