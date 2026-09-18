import 'dart:convert';

int asInt(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.round();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

double asDouble(Object? value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

String asString(Object? value, [String fallback = '']) {
  if (value == null) return fallback;
  return value.toString();
}

Map<String, dynamic> asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return {};
}

List<dynamic> asList(Object? value) {
  if (value is List) return value;
  return const [];
}

bool canSeeBookQuantity(String role) => role != 'STORE_USER';

bool canSubmitAdHocCount(String role) =>
    role == 'ADMIN' || role == 'ADMIN_USER' || role == 'BRANCH_MANAGER' || role == 'AUDITOR';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  bool get isOffline => statusCode == null;

  @override
  String toString() => message;
}

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.companyId,
    this.branchIds = const [],
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final String? companyId;
  final List<String> branchIds;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: asString(json['id']),
      name: asString(json['name']),
      email: asString(json['email']),
      role: asString(json['role']),
      companyId: json['companyId'] == null ? null : asString(json['companyId']),
      branchIds: asList(json['branchIds']).map(asString).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'email': email,
        'role': role,
        if (companyId != null) 'companyId': companyId,
        'branchIds': branchIds,
      };
}

class LoginResult {
  const LoginResult({
    required this.token,
    required this.user,
    this.refreshToken,
  });

  final String token;
  final String? refreshToken;
  final AuthUser user;

  factory LoginResult.fromJson(Map<String, dynamic> json) {
    final token = asString(json['token']);
    if (token.isEmpty) {
      throw ApiException('Login did not return an access token.');
    }
    return LoginResult(
      token: token,
      refreshToken: json['refreshToken'] == null ? null : asString(json['refreshToken']),
      user: AuthUser.fromJson(asMap(json['user'])),
    );
  }
}

class SendOtpResult {
  const SendOtpResult({
    required this.message,
    required this.delivery,
    required this.expiresIn,
    this.otpCode,
  });

  final String message;
  final String delivery;
  final int expiresIn;
  final String? otpCode;

  factory SendOtpResult.fromJson(Map<String, dynamic> json) {
    final otpCode = asString(json['otpCode']);
    return SendOtpResult(
      message: asString(json['message'], 'OTP sent to your email'),
      delivery: asString(json['delivery']),
      expiresIn: asInt(json['expiresIn'], 600),
      otpCode: otpCode.isEmpty ? null : otpCode,
    );
  }
}

class DashboardSummary {
  const DashboardSummary({
    required this.pendingCounts,
    required this.transferRequests,
    required this.expiredTillDate,
    required this.nearExpiryThisMonth,
    required this.nearExpiryNextMonth,
    required this.countCompletionPercent,
    required this.transferSlaPercent,
    required this.stockAccuracyPercent,
  });

  final int pendingCounts;
  final int transferRequests;
  final int expiredTillDate;
  final int nearExpiryThisMonth;
  final int nearExpiryNextMonth;
  final double countCompletionPercent;
  final double transferSlaPercent;
  final double stockAccuracyPercent;

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    final payload = json.containsKey('dashboard') ? asMap(json['dashboard']) : json;
    return DashboardSummary(
      pendingCounts: asInt(payload['pendingCounts']),
      transferRequests: asInt(payload['transferRequests']),
      expiredTillDate: asInt(payload['expiredTillDate']),
      nearExpiryThisMonth: asInt(payload['nearExpiryThisMonth']),
      nearExpiryNextMonth: asInt(payload['nearExpiryNextMonth']),
      countCompletionPercent: asDouble(payload['countCompletionPercent']),
      transferSlaPercent: asDouble(payload['transferSlaPercent']),
      stockAccuracyPercent: asDouble(payload['stockAccuracyPercent']),
    );
  }
}

class LocationRecord {
  const LocationRecord({
    required this.id,
    required this.name,
    required this.type,
  });

  final String id;
  final String name;
  final String type;

