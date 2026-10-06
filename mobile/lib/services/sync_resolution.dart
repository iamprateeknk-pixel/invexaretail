import 'dart:math' as math;

/// Blueprint P4 "Mobile Operations 3.0: conflict engine" - a queued offline
/// mutation must not be retried forever once the server has explicitly said
/// no, and must not be given up on just because the network or the server had
/// a bad moment. This is the shared rule the sync queue uses to decide what a
/// failure means, so the answer is consistent everywhere a mutation is flushed.
enum SyncOutcome {
  /// Transient: the device was offline, the session expired mid-flush, the
  /// request timed out, was rate limited, or the server had a temporary
  /// error. Retry later with backoff, without bothering the user.
  retry,

  /// The server detected the mutation conflicts with newer server state. Stop
  /// auto-retrying - the user must review and decide, never silently overwrite.
  conflict,

  /// The mutation itself is invalid and will never succeed by retrying
  /// (permission revoked, bad payload, business-rule rejection). Stop
  /// auto-retrying - the user must discard it or fix and resubmit.
  rejected,
}

/// After this many failed attempts with a server-side transient status, the
/// failure is treated as permanent: a deterministic server bug must not be
/// retried forever. Being offline never counts against this.
const maxTransientServerAttempts = 10;

const _transientStatuses = {408, 425, 429};

bool isTransientServerStatus(int statusCode) => _transientStatuses.contains(statusCode) || statusCode >= 500;

SyncOutcome classifySyncFailure({required bool isOffline, int? statusCode, int attempts = 0}) {
  if (isOffline || statusCode == 401) return SyncOutcome.retry;
  if (statusCode == 409) return SyncOutcome.conflict;
  if (statusCode != null && isTransientServerStatus(statusCode)) {
    return attempts >= maxTransientServerAttempts ? SyncOutcome.rejected : SyncOutcome.retry;
  }
  return SyncOutcome.rejected;
}

const _baseDelaySeconds = 5;
const _maxDelaySeconds = 15 * 60;
const _maxRetryAfterSeconds = 60 * 60;

/// How long to wait before the next automatic attempt: exponential backoff
/// (5 s, 10 s, 20 s ... capped at 15 min) with +/-20% jitter so a whole fleet
/// coming back online does not retry in lockstep. A server Retry-After wins
/// when it asks for longer.
Duration retryDelay({required int attempts, int? retryAfterSeconds, math.Random? random}) {
  final step = math.min(attempts < 1 ? 0 : attempts - 1, 20);
  final backoff = math.min(_baseDelaySeconds * math.pow(2, step).toInt(), _maxDelaySeconds);
  final jitter = 0.8 + 0.4 * (random ?? math.Random()).nextDouble();
  final computed = (backoff * jitter).round();
  final requested = retryAfterSeconds == null ? 0 : math.min(retryAfterSeconds, _maxRetryAfterSeconds);
  return Duration(seconds: math.max(computed, requested));
}

/// True when an item with [nextAttemptAt] may be attempted at [now].
bool isDueForAttempt(String? nextAttemptAt, DateTime now) {
  if (nextAttemptAt == null || nextAttemptAt.isEmpty) return true;
  final due = DateTime.tryParse(nextAttemptAt);
  return due == null || !due.isAfter(now);
}
