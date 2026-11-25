import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/env.dart';
import '../config/theme.dart';

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({super.key, this.fetchHandoffCode, this.externalWorkspaceLauncher, this.workspaceUri});

  /// Asks the API for a one-time code so the workspace opens already signed in. Null or failing
  /// (offline, older server) falls back to the plain workspace, which then shows its own sign-in.
  final Future<String> Function()? fetchHandoffCode;

  /// Allows desktop tests to verify the trusted external-browser handoff.
  final Future<bool> Function(Uri uri)? externalWorkspaceLauncher;
  final Uri? workspaceUri;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  late final Uri _workspaceUri = widget.workspaceUri ?? workspaceFromEnvironment();
  late final WebViewController _controller;
  int _progress = 0;
  bool _mainFrameFailed = false;
  bool _externalLaunchFailed = false;

  bool _isTrusted(Uri? uri) {
    return uri != null && uri.scheme == _workspaceUri.scheme &&
        uri.host == _workspaceUri.host && uri.port == _workspaceUri.port && uri.userInfo.isEmpty;
  }

  @override
  void initState() {
    super.initState();
    if (defaultTargetPlatform == TargetPlatform.windows) {
      _openWorkspaceExternally();
      return;
    }
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(invexaSurface)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          return _isTrusted(Uri.tryParse(request.url))
              ? NavigationDecision.navigate
              : NavigationDecision.prevent;
        },
        onPageStarted: (_) {
          if (mounted) setState(() { _progress = 0; _mainFrameFailed = false; });
        },
        onProgress: (progress) {
          if (mounted) setState(() => _progress = progress);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _progress = 100);
        },
        onWebResourceError: (error) {
          if ((error.isForMainFrame ?? false) && mounted) {
            setState(() => _mainFrameFailed = true);
          }
        },
      ));

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      // Navigation is already pinned to trusted hosts; on top of that only the
      // camera (barcode scanning) may be granted. Anything else - microphone,
      // protected media, or a mixed request - is denied, never auto-granted.
      platform.setOnPlatformPermissionRequest((request) {
        final cameraOnly = request.types.isNotEmpty &&
            request.types.every((type) => type == WebViewPermissionResourceType.camera);
        if (cameraOnly) {
          request.grant();
        } else {
          request.deny();
        }
      });
    }
    _openWorkspace();
  }

  Future<void> _openWorkspaceExternally() async {
    try {
      final uri = await _workspaceTarget();
      final launch = widget.externalWorkspaceLauncher ??
          (target) => launchUrl(target, mode: LaunchMode.externalApplication);
      final opened = await launch(uri);
      if (mounted) setState(() => _externalLaunchFailed = !opened);
    } catch (_) {
      if (mounted) setState(() => _externalLaunchFailed = true);
    }
  }

  /// The URL to load: the workspace root, plus `#/handoff?code=...` when a one-time code could be
  /// obtained. A fragment is never sent to a server or leaked in a referrer.
  Future<Uri> _workspaceTarget() async {
    final fetch = widget.fetchHandoffCode;
    if (fetch == null) return _workspaceUri;
    try {
      final code = await fetch();
      return _workspaceUri.replace(fragment: '/handoff?code=${Uri.encodeQueryComponent(code)}');
    } catch (_) {
      return _workspaceUri;
    }
  }

  Future<void> _openWorkspace() async {
    await _controller.loadRequest(await _workspaceTarget());
  }

  Future<void> _reloadWorkspace() async {
    setState(() {
      _mainFrameFailed = false;
      _progress = 0;
    });
    await _openWorkspace(); // a reload needs a fresh code: the previous one was single-use
  }

  Future<bool> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  Widget _buildWindowsWorkspace(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Full workspace')),
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_externalLaunchFailed ? Icons.open_in_browser : Icons.language, size: 48),
                  const SizedBox(height: 16),
                  Text(
                    _externalLaunchFailed
                        ? 'We could not open the workspace.'
                        : 'The workspace is open in your browser.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Continue in your default browser, then return here for store operations.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: _openWorkspaceExternally,
                    icon: const Icon(Icons.open_in_browser),
                    label: const Text('Open in browser'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (defaultTargetPlatform == TargetPlatform.windows) {
      return _buildWindowsWorkspace(context);
    }
    return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop) return;
          if (await _handleBack()) {
            if (context.mounted) Navigator.of(context).pop();
          }
        },
        child: AnnotatedRegion<SystemUiOverlayStyle>(
          value: const SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: Brightness.dark,
          ),
          child: Scaffold(
            backgroundColor: invexaSurface,
            appBar: AppBar(
              title: const Text('Full workspace'),
              actions: [
                IconButton(
                  tooltip: 'Reload workspace',
                  onPressed: _reloadWorkspace,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            body: SafeArea(
              child: RefreshIndicator(
                color: invexaEmerald,
                onRefresh: _reloadWorkspace,
                child: Stack(children: [
                  WebViewWidget(controller: _controller),
                  if (_progress < 100 && !_mainFrameFailed)
                    LinearProgressIndicator(
                      value: _progress / 100,
                      color: invexaEmerald,
                      backgroundColor: const Color(0x14059669),
                    ),
                  if (_mainFrameFailed)
                    ColoredBox(
                      color: invexaSurface,
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: [
                          SizedBox(height: MediaQuery.of(context).size.height * 0.18),
                          const Icon(Icons.cloud_off_outlined, size: 48, color: invexaMuted),
                          const SizedBox(height: 16),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              'The Invexa Retail workspace is offline.',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              'Check your internet connection, pull to refresh, or tap Retry.',
                              textAlign: TextAlign.center,
                            ),
                          ),
                          const SizedBox(height: 20),
                          Center(
                            child: FilledButton.icon(
                              onPressed: _reloadWorkspace,
                              icon: const Icon(Icons.refresh),
                              label: const Text('Retry'),
                            ),
                          ),
                        ],
                      ),
                    ),
                ]),
              ),
            ),
          ),
        ),
      );
  }
}
