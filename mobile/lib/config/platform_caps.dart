import 'package:flutter/foundation.dart';

/// What the device this build runs on can actually do. One place decides it, so
/// a screen never calls a plugin the platform has no implementation for (the
/// camera scanner and the embedded web view exist on Android and iOS only; on
/// Windows a USB/Bluetooth scanner types into a field and the workspace opens
/// in the default browser instead).
class PlatformCaps {
  const PlatformCaps._();

  static bool get _isPhoneOs =>
      !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  /// A camera barcode scanner (mobile_scanner) is available.
  static bool get hasCameraScanner => _isPhoneOs;

  /// The full workspace can be embedded in-app (webview_flutter).
  static bool get hasEmbeddedWebView => _isPhoneOs;

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
