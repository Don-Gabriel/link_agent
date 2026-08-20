/// Design tokens.
///
/// THE TWO CLOCKS. Every object in this app has two moments — when it gets
/// written, and when it gets sent — and since the scheduling rebuild that split
/// is the product's whole architecture. So colour encodes exactly one thing:
/// which clock you are looking at.
///
///   [C.draft]  warm. Still yours. Drafts, countdowns, the fold marker, the
///              review window, anything you can still change your mind about.
///   [C.live]   cold. On the record. Published, cleared, irreversible.
///   [C.alarm]  the only other accent. Missed, failed, needs a human.
///
/// Two accents with ROLES rather than one brand colour — a judgment carried
/// over from two previous projects where exactly that produced the good result.
/// The blue and purple this file used to carry are gone: they were decoration,
/// because they meant nothing in particular.
///
/// The surface ramp is unchanged. It was never the problem — the problem was
/// that every screen spent it identically.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class C {
  // Surface ramp, coolest to warmest. Unchanged.
  static const bg = Color(0xFF0B0D10);
  static const surface = Color(0xFF12151A);
  static const surface2 = Color(0xFF171B22);
  static const surface3 = Color(0xFF1E232C);
  static const border = Color(0xFF242A34);
  static const borderStrong = Color(0xFF333B49);

  // Ink.
  static const text = Color(0xFFE7EAEF);
  static const textDim = Color(0xFF9BA4B2);
  static const textFaint = Color(0xFF6A7383);

  /// The WRITE clock. Warm, unresolved, still yours to change.
  static const draft = Color(0xFFE0A552);
  static const draftDim = Color(0xFF3A2C16);

  /// The SEND clock. Cold, settled, on the record.
  static const live = Color(0xFF4FC7C0);
  static const liveDim = Color(0xFF12312F);

  /// Missed, failed, expired. The only thing that is neither clock.
  static const alarm = Color(0xFFE8695F);
  static const alarmDim = Color(0xFF311A18);

  /// Kept as a distinct positive for things that are neither a draft nor a
  /// send — a healthy connection, a passing check.
  static const good = Color(0xFF4EC98D);

  /// Something needs you, but nothing is broken: an expiring token, a dry run,
  /// a draft written under settings you have since changed.
  ///
  /// Deliberately the SAME amber as [draft], and not a fourth colour. A draft
  /// awaiting review and a token about to expire are asking for exactly the
  /// same thing — your attention — so they should look the same. The separate
  /// name exists because "draft" would read as a lie on a connection warning.
  static const attention = draft;

  // The legacy `accent`, `accentDim`, `warn` and `bad` aliases are gone. Every
  // call site has been read and given a role; keeping them would have let the
  // next one skip that step.
}

/// Spacing rhythm, on an 8-point scale with a 4 for tight pairs.
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

/// The two families. One superfamily, so they share metrics and proportion.
abstract final class F {
  /// Times, counts, scores, labels, section heads. A timetable set like one.
  static const mono = 'PlexMono';

  /// Everything read as prose — above all the post itself.
  static const sans = 'PlexSans';
}

/// Weight on a VARIABLE font.
///
/// Flutter does not map [TextStyle.fontWeight] onto a variable font's `wght`
/// axis: setting it on Plex Sans yields the default instance plus synthetic
/// emboldening, which looks smeared. Weight therefore comes from an explicit
/// axis value, written inline as a const list so every style below stays const
/// — screens embed these in `const` widget trees and would stop compiling
/// otherwise.

/// Type scale.
///
/// Body is 16 rather than the web's 15: the web value is read at arm's length
/// on a monitor, and 16 is the floor for comfortable reading on a phone.
abstract final class T {
  // ---- prose, in the sans
  static const xs = TextStyle(
    fontFamily: F.sans, fontSize: 12, height: 1.45, color: C.textFaint,
    fontVariations: [FontVariation('wght', 400)],
  );
  static const sm = TextStyle(
    fontFamily: F.sans, fontSize: 13, height: 1.5, color: C.textDim,
    fontVariations: [FontVariation('wght', 400)],
  );

  /// Post text. The most readable thing on screen, because reading the draft
  /// carefully IS the job this app exists to support.
  static const body = TextStyle(
    fontFamily: F.sans, fontSize: 16, height: 1.62, color: C.text,
    fontVariations: [FontVariation('wght', 400)],
  );
  static const bodyStrong = TextStyle(
    fontFamily: F.sans, fontSize: 15, height: 1.5, color: C.text,
    fontVariations: [FontVariation('wght', 500)],
  );

