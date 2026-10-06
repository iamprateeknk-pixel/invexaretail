/// Rules for starting a stock transfer from the phone. The server stays the
/// authority (it reserves stock atomically and re-checks everything); this only
/// catches the mistakes that are cheap to catch before a network round trip.
const transferCreatorRoles = <String>['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'];

/// Mirrors the API's canCreateTransfer (api/src/lib/transfer-lifecycle.ts).
bool roleCanCreateTransfer(String role) => transferCreatorRoles.contains(role);

enum TransferDraftProblem { sameLocation, missingDestination, missingLot, badQuantity, exceedsStock }

class TransferDraft {
  const TransferDraft({
    required this.sourceLocationId,
    required this.destinationLocationId,
    required this.itemId,
    required this.lotId,
    required this.quantity,
    required this.availableQuantity,
  });

  final String sourceLocationId;
  final String? destinationLocationId;
  final String itemId;
  final String? lotId;
  final double? quantity;
  final double availableQuantity;

  /// The first thing wrong with the draft, or null when it can be sent.
  TransferDraftProblem? get problem {
    final destination = destinationLocationId;
    if (destination == null || destination.isEmpty) return TransferDraftProblem.missingDestination;
    if (destination == sourceLocationId) return TransferDraftProblem.sameLocation;
    if (lotId == null || lotId!.isEmpty) return TransferDraftProblem.missingLot;
    final qty = quantity;
    if (qty == null || !qty.isFinite || qty <= 0) return TransferDraftProblem.badQuantity;
    if (qty > availableQuantity) return TransferDraftProblem.exceedsStock;
    return null;
  }

  /// Body for POST /api/v1/transfers. Only valid when [problem] is null.
  Map<String, Object> toRequestBody() {
    assert(problem == null, 'toRequestBody called on an invalid draft');
    return {
      'sourceLocationId': sourceLocationId,
      'destinationLocationId': destinationLocationId!,
      'lines': [
        {'itemId': itemId, 'lotId': lotId!, 'quantity': quantity!},
      ],
    };
  }
}

String transferProblemMessage(TransferDraftProblem problem) {
  switch (problem) {
    case TransferDraftProblem.sameLocation:
      return 'Choose a different destination than this location.';
    case TransferDraftProblem.missingDestination:
      return 'Choose where the stock is going.';
    case TransferDraftProblem.missingLot:
      return 'Choose which lot to move.';
    case TransferDraftProblem.badQuantity:
      return 'Enter a quantity greater than zero.';
    case TransferDraftProblem.exceedsStock:
      return 'That is more than this location has in stock.';
  }
}
