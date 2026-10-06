import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/services/transfer_draft.dart';

TransferDraft _draft({String? destination = 'loc-2', String? lot = 'lot-1', double? qty = 5, double available = 10, String source = 'loc-1'}) => TransferDraft(
      sourceLocationId: source,
      destinationLocationId: destination,
      itemId: 'item-1',
      lotId: lot,
      quantity: qty,
      availableQuantity: available,
    );

void main() {
  test('only the roles the API accepts can start a transfer', () {
    for (final role in ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER']) {
      expect(roleCanCreateTransfer(role), isTrue, reason: role);
    }
    for (final role in ['WAREHOUSE_PICKER', 'AUDITOR', '']) {
      expect(roleCanCreateTransfer(role), isFalse, reason: role);
    }
  });

  test('a complete draft has no problem and builds the API body', () {
    final draft = _draft();
    expect(draft.problem, isNull);
    expect(draft.toRequestBody(), {
      'sourceLocationId': 'loc-1',
      'destinationLocationId': 'loc-2',
      'lines': [
        {'itemId': 'item-1', 'lotId': 'lot-1', 'quantity': 5.0},
      ],
    });
  });

  test('each mistake is reported, in the order a person would fix them', () {
    expect(_draft(destination: null).problem, TransferDraftProblem.missingDestination);
    expect(_draft(destination: '').problem, TransferDraftProblem.missingDestination);
    expect(_draft(destination: 'loc-1').problem, TransferDraftProblem.sameLocation);
    expect(_draft(lot: null).problem, TransferDraftProblem.missingLot);
    expect(_draft(qty: null).problem, TransferDraftProblem.badQuantity);
    expect(_draft(qty: 0).problem, TransferDraftProblem.badQuantity);
    expect(_draft(qty: -2).problem, TransferDraftProblem.badQuantity);
    expect(_draft(qty: double.nan).problem, TransferDraftProblem.badQuantity);
    expect(_draft(qty: 11, available: 10).problem, TransferDraftProblem.exceedsStock);
    expect(_draft(qty: 10, available: 10).problem, isNull, reason: 'moving everything is allowed');
  });

  test('every problem has a readable message', () {
    for (final problem in TransferDraftProblem.values) {
      expect(transferProblemMessage(problem), isNotEmpty);
    }
  });
}