  factory LocationRecord.fromJson(Map<String, dynamic> json) {
    return LocationRecord(
      id: asString(json['id']),
      name: asString(json['name'], asString(json['id'])),
      type: asString(json['type'], 'store'),
    );
  }
}

class LotRecord {
  const LotRecord({
    required this.id,
    required this.lotNo,
    this.expiryDate,
    this.status,
  });

  final String id;
  final String lotNo;
  final String? expiryDate;
  final String? status;

  factory LotRecord.fromJson(Map<String, dynamic> json) {
    return LotRecord(
      id: asString(json['id']),
      lotNo: asString(json['lotNo'], asString(json['id'])),
      expiryDate: json['expiryDate'] == null ? null : asString(json['expiryDate']),
      status: json['status'] == null ? null : asString(json['status']),
    );
  }
}

class CatalogItem {
  const CatalogItem({
    required this.id,
    required this.code,
    required this.name,
    this.unit,
    this.barcode,
    this.lots = const [],
  });

  final String id;
  final String code;
  final String name;
  final String? unit;
  final String? barcode;
  final List<LotRecord> lots;

  factory CatalogItem.fromJson(Map<String, dynamic> json) {
    return CatalogItem(
      id: asString(json['id']),
      code: asString(json['code'], asString(json['sku'])),
      name: asString(json['name'], asString(json['id'])),
      unit: json['unit'] == null ? null : asString(json['unit']),
      barcode: json['barcode'] == null ? null : asString(json['barcode']),
      lots: asList(json['lots']).map((row) => LotRecord.fromJson(asMap(row))).toList(),
    );
  }
}

class StockRow {
  const StockRow({
    required this.itemId,
    required this.locationId,
    this.lotId,
    this.bookQuantity,
    this.physicalQuantity,
    this.variance,
    this.stockValue,
  });

  final String itemId;
  final String locationId;
  final String? lotId;
  final int? bookQuantity;
  final int? physicalQuantity;
  final int? variance;
  final double? stockValue;

  factory StockRow.fromJson(Map<String, dynamic> json) {
    return StockRow(
      itemId: asString(json['itemId']),
      locationId: asString(json['locationId']),
      lotId: json['lotId'] == null ? null : asString(json['lotId']),
      bookQuantity: json.containsKey('bookQuantity') ? asInt(json['bookQuantity']) : null,
      physicalQuantity: json.containsKey('physicalQuantity') ? asInt(json['physicalQuantity']) : null,
      variance: json.containsKey('variance') ? asInt(json['variance']) : null,
      stockValue: json.containsKey('stockValue') ? asDouble(json['stockValue']) : null,
    );
  }
}

class CountRecord {
  const CountRecord({
    required this.id,
    required this.itemId,
    required this.locationId,
    required this.physicalQuantity,
    this.lotId,
    this.bookQty,
    this.variance,
    this.mode,
    this.submittedBy,
    this.status,
    this.createdAt,
  });

  final String id;
  final String itemId;
  final String locationId;
  final int physicalQuantity;
  final String? lotId;
  final int? bookQty;
  final int? variance;
  final String? mode;
  final String? submittedBy;
  final String? status;
  final String? createdAt;

  factory CountRecord.fromJson(Map<String, dynamic> json) {
    return CountRecord(
      id: asString(json['id']),
      itemId: asString(json['itemId']),
      locationId: asString(json['locationId']),
      physicalQuantity: asInt(json['physicalQuantity'] ?? json['qty']),
      lotId: json['lotId'] == null ? null : asString(json['lotId']),
      bookQty: json.containsKey('bookQty') ? asInt(json['bookQty']) : null,
      variance: json.containsKey('variance') ? asInt(json['variance']) : null,
      mode: json['mode'] == null ? null : asString(json['mode']),
      submittedBy: json['submittedBy'] == null ? null : asString(json['submittedBy']),
      status: json['status'] == null ? null : asString(json['status']),
      createdAt: json['createdAt'] == null ? null : asString(json['createdAt']),
    );
  }
}

