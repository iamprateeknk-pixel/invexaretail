import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_windows/webview_windows.dart';

import '../config/theme.dart';
import '../config/web_surfaces.dart';

/// The web workspace or the Control Panel inside the Windows app (Microsoft Edge WebView2).
///
/// Rights are the web app's own: its menus come from the signed-in user's role
/// (web/src/lib/permissions.js) and the API re-checks every request, so the app adds nothing and
/// takes nothing away. What this screen adds is isolation on a shared PC: every open starts with
/// no cookies and no stored web session, so only the person signed in to the app can be signed in
/// here, and only [trustedHosts] load inside the app.
class DesktopWebScreen extends StatefulWidget {
  const DesktopWebScreen({
    super.key,
    required this.title,
    required this.resolveTarget,
    required this.trustedHosts,
    this.unavailableMessage = 'The page could not be opened.',
  });

  final String title;

  /// Where to start. Null means "do not open" (for the workspace: no sign-in code could be fetched).
  final Future<Uri?> Function() resolveTarget;
  final Set<String> trustedHosts;
  final String unavailableMessage;

  @override
  State<DesktopWebScreen> createState() => _DesktopWebScreenState();
}

class _DesktopWebScreenState extends State<DesktopWebScreen> {
  final _controller = WebviewController();
  final _subscriptions = <StreamSubscription<Object?>>[];
  ScriptID? _clearStorageScript;
  bool _ready = false;
  bool _loading = true;
  String? _problem;
  bool _seenTrustedPage = false;

  @override
  void initState() {
    super.initState();
    unawaited(_open());
  }

  Future<void> _open() async {
    try {
      await _controller.initialize();
    } on PlatformException {
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

  /// Fresh start: drop cookies and, before the first page's own scripts run, its stored session.
  Future<void> _startClean() async {
    final target = await widget.resolveTarget();
    if (!mounted) return;
    if (target == null || !isTrustedWebUri(target, widget.trustedHosts)) {
      _fail(widget.unavailableMessage);
      return;
    }
    await _controller.clearCookies();
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
    // The clean-up must run once only: removing it now keeps the newly signed-in session through
    // reloads and in-app navigation.
    final script = _clearStorageScript;
    if (script != null) {
      _clearStorageScript = null;
      unawaited(_controller.removeScriptToExecuteOnDocumentCreated(script));
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onUrl(String value) {
    final uri = Uri.tryParse(value);
    if (isTrustedWebUri(uri, widget.trustedHosts)) {
      _seenTrustedPage = true;
      return;
    }
    if (value == 'about:blank') return;
    // Not ours: never shown inside the app. Go back, and offer https links in the real browser.
    unawaited(_leaveUntrusted(uri));
  }

  Future<void> _leaveUntrusted(Uri? uri) async {
    // History, not a reload of the last trusted URL: the first one carries a one-time sign-in code
    // that is already spent.
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
    unawaited(_controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final problem = _problem;
    return Scaffold(
      backgroundColor: invexaSurface,
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
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
        ],
      ),
      body: Stack(children: [
        if (_ready && problem == null) Webview(_controller, permissionRequested: _onPermission),
        if (_loading && problem == null) const LinearProgressIndicator(color: invexaEmerald),
        if (problem != null)
          Center(
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
          ),
      ]),
    );
  }

  /// Only the camera (for barcode scanning in the web app) may be granted, and only to our pages.
  Future<WebviewPermissionDecision> _onPermission(String url, WebviewPermissionKind kind, bool isUserInitiated) async {
    final trusted = isTrustedWebUri(Uri.tryParse(url), widget.trustedHosts);
    return trusted && kind == WebviewPermissionKind.camera ? WebviewPermissionDecision.allow : WebviewPermissionDecision.deny;
  }
}
