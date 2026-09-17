import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const invexaEmerald = Color(0xFF059669);
const invexaSurface = Color(0xFFF8FAFC);
const invexaInk = Color(0xFF0F172A);
const invexaMuted = Color(0xFF64748B);
const invexaBorder = Color(0xFFE2E8F0);
const invexaCard = Color(0xFFFFFFFF);
const invexaAmber = Color(0xFFD97706);
const invexaRose = Color(0xFFDC2626);

class InvexaTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: invexaEmerald,
      brightness: Brightness.light,
    ).copyWith(
      primary: invexaEmerald,
      onPrimary: Colors.white,
      surface: invexaSurface,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: invexaSurface,
      appBarTheme: const AppBarTheme(
        backgroundColor: invexaSurface,
        foregroundColor: invexaInk,
        elevation: 0,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.dark,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: invexaBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: invexaEmerald, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: invexaEmerald,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      cardTheme: CardThemeData(
        color: invexaCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: invexaBorder),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: invexaEmerald.withValues(alpha: 0.12),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 12,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? invexaEmerald : invexaMuted,
          );
        }),
      ),
    );
  }
}
