/// Blueprint P4 "Mobile Operations 3.0: conflict engine" - a queued offline
/// mutation must not be retried forever once the server has explicitly said
/// no. This is the shared rule the sync queue uses to decide what a failure
/// means, so the answer is consistent everywhere a mutation is flushed.
enum SyncOutcome {
  /// Transient: the device was offline, or the session expired mid-flush.
  /// Auto-retry on the next flush without bothering the user.
  retry,

  /// The server detected the mutation conflicts with newer server state
  /// (e.g. the stock/version this count or adjustment was based on has since
  /// changed). Stop auto-retrying - the user must review and decide whether
  /// to resubmit or discard, never silently overwrite.
  conflict,

  /// The mutation itself is invalid and will never succeed by retrying
  /// (permission revoked, bad payload, business-rule rejection). Stop
  /// auto-retrying - the user must discard it or fix and resubmit.
  rejected,
}

SyncOutcome classifySyncFailure({required bool isOffline, int? statusCode}) {
  if (isOffline || statusCode == 401) return SyncOutcome.retry;
  if (statusCode == 409) return SyncOutcome.conflict;
  return SyncOutcome.rejected;
}
