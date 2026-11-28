import 'env.dart';

/// The Control Plane (platform administration: companies, plans, users).
const controlPanelOrigin = 'https://admin.invexaretail.com/';

/// Hosts the embedded workspace may navigate to; anything else opens in the default browser.
const workspaceHosts = <String>{'invexaretail.com', 'www.invexaretail.com', 'api.invexaretail.com'};

/// The Control Plane signs in on admin.invexaretail.com and then hands the locked company off to the
/// web app (invexaretail.com/#/control?code=...), so it needs both.
const controlPanelHosts = <String>{...workspaceHosts, 'admin.invexaretail.com'};

/// Only https pages on one of [hosts] may load inside the app.
bool isTrustedWebUri(Uri? uri, Set<String> hosts) {
  if (uri == null || uri.scheme != 'https') return false;
  return hosts.contains(uri.host.toLowerCase());
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
Future<Uri?> signedInWorkspaceUri(Future<String> Function() fetchHandoffCode) async {
  try {
    final code = await fetchHandoffCode();
    if (code.trim().isEmpty) return null;
    return Uri.parse(workspaceOrigin).replace(fragment: '/handoff?code=${Uri.encodeQueryComponent(code)}');
  } catch (_) {
    return null;
  }
}

/// The Control Panel signed in through a linked account (one-time code in the fragment, which is
/// never sent to a server), or the plain panel - which asks for the platform sign-in - when this user
/// is not linked or no code could be fetched. Falling back is safe here: the panel holds no session of
/// its own, because each open wipes its storage first.
Future<Uri> controlPanelUri(Future<String> Function() fetchLinkCode) async {
  final plain = Uri.parse(controlPanelOrigin);
  try {
    final code = await fetchLinkCode();
    if (code.trim().isEmpty) return plain;
    return plain.replace(fragment: 'link=${Uri.encodeComponent(code)}');
  } catch (_) {
    return plain;
  }
}

/// Runs once, before any page script, each time an embedded web surface opens: the previous user's
/// web session (kept in localStorage) is gone before the handoff signs the current user in.
const clearWebStorageScript =
    'try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (e) {}';
