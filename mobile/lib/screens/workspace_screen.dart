import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../config/env.dart';
import '../config/theme.dart';

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({super.key});

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  static final Uri _workspaceUri = Uri.parse(workspaceOrigin);
  late final WebViewController _controller;
  int _progress = 0;
  bool _mainFrameFailed = false;

  bool _isTrusted(Uri? uri) {
    if (uri == null || uri.scheme != 'https') return false;
    return uri.host == 'invexaretail.com' ||
        uri.host == 'www.invexaretail.com' ||
        uri.host == 'api.invexaretail.com';
  }

  @override
  void initState() {
    super.initState();
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
      platform.setOnPlatformPermissionRequest((request) {
        request.grant();
      });
    }
    _controller.loadRequest(_workspaceUri);
  }

  Future<void> _reloadWorkspace() async {
    setState(() {
      _mainFrameFailed = false;
      _progress = 0;
    });
    await _controller.loadRequest(_workspaceUri);
  }

  Future<bool> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) => PopScope(
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