class TransferLine {
  const TransferLine({
    required this.itemId,
    required this.quantity,
    this.lotId,
  });

  final String itemId;
  final String? lotId;
  final int quantity;

  factory TransferLine.fromJson(Map<String, dynamic> json) {
    return TransferLine(
      itemId: asString(json['itemId']),
      lotId: json['lotId'] == null ? null : asString(json['lotId']),
      quantity: asInt(json['quantity']),
    );
  }
}

class TransferRecord {
  const TransferRecord({
    required this.id,
    required this.sourceLocationId,
    required this.destinationLocationId,
    required this.status,
    this.cartonCount,
    this.lines = const [],
    this.createdAt,
  });

  final String id;
  final String sourceLocationId;
  final String destinationLocationId;
  final String status;
  final int? cartonCount;
  final List<TransferLine> lines;
  final String? createdAt;

  int get totalQuantity =>
      lines.fold<int>(0, (sum, line) => sum + line.quantity);

  factory TransferRecord.fromJson(Map<String, dynamic> json) {
    return TransferRecord(
      id: asString(json['id']),
      sourceLocationId: asString(json['sourceLocationId']),
      destinationLocationId: asString(json['destinationLocationId']),
      status: asString(json['status']),
      cartonCount: json.containsKey('cartonCount') ? asInt(json['cartonCount']) : null,
      lines: asList(json['lines']).map((row) => TransferLine.fromJson(asMap(row))).toList(),
      createdAt: json['createdAt'] == null ? null : asString(json['createdAt']),
    );
  }
}

class CountAssignment {
  const CountAssignment({
    required this.id,
    required this.itemId,
    required this.locationId,
    this.itemName,
    this.itemCode,
    this.priority,
    this.dueDate,
    this.status,
    this.countDate,
    this.assignedById,
    this.instructions,
  });

  final String id;
  final String itemId;
  final String locationId;
  final String? itemName;
  final String? itemCode;
  final String? priority;
  final String? dueDate;
  final String? status;
  final String? countDate;
  final String? assignedById;
  final String? instructions;

  /// Every item assigned to a store user in one admin action shares the
  /// same location, assigner, and countDate timestamp - grouping on that
  /// tuple reconstructs "one assignment batch" so each batch can be shown
  /// to the user as its own separate stock count instead of one merged
  /// list of every item ever assigned to them.
  String get batchKey => '$locationId|${assignedById ?? ''}|${countDate ?? ''}';

  factory CountAssignment.fromJson(Map<String, dynamic> json) {
    return CountAssignment(
      id: asString(json['id']),
      itemId: asString(json['itemId']),
      locationId: asString(json['locationId']),
      itemName: json['itemName'] == null ? null : asString(json['itemName']),
      itemCode: json['itemCode'] == null ? null : asString(json['itemCode']),
      priority: json['priority'] == null ? null : asString(json['priority']),
      dueDate: json['dueDate'] == null ? null : asString(json['dueDate']),
      status: json['status'] == null ? null : asString(json['status']),
      countDate: json['countDate'] == null ? null : asString(json['countDate']),
      assignedById: json['assignedById'] == null ? null : asString(json['assignedById']),
      instructions: json['instructions'] == null ? null : asString(json['instructions']),
    );
  }
}

class QueuedCount {
  QueuedCount({
    required this.localId,
    required this.itemId,
    required this.locationId,
    required this.physicalQuantity,
    this.lotNo,
    this.mode = 'manual',
    required this.createdAt,
    this.attempts = 0,
    this.lastError,
    this.status = 'pending',
  });

  final String localId;
  final String itemId;
  final String locationId;
  final int physicalQuantity;
  final String? lotNo;
  final String mode;
  final String createdAt;
  int attempts;
  String? lastError;
  // 'pending' auto-retries on the next flush; 'conflict'/'rejected' stop
  // auto-retrying and wait for the user to retry or discard (see
  // classifySyncFailure in sync_resolution.dart).
  String status;

