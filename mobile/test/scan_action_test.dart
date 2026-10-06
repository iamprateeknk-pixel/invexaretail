import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/scan_action.dart';

const row = CountAssignment(id: 'a1', itemId: 'i1', locationId: 'loc-1');

void main() {
  test('with no assignments only ad-hoc roles may count', () {
    expect(resolveCountTarget(assignments: const [], allowAdHoc: true, itemId: 'i1')!.batchKey, isNull);
    expect(resolveCountTarget(assignments: const [], allowAdHoc: false, itemId: 'i1'), isNull);
  });

  test('with assignments only assigned items resolve, to their batch and location', () {
    final target = resolveCountTarget(assignments: const [row], allowAdHoc: true, itemId: 'i1');
    expect(target!.locationId, 'loc-1');
    expect(target.batchKey, row.batchKey);
    expect(resolveCountTarget(assignments: const [row], allowAdHoc: true, itemId: 'other'), isNull);
  });
}
