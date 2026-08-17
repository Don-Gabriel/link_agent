/// Design tokens, ported verbatim from the web dashboard's globals.css.
///
/// Same product, two clients — so the values live in one place per client and
/// are never inlined at a call site. If the accent changes on the web, it
/// changes here and nowhere else.
///
/// The register is a control room: dark, dense, quiet, with colour reserved for
/// state that matters. Nothing decorative competes with the post text, because
/// reading the draft carefully IS the job this app exists to support.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class C {
  // Surface ramp, coolest to warmest.
  static const bg = Color(0xFF0B0D10);
  static const surface = Color(0xFF12151A);
  static const surface2 = Color(0xFF171B22);
  static const surface3 = Color(0xFF1E232C);
  static const border = Color(0xFF262C37);
  static const borderStrong = Color(0xFF333B49);

  // Ink.
  static const text = Color(0xFFE6E9EE);
  static const textDim = Color(0xFF98A1B0);
  static const textFaint = Color(0xFF6B7484);

  // State. Used for meaning only, never decoration.
  static const accent = Color(0xFF6EA8FE);
  static const accentDim = Color(0xFF2A4A7F);
  static const good = Color(0xFF4EC98D);
  static const warn = Color(0xFFE0B341);
  static const bad = Color(0xFFE8695F);
  static const live = Color(0xFFB57BEE);
}

/// Spacing rhythm. The web scale is in rem against a 16px root; these are the
/// same steps in logical pixels.
abstract final class S {
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x5 = 24.0;
  static const x6 = 32.0;
  static const x7 = 48.0;
}

abstract final class R {
  static const sm = 6.0;
  static const md = 10.0;
  static const lg = 16.0;
}

/// Type scale.
///
/// Body text is 16 rather than the web's 15: the web value is read at arm's
/// length on a desktop monitor, and 16 is the floor for comfortable reading on
/// a phone. Everything else keeps its relative weight.
abstract final class T {
  static const xs = TextStyle(fontSize: 12, height: 1.45, color: C.textFaint);
  static const sm = TextStyle(fontSize: 13, height: 1.5, color: C.textDim);
  static const body = TextStyle(fontSize: 16, height: 1.62, color: C.text);
  static const lg = TextStyle(fontSize: 18, height: 1.4, color: C.text, fontWeight: FontWeight.w500);
  static const xl = TextStyle(fontSize: 24, height: 1.25, color: C.text, fontWeight: FontWeight.w600);

  /// Panel headings: small, uppercase, tracked out — the web's `.panel > h2`.
  static const panelHead = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.96, // 0.08em at 12px
    color: C.textFaint,
  );

  /// Field labels above an input — the web's `label.field > span`.
  static const fieldLabel = TextStyle(
    fontSize: 12,
    letterSpacing: 0.72, // 0.06em
    color: C.textFaint,
  );

  static const mono = TextStyle(fontSize: 13, height: 1.5, fontFamily: 'monospace', color: C.textDim);
}

/// Minimum touch target. Below this a control is a coin toss on a phone, so
/// every tappable thing in this app is sized against it rather than against
/// how big its glyph happens to be.
const double kMinTouch = 48.0;

ThemeData buildTheme() {
  final base = ThemeData.dark(useMaterial3: true);

  return base.copyWith(
    scaffoldBackgroundColor: C.bg,
    colorScheme: const ColorScheme.dark(
      brightness: Brightness.dark,
      primary: C.accent,
      onPrimary: C.bg,
      secondary: C.live,
      onSecondary: C.bg,
      surface: C.surface,
      onSurface: C.text,
      error: C.bad,
      onError: C.bg,
      outline: C.borderStrong,
      surfaceContainerHighest: C.surface3,
    ),
    textTheme: base.textTheme.apply(bodyColor: C.text, displayColor: C.text),
    dividerColor: C.border,
    appBarTheme: const AppBarTheme(
      backgroundColor: C.bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: T.lg,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: C.surface3,
      contentTextStyle: TextStyle(color: C.text, fontSize: 14),
      behavior: SnackBarBehavior.floating,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: C.bg,
      contentPadding: const EdgeInsets.symmetric(horizontal: S.x3, vertical: S.x3),
      hintStyle: const TextStyle(color: C.textFaint, fontSize: 15),
      border: _inputBorder(C.borderStrong),
      enabledBorder: _inputBorder(C.borderStrong),
      focusedBorder: _inputBorder(C.accent, width: 2),
      errorBorder: _inputBorder(C.bad),
      focusedErrorBorder: _inputBorder(C.bad, width: 2),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.accent,
        foregroundColor: C.bg,
        disabledBackgroundColor: C.surface3,
        disabledForegroundColor: C.textFaint,
        minimumSize: const Size(0, kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: C.text,
        disabledForegroundColor: C.textFaint,
        minimumSize: const Size(0, kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        side: const BorderSide(color: C.borderStrong),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: C.accent,
        minimumSize: const Size(0, kMinTouch),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.accent : C.textFaint,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.accentDim : C.surface3,
      ),
      trackOutlineColor: WidgetStateProperty.all(C.borderStrong),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: C.surface,
      indicatorColor: C.accentDim,
      surfaceTintColor: Colors.transparent,
      height: 64,
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: C.textDim),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? C.text : C.textFaint),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: C.accent),
  );
}

OutlineInputBorder _inputBorder(Color color, {double width = 1}) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(R.sm),
      borderSide: BorderSide(color: color, width: width),
    );

/// Dark status/navigation bars to match the app background — without this the
/// system bars stay light and the app looks like it is sitting in someone
/// else's frame.
const systemChrome = SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.light,
  statusBarBrightness: Brightness.dark,
  systemNavigationBarColor: C.surface,
  systemNavigationBarIconBrightness: Brightness.light,
);
