import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_windows/webview_windows.dart';

import '../config/theme.dart';
import '../config/web_surfaces.dart';

/// The web workspace or the Control Panel inside the Windows app (Microsoft Edge WebView2), as a tab
/// of the home shell's side menu. The shell keeps a visited tab alive, so switching tabs never
/// reloads it.
///
/// Rights are the web app's own: its menus come from the signed-in user's role
/// (web/src/lib/permissions.js) and the API re-checks every request, so the app adds nothing and
/// takes nothing away. What this view adds is isolation on a shared PC: the first web view opened
/// for a signed-in person clears the PC's cookies, every view wipes its own stored web session
/// before its first page script runs, and only [trustedOrigins] load inside the app.
class DesktopWebView extends StatefulWidget {
  const DesktopWebView({
    super.key,
    required this.sessionKey,
    required this.resolveTarget,
    required this.trustedOrigins,
    this.unavailableMessage = 'The page could not be opened.',
  });

  /// Who is signed in to the app (company + user). Cookies are cleared once per value.
  final String sessionKey;

  /// Where to start. Null means "do not open" (for the workspace: no sign-in code could be fetched).
  final Future<Uri?> Function() resolveTarget;
  final Set<String> trustedOrigins;
  final String unavailableMessage;

  /// The signed-in person whose cookies the shared WebView2 profile currently holds.
  static String? _cookiesClearedFor;

  @visibleForTesting
  static void resetForTest() => _cookiesClearedFor = null;

  /// Whether a view opening for [sessionKey] must clear cookies first. True once per person, so
  /// opening the Control Panel tab does not sign the already-open workspace tab out.
  @visibleForTesting
  static bool claimCookieReset(String sessionKey) {
    if (_cookiesClearedFor == sessionKey) return false;
    _cookiesClearedFor = sessionKey;
    return true;
  }

  @override
  State<DesktopWebView> createState() => _DesktopWebViewState();
}

class _DesktopWebViewState extends State<DesktopWebView> {
  final _controller = WebviewController();
  final _subscriptions = <StreamSubscription<Object?>>[];
  ScriptID? _clearStorageScript;
  bool _ready = false;
  bool _loading = true;
  bool _seenTrustedPage = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    unawaited(_open());
  }

  Future<void> _open() async {
    try {
      await _controller.initialize();
    } on Object {
      // PlatformException (no WebView2 runtime) or MissingPluginException: never crash the app.
      _fail('Microsoft Edge WebView2 is not installed on this PC. Install the "WebView2 Runtime" '
          'from Microsoft, then open this again.');
      return;
    }
    _subscriptions
      ..add(_controller.url.listen(_onUrl))
      ..add(_controller.loadingState.listen(_onLoadingState))
      ..add(_controller.onLoadError.listen((_) => _fail('This page could not be loaded. Check the connection and retry.')));
    // Links that open a new window stay in this view, where the host check below applies to them.
    await _controller.setPopupWindowPolicy(WebviewPopupWindowPolicy.sameWindow);
    await _startClean();
  }

  /// Fresh start: no cookies from someone else, and this page's stored session wiped before its
  /// own scripts run.
  Future<void> _startClean() async {
    final target = await widget.resolveTarget();
    if (!mounted) return;
    if (target == null || !isTrustedWebUri(target, widget.trustedOrigins)) {
      _fail(widget.unavailableMessage);
      return;
    }
    if (DesktopWebView.claimCookieReset(widget.sessionKey)) await _controller.clearCookies();
    _clearStorageScript ??= await _controller.addScriptToExecuteOnDocumentCreated(clearWebStorageScript);
    setState(() {
      _ready = true;
      _loading = true;
      _problem = null;
    });
    await _controller.loadUrl(target.toString());
  }

  void _onLoadingState(LoadingState state) {
    if (state != LoadingState.navigationCompleted) return;
    // The wipe runs for the first page only: the session signed in now survives reloads.
    final script = _clearStorageScript;
    if (script != null) {
      _clearStorageScript = null;
      unawaited(_controller.removeScriptToExecuteOnDocumentCreated(script));
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onUrl(String value) {
    final uri = Uri.tryParse(value);
    if (isTrustedWebUri(uri, widget.trustedOrigins)) {
      _seenTrustedPage = true;
      return;
    }
    if (value == 'about:blank') return;
    // Not ours: never shown inside the app. Go back, and offer https links in the real browser.
    unawaited(_leaveUntrusted(uri));
  }

  Future<void> _leaveUntrusted(Uri? uri) async {
    // History, not a reload of the last trusted URL: the first one carries a spent one-time code.
    if (_seenTrustedPage) {
      await _controller.goBack();
    } else {
      await _controller.stop();
    }
    if (uri != null && uri.scheme == 'https') {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _problem = message;
      _loading = false;
    });
  }

  Future<void> _retry() async {
    setState(() {
      _problem = null;
      _loading = true;
    });
    if (!_controller.value.isInitialized) {
      await _open();
    } else {
      // A retry needs a fresh one-time code, and starts clean again.
      await _startClean();
    }
  }

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(_controller.dispose().catchError((Object _) {}));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final problem = _problem;
    return Column(children: [
      Material(
        color: invexaSurface,
        child: Row(children: [
          IconButton(
            tooltip: 'Back',
            onPressed: _ready && problem == null ? () => _controller.goBack() : null,
            icon: const Icon(Icons.arrow_back),
          ),
          IconButton(
            tooltip: 'Reload (signs in again)',
            onPressed: _retry,
            icon: const Icon(Icons.refresh),
          ),
          const Spacer(),
        ]),
      ),
      if (_loading && problem == null) const LinearProgressIndicator(color: invexaEmerald, minHeight: 2),
      Expanded(
        child: problem != null
            ? Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 480),
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.cloud_off_outlined, size: 48, color: invexaMuted),
                      const SizedBox(height: 16),
                      Text(problem, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16)),
                      const SizedBox(height: 20),
                      FilledButton.icon(onPressed: _retry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
                    ]),
                  ),
                ),
              )
            : _ready
                ? Webview(_controller, permissionRequested: _onPermission)
                : const SizedBox.shrink(),
      ),
    ]);
  }

  /// Only the camera (for barcode scanning in the web app) may be granted, and only to our pages.
  Future<WebviewPermissionDecision> _onPermission(String url, WebviewPermissionKind kind, bool isUserInitiated) async {
    final trusted = isTrustedWebUri(Uri.tryParse(url), widget.trustedOrigins);
    return trusted && kind == WebviewPermissionKind.camera ? WebviewPermissionDecision.allow : WebviewPermissionDecision.deny;
  }
}
