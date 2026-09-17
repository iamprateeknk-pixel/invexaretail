import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/sync_resolution.dart';

void main() {
  test('offline and expired-session failures are retried automatically', () {
    expect(classifySyncFailure(isOffline: true), SyncOutcome.retry);
    expect(classifySyncFailure(isOffline: false, statusCode: 401), SyncOutcome.retry);
  });

  test('a 409 means the server saw a real conflict - stop auto-retrying', () {
    expect(classifySyncFailure(isOffline: false, statusCode: 409), SyncOutcome.conflict);
  });

  test('any other rejection will never succeed by retrying', () {
    expect(classifySyncFailure(isOffline: false, statusCode: 400), SyncOutcome.rejected);
    expect(classifySyncFailure(isOffline: false, statusCode: 403), SyncOutcome.rejected);
    expect(classifySyncFailure(isOffline: false, statusCode: 422), SyncOutcome.rejected);
    expect(classifySyncFailure(isOffline: false, statusCode: 500), SyncOutcome.rejected);
  });
}
