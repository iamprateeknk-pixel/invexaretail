import '../models/models.dart';

/// Where a scanned item can be counted: the assignment batch (null for an
/// ad-hoc count) and the location that batch belongs to.
class CountTarget {
  const CountTarget({this.batchKey, this.locationId});

  final String? batchKey;
  final String? locationId;
}

/// Mirrors the Count screen's rule: once anything is assigned, only assigned
/// items can be counted (via their batch); with nothing assigned, only roles
/// allowed to count ad hoc may count any item. Null means "not countable".
CountTarget? resolveCountTarget({
  required List<CountAssignment> assignments,
  required bool allowAdHoc,
  required String itemId,
}) {
  if (assignments.isEmpty) return allowAdHoc ? const CountTarget() : null;
  for (final row in assignments) {
    if (row.itemId == itemId) return CountTarget(batchKey: row.batchKey, locationId: row.locationId);
  }
  return null;
}
