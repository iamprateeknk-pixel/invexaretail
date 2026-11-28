import '../models/models.dart';

class OperationalOfflineCommand {
  const OperationalOfflineCommand._(
    this.type,
    this.commandId,
    this.entityId,
    this.revision,
    this.permit,
    this.payload,
  );

  static const version = 2;
  static final _commandKey = RegExp(r'^[A-Za-z0-9._:-]{8,128}$');
  static final _resourceId = RegExp(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$');
  static final _opaqueRevision = RegExp(r'^[a-f0-9]{64}$');
  static final _pickPath = RegExp(
    r'^/api/v1/picker/transfers/([^/]+)/pick-slips$',
  );
  static final _receivePath = RegExp(r'^/api/v1/transfers/([^/]+)/receive$');
  static final _putawayPath = RegExp(
    r'^/api/v1/putaway-tasks/([^/]+)/confirm$',
  );

  final String type;
  final String commandId;
  final String entityId;
  final String revision;
  final String permit;
  final Map<String, dynamic> payload;

  static OperationalOfflineCommand? fromQueue(QueuedOperation item) =>
      switch (item) {
        QueuedCount() => _count(item),
        QueuedAction() => _warehouse(item),
      };

  static OperationalOfflineCommand? _count(QueuedCount item) {
    final permit = item.offlineCountPermit;
    final revision = item.stockRevision;
    if (permit == null ||
        revision == null ||
        !_opaqueRevision.hasMatch(revision) ||
        !_commandKey.hasMatch(item.requestId) ||
        !_resourceId.hasMatch(item.itemId) ||
        !_resourceId.hasMatch(item.locationId) ||
        !const {'weight', 'scan', 'manual'}.contains(item.mode)) {
      return null;
    }
    final weight = item.mode == 'weight';
    return OperationalOfflineCommand._(
      'COUNT_SUBMIT',
      item.requestId,
      item.itemId,
      revision,
      permit,
      {
        'locationId': item.locationId,
        'mode': item.mode,
        if (weight)
          'totalQuantity': item.physicalQuantity
        else
          'physicalQuantity': item.physicalQuantity,
        if (!weight && item.lotNo != null && item.lotNo!.isNotEmpty)
          'lotNo': item.lotNo,
      },
    );
  }

  static OperationalOfflineCommand? _warehouse(QueuedAction item) {
    final permit = item.body['offlinePermit'];
    if (permit is! String ||
        !_commandKey.hasMatch(item.mutationId) ||
        item.method != 'POST') {
      return null;
    }
    final workflow = switch (item.type) {
      'PICK' => (
        type: 'PICK_CONFIRM',
        path: _pickPath,
        revision: 'pickRevision',
        fields: ['lines', 'exceptions', 'finished', 'startedAt'],
      ),
      'TRANSFER_RECEIVE' => (
        type: 'RECEIVE_CONFIRM',
        path: _receivePath,
        revision: 'receiveRevision',
        fields: ['lines', 'notes', 'qcInspections'],
      ),
      'PUTAWAY' => (
        type: 'PUTAWAY_CONFIRM',
        path: _putawayPath,
        revision: 'taskRevision',
        fields: ['scannedBinCode'],
      ),
      _ => null,
    };
    if (workflow == null) return null;
    final entityId = workflow.path.firstMatch(item.path)?.group(1);
    final revision = item.body[workflow.revision];
    if (entityId == null ||
        !_resourceId.hasMatch(entityId) ||
        revision is! String) {
      return null;
    }
    if (item.type == 'PUTAWAY') {
      if (!revision.endsWith('Z') ||
          DateTime.tryParse(revision) == null ||
          item.body['requireScan'] != true) {
        return null;
      }
    } else if (!_opaqueRevision.hasMatch(revision) ||
        item.body['requestId'] != item.mutationId) {
      return null;
    }
    return OperationalOfflineCommand._(
      workflow.type,
      item.mutationId,
      entityId,
      revision,
      permit,
      {
        for (final field in workflow.fields)
          if (item.body.containsKey(field)) field: item.body[field],
      },
    );
  }

  Map<String, dynamic> toJson() => {
    'contractVersion': version,
    'type': type,
    'commandId': commandId,
    'entityId': entityId,
    'revision': revision,
    'permit': permit,
    'payload': payload,
  };
}