  // ---- structure, in the mono
  static const lg = TextStyle(
    fontFamily: F.mono, fontSize: 18, height: 1.3, color: C.text,
    fontWeight: FontWeight.w600, letterSpacing: -0.2,
  );
  static const xl = TextStyle(
    fontFamily: F.mono, fontSize: 24, height: 1.15, color: C.text,
    fontWeight: FontWeight.w700, letterSpacing: -0.5,
  );

  /// Panel headings: small, uppercase, tracked out.
  static const panelHead = TextStyle(
    fontFamily: F.mono, fontSize: 11, color: C.textFaint,
    fontWeight: FontWeight.w600, letterSpacing: 1.3,
  );

  /// Field labels above an input.
  static const fieldLabel = TextStyle(
    fontFamily: F.mono, fontSize: 11, color: C.textFaint,
    fontWeight: FontWeight.w400, letterSpacing: 0.9,
  );

  /// Any figure that sits in a column or changes in place.
  ///
  /// Tabular figures are load-bearing rather than decorative: without them a
  /// per-second countdown reflows as digits change width, and a number that
  /// jitters while you read it reads as broken.
  static const data = TextStyle(
    fontFamily: F.mono, fontSize: 14, color: C.textDim,
    fontWeight: FontWeight.w600,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// The hero clock — the countdown on the next post.
  static const clock = TextStyle(
    fontFamily: F.mono, fontSize: 30, height: 1, color: C.draft,
    fontWeight: FontWeight.w700, letterSpacing: -1,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  static const mono = TextStyle(
    fontFamily: F.mono, fontSize: 13, height: 1.5, color: C.textDim,
  );
}

/// Minimum touch target. Below this a control is a coin toss on a phone.
const double kMinTouch = 48.0;

/// One duration for every state change. Long enough to read as a transition,
/// short enough never to be in the way.
const Duration kStateChange = Duration(milliseconds: 220);

ThemeData buildTheme() {
  final base = ThemeData.dark(useMaterial3: true);

  return base.copyWith(
    scaffoldBackgroundColor: C.bg,
    colorScheme: const ColorScheme.dark(
      brightness: Brightness.dark,
      // Primary is the WRITE clock: almost every primary action in this app is
      // something you do to a draft.
      primary: C.draft,
      onPrimary: Color(0xFF1A1206),
      secondary: C.live,
      onSecondary: Color(0xFF04201F),
      surface: C.surface,
      onSurface: C.text,
      error: C.alarm,
      onError: C.bg,
      outline: C.borderStrong,
      surfaceContainerHighest: C.surface3,
    ),
    textTheme: base.textTheme
        .apply(fontFamily: F.sans, bodyColor: C.text, displayColor: C.text),
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
      contentTextStyle: TextStyle(fontFamily: F.sans, color: C.text, fontSize: 14),
      behavior: SnackBarBehavior.floating,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: C.bg,
      contentPadding: const EdgeInsets.symmetric(horizontal: S.x3, vertical: S.x3),
      hintStyle: const TextStyle(fontFamily: F.sans, color: C.textFaint, fontSize: 15),
      border: _inputBorder(C.borderStrong),
      enabledBorder: _inputBorder(C.borderStrong),
      focusedBorder: _inputBorder(C.draft, width: 2),
      errorBorder: _inputBorder(C.alarm),
      focusedErrorBorder: _inputBorder(C.alarm, width: 2),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.draft,
        foregroundColor: const Color(0xFF1A1206),
        disabledBackgroundColor: C.surface3,
        disabledForegroundColor: C.textFaint,
        minimumSize: const Size(0, kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        textStyle: TextStyle(fontFamily: F.sans, fontSize: 15, fontVariations: const [FontVariation('wght', 600)]),
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
        textStyle: TextStyle(fontFamily: F.sans, fontSize: 15, fontVariations: const [FontVariation('wght', 500)]),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: C.draft,
        minimumSize: const Size(0, kMinTouch),
        textStyle: TextStyle(fontFamily: F.sans, fontSize: 15, fontVariations: const [FontVariation('wght', 500)]),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.draft : C.textFaint,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.draftDim : C.surface3,
      ),
      trackOutlineColor: WidgetStateProperty.all(C.borderStrong),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: C.surface,
      indicatorColor: C.draftDim,
      surfaceTintColor: Colors.transparent,
      height: 64,
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(
          fontFamily: F.mono, fontSize: 10, color: C.textDim,
          fontWeight: FontWeight.w600, letterSpacing: 0.6,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? C.draft : C.textFaint),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: C.draft),
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
