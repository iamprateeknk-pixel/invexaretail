import 'package:flutter/services.dart';

/// Blueprint v4 §37: every scan answers back so a picker or counter can work
/// without looking at the screen - a short tick for a good scan, a longer
/// buzz plus a system alert for a wrong one.
class ScanFeedback {
  const ScanFeedback._();

  static Future<void> accepted() => HapticFeedback.lightImpact();

  static Future<void> saved() => HapticFeedback.mediumImpact();

  static Future<void> rejected() async {
    await HapticFeedback.heavyImpact();
    await SystemSound.play(SystemSoundType.alert);
  }
}
