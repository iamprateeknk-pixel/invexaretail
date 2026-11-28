import 'env.dart';

Set<String> workspaceWebOrigins(Uri workspace, InvexaEnvironment environment) => {
  workspace.origin,
  if (environment == InvexaEnvironment.production && workspace.origin == Uri.parse(workspaceOrigin).origin) ...{
    'https://www.invexaretail.com', 'https://api.invexaretail.com',
  },
};

/// Only validated origins for the active environment may load inside the app.
bool isTrustedWebUri(Uri? uri, Set<String> origins) {
  if (uri == null || !uri.hasAuthority || uri.userInfo.isNotEmpty || (uri.scheme != 'https' && uri.scheme != 'http')) return false;
  return origins.contains(uri.origin);
}

/// Who sees the Control Panel entry. Same rule as the web app's `adminOnly` sections
/// (web/src/lib/workspace.js: `item.adminOnly && role !== 'ADMIN'`), so the app never offers more
/// than the web does. The panel still asks for its own platform sign-in; this only hides the door.
bool canOpenControlPanel(String role) => role == 'ADMIN';

/// The embedded workspace URL, signed in as the app's current user through a one-time code.
///
/// Fails closed: returns null when no code could be obtained. Opening the plain workspace instead
/// would let the embedded browser fall back to whatever session it last held - on a shared counter
/// PC that is someone else's account and someone else's rights.
Future<Uri?> signedInWorkspaceUri(Uri workspace, Future<String> Function() fetchHandoffCode) async {
  try {
    final code = await fetchHandoffCode();
    if (code.trim().isEmpty) return null;
    return workspace.replace(fragment: '/handoff?code=${Uri.encodeQueryComponent(code)}');
  } catch (_) {
    return null;
  }
}

/// Runs once, before any page script, each time an embedded web surface opens: the previous user's
/// web session (kept in localStorage) is gone before the handoff signs the current user in.
const clearWebStorageScript =
    'try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (e) {}';
