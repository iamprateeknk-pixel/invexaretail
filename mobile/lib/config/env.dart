const productionApiBase = 'https://invexaretail-api-production.up.railway.app';
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
    default:
      return InvexaEnvironment.production;
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
  if (environment == InvexaEnvironment.development) return null;
  final uri = Uri.tryParse(base);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) return 'API base "$base" is not a valid URL.';
  if (uri.scheme != 'https') return 'The ${environment.name} build requires an https API base, got "$base".';
  if (_isPrivateHost(uri.host)) return 'The ${environment.name} build cannot use the private or local host "${uri.host}".';
  return null;
}

/// Empty or whitespace dart-defines fall back to production, matching web
/// `VITE_API_BASE || 'https://invexaretail-api-production.up.railway.app'`.
/// A non-development build throws on an unsafe endpoint instead of running with it.
String resolveApiBase({String fromDefine = '', InvexaEnvironment environment = InvexaEnvironment.production}) {
  final defined = stripTrailingSlash(fromDefine);
  final base = defined.isNotEmpty ? defined : productionApiBase;
  final problem = apiBaseProblem(base, environment);
  if (problem != null) throw StateError(problem);
  return base;
}

InvexaEnvironment environmentFromDefines() =>
    parseEnvironment(const String.fromEnvironment('INVEXA_ENV', defaultValue: 'production'));

String apiBaseFromEnvironment() {
  return resolveApiBase(
    fromDefine: const String.fromEnvironment('INVEXA_API_BASE'),
    environment: environmentFromDefines(),
  );
}
