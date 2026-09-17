const productionApiBase = 'https://invexaretail.onrender.com';
const workspaceOrigin = 'https://invexaretail.com/';

String stripTrailingSlash(String value) {
  var next = value.trim();
  while (next.endsWith('/')) {
    next = next.substring(0, next.length - 1);
  }
  return next;
}

/// Empty or whitespace dart-defines fall back to production, matching web
/// `VITE_API_BASE || 'https://invexaretail.onrender.com'`.
String resolveApiBase({String fromDefine = ''}) {
  final defined = stripTrailingSlash(fromDefine);
  if (defined.isNotEmpty) return defined;
  return productionApiBase;
}

String apiBaseFromEnvironment() {
  return resolveApiBase(
    fromDefine: const String.fromEnvironment('INVEXA_API_BASE'),
  );
}
