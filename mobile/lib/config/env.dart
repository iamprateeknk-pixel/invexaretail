import 'dart:convert';

import 'package:crypto/crypto.dart';

const productionApiBase = 'https://invexaretail.com';
const _retiredProductionApiHost = 'invexaretail-api-production.up.railway.app';
const workspaceOrigin = 'https://invexaretail.com/';

/// Which build this is (plan Area H WP4). Set with `--dart-define=INVEXA_ENV=...`.
/// Release builds default to `production`, which refuses any endpoint that is not an
/// https, public host - so a store never ships an APK that talks to a developer machine.
enum InvexaEnvironment { production, staging, development }

InvexaEnvironment parseEnvironment(String value) {
  switch (value.trim().toLowerCase()) {
    case 'development':
    case 'dev':
      return InvexaEnvironment.development;
    case 'staging':
      return InvexaEnvironment.staging;
    case 'production':
    case 'prod':
      return InvexaEnvironment.production;
    default:
      throw StateError('INVEXA_ENV must be production, staging, or development.');
  }
}

String stripTrailingSlash(String value) {
  var next = value.trim();
  while (next.endsWith('/')) {
    next = next.substring(0, next.length - 1);
  }
  return next;
}

bool _isPrivateHost(String host) {
  final lower = host.toLowerCase();
  if (lower == 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal') || !lower.contains('.')) return true;
  final parts = lower.split('.');
  if (parts.length == 4 && parts.every((part) => int.tryParse(part) != null)) {
    final a = int.parse(parts[0]);
    final b = int.parse(parts[1]);
    return a == 10 || a == 127 || a == 0 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
  }
  return false;
}

/// Null when [base] is acceptable for [environment], otherwise why it is not.
String? apiBaseProblem(String base, InvexaEnvironment environment) {
  return _originProblem(base, environment, 'INVEXA_API_BASE');
}

String? _originProblem(String value, InvexaEnvironment environment, String name) {
  final input = value.trim();
  final uri = Uri.tryParse(input);
  if (uri == null || uri.host.isEmpty ||
      !RegExp(r'^https?://[^\s/?#\\@]+/?$', caseSensitive: false).hasMatch(input)) {
    return '$name must be an HTTP or HTTPS origin without a path, credentials, query, or fragment.';
  }
  if (environment == InvexaEnvironment.development) return null;
  if (uri.scheme != 'https') return '$name requires HTTPS in ${environment.name}.';
  final host = uri.host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
  if (_isPrivateHost(host)) return '$name requires a public host in ${environment.name}.';
  if (environment == InvexaEnvironment.staging && _productionHosts.contains(host)) {
    return '$name cannot use a production host in staging.';
  }
  return null;
}

final _productionHosts = {
  Uri.parse(productionApiBase).host,
  Uri.parse(workspaceOrigin).host,
  _retiredProductionApiHost,
  'api.invexaretail.com',
  'www.invexaretail.com',
  'invexaretail-web.iamprateek-nk.workers.dev',
};

String resolveApiBase({String fromDefine = '', InvexaEnvironment environment = InvexaEnvironment.production}) {
  return _resolveOrigin(fromDefine, environment, 'INVEXA_API_BASE', productionApiBase, 'http://127.0.0.1:4000');
}

Uri resolveWorkspaceOrigin({String fromDefine = '', InvexaEnvironment environment = InvexaEnvironment.production}) {
  final origin = _resolveOrigin(fromDefine, environment, 'INVEXA_WEB_APP_URL', workspaceOrigin, 'http://127.0.0.1:5173');
  return Uri.parse('$origin/');
}

String _resolveOrigin(String input, InvexaEnvironment environment, String name, String production, String development) {
  final defined = input.trim();
  final base = defined.isNotEmpty ? defined : switch (environment) {
    InvexaEnvironment.production => production,
    InvexaEnvironment.development => development,
    InvexaEnvironment.staging => throw StateError('$name is required in staging.'),
  };
  final problem = _originProblem(base, environment, name);
  if (problem != null) throw StateError(problem);
  return Uri.parse(base).origin;
}

InvexaEnvironment environmentFromDefines() =>
    parseEnvironment(const String.fromEnvironment('INVEXA_ENV', defaultValue: 'production'));

String apiBaseFromEnvironment() {
  return resolveApiBase(
    fromDefine: const String.fromEnvironment('INVEXA_API_BASE'),
    environment: environmentFromDefines(),
  );
}

Uri workspaceFromEnvironment() => resolveWorkspaceOrigin(
  fromDefine: const String.fromEnvironment('INVEXA_WEB_APP_URL'),
  environment: environmentFromDefines(),
);

/// Keep the existing production store for upgrades. Other API targets get
/// separate credentials, queued work, and cached reads even on the same device.
String? localStorageScope(InvexaEnvironment environment, String apiOrigin) {
  if (environment == InvexaEnvironment.production && apiOrigin == productionApiBase) return null;
  return sha256.convert(utf8.encode('${environment.name}|$apiOrigin')).toString();
}
