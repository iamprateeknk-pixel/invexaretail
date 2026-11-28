import 'package:flutter/foundation.dart';

/// What the device this build runs on can actually do. One place decides it, so
/// a screen never calls a plugin the platform has no implementation for (the
/// camera scanner exists on Android and iOS only - on Windows a USB/Bluetooth
/// scanner types into a field - and the embedded web view is webview_flutter on
/// phones and WebView2 on Windows).
class PlatformCaps {
  const PlatformCaps._();

  static bool get _isPhoneOs =>
      !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  /// A camera barcode scanner (mobile_scanner) is available.
  static bool get hasCameraScanner => _isPhoneOs;

  /// The full workspace can be embedded in-app (webview_flutter).
  static bool get hasEmbeddedWebView => _isPhoneOs;

  /// The workspace and Control Panel can be embedded through Microsoft Edge WebView2
  /// (webview_windows). Windows only.
  static bool get hasDesktopWebView => !kIsWeb && defaultTargetPlatform == TargetPlatform.windows;

  /// A desktop build: hardware keyboard and keyboard-wedge barcode scanners are the norm.
  static bool get isDesktop =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.windows ||
          defaultTargetPlatform == TargetPlatform.macOS ||
          defaultTargetPlatform == TargetPlatform.linux);
}

/// Width from which the app uses a side navigation rail instead of the bottom
/// bar (tablets in landscape, iPad, Windows windows).
const wideLayoutBreakpoint = 840.0;