  factory QueuedCount.fromJson(Map<String, dynamic> json) {
    return QueuedCount(
      localId: asString(json['localId']),
      itemId: asString(json['itemId']),
      locationId: asString(json['locationId']),
      physicalQuantity: asInt(json['physicalQuantity']),
      lotNo: json['lotNo'] == null || asString(json['lotNo']).isEmpty ? null : asString(json['lotNo']),
      mode: asString(json['mode'], 'manual'),
      createdAt: asString(json['createdAt']),
      attempts: asInt(json['attempts']),
      lastError: json['lastError'] == null ? null : asString(json['lastError']),
      status: asString(json['status'], 'pending'),
    );
  }

  Map<String, dynamic> toJson() => {
        'localId': localId,
        'itemId': itemId,
        'locationId': locationId,
        'physicalQuantity': physicalQuantity,
        'lotNo': lotNo,
        'mode': mode,
        'createdAt': createdAt,
        'attempts': attempts,
        'lastError': lastError,
        'status': status,
      };
}

String lookupItemName(List<CatalogItem> items, String itemId) {
  for (final item in items) {
    if (item.id == itemId) return item.name;
  }
  return itemId;
}

String lookupLotNo(List<CatalogItem> items, String itemId, String? lotId) {
  if (lotId == null || lotId.isEmpty) return '';
  for (final item in items) {
    if (item.id != itemId) continue;
    for (final lot in item.lots) {
      if (lot.id == lotId) return lot.lotNo;
    }
  }
  return lotId;
}

String lookupLocationName(List<LocationRecord> locations, String locationId) {
  for (final location in locations) {
    if (location.id == locationId) return location.name;
  }
  return locationId;
}

List<QueuedCount> decodeQueuedCounts(String? raw) {
  if (raw == null || raw.trim().isEmpty) return [];
  try {
    final decoded = jsonDecode(raw);
    return asList(decoded).map((row) => QueuedCount.fromJson(asMap(row))).toList();
  } catch (_) {
    return [];
  }
}

String encodeQueuedCounts(List<QueuedCount> items) {
  return jsonEncode(items.map((item) => item.toJson()).toList());
}

class QueuedAction {
  QueuedAction({
    required this.localId,
    required this.type,
    required this.method,
    required this.path,
    required this.body,
    required this.createdAt,
    this.attempts = 0,
    this.lastError,
    this.status = 'pending',
  });

  final String localId;
  final String type;
  final String method;
  final String path;
  final Map<String, dynamic> body;
  final String createdAt;
  int attempts;
  String? lastError;
  // See QueuedCount.status - same conflict/rejected/pending contract.
  String status;

  factory QueuedAction.fromJson(Map<String, dynamic> json) {
    return QueuedAction(
      localId: asString(json['localId']),
      type: asString(json['type']),
      method: asString(json['method'], 'POST'),
      path: asString(json['path']),
      body: asMap(json['body']),
      createdAt: asString(json['createdAt']),
      attempts: asInt(json['attempts']),
      lastError: json['lastError'] == null ? null : asString(json['lastError']),
      status: asString(json['status'], 'pending'),
    );
  }

  Map<String, dynamic> toJson() => {
        'localId': localId,
        'type': type,
        'method': method,
        'path': path,
        'body': body,
        'createdAt': createdAt,
        'attempts': attempts,
        'status': status,
        'lastError': lastError,
      };
}

List<QueuedAction> decodeQueuedActions(String? raw) {
  if (raw == null || raw.trim().isEmpty) return [];
  try {
    final decoded = jsonDecode(raw);
    return asList(decoded).map((row) => QueuedAction.fromJson(asMap(row))).toList();
  } catch (_) {
    return [];
  }
}

String encodeQueuedActions(List<QueuedAction> items) {
  return jsonEncode(items.map((item) => item.toJson()).toList());
}
