/// Design tokens — "Ink & Filament". See /DESIGN.md for the reasoning.
///
/// The register is a dark instrument used at 07:00 with one hand, in a product
/// whose whole subject is the moment between copy existing and copy going out.
///
/// COLOUR ANSWERS ONE QUESTION: which clock is this on?
///
///   [C.filament]  warm. On the desk, still yours — drafts, countdowns, the
///                 fold, review windows, anything you can still change.
///   [C.daylight]  cold. Out in the world — published, cleared, connected,
///                 healthy. Settled.
///   [C.flare]     broken. Missed, failed, expired. Needs a human.
///
/// A slot that judged its candidates and chose silence gets NO colour, only
/// [C.paperFaint]. Correct behaviour must never look like an alarm — that is
/// how you teach someone to distrust a quiet day.
///
/// The ground is warm ink rather than blue-black, because blue-black is what
/// every dark app reaches for and it turns accents into status LEDs.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class C {
  // ---- ground. Warm-neutral ink, coolest to warmest.
  /// The page. Copy sits directly on this — see the layout rule in DESIGN.md.
  static const ink = Color(0xFF0E0D0B);

  /// Raised. Sheets, sticky bars, and the objects you act on.
  static const ink2 = Color(0xFF161512);

  /// Wells. Inputs, pressed states, meter tracks.
  static const ink3 = Color(0xFF1E1C18);

  /// Hairline. Separation without a box.
  static const rule = Color(0xFF2A2721);

  /// A real edge — inputs, outlined buttons.
  static const ruleStrong = Color(0xFF3B372F);

  // ---- ink on the page. Every value clears 4.5:1 on [ink].
  /// Copy. 16.9:1.
  static const paper = Color(0xFFF2EFE9);

  /// Secondary prose. 8.7:1.
  static const paperDim = Color(0xFFB3ADA2);

  /// Captions, slugs, disabled. 5.3:1 — deliberately lighter than the value it
  /// replaces (#6A7383, 3.9:1), which failed AA at the sizes it was used at.
  static const paperFaint = Color(0xFF8A857B);

  // The three accents are DESATURATED on purpose.
  //
  // The first cut used #FF8A3D, #45C8DC and #FF4D5E — fully saturated, and on a
  // near-black ground they read as status LEDs rather than as ink. On a screen
  // you open at 07:00 to read one careful paragraph, that is the wrong
  // temperature: it makes an ordinary morning feel like an incident.
  //
  // These are the same three hues pulled back toward paper. Every one still
  // clears AA comfortably — the contrast barely moved, because contrast comes
  // from lightness and the saturation was never doing that work.

  /// ON THE DESK. Still yours to change. 9.4:1.
  static const filament = Color(0xFFE8A76B);

  /// OUT IN THE WORLD. Published, cleared, healthy, settled. 8.5:1.
  ///
  /// One colour, not two. The old system had `live` and `good` as separate
  /// accents and a reader could never tell them apart, because to a reader they
  /// said the same thing: settled, nothing to do.
  static const daylight = Color(0xFF7FB3C4);

  /// BROKEN. Missed, failed, expired, disconnected. 6.1:1.
  static const flare = Color(0xFFD9736E);

  // ---- washes. Precomputed solids rather than alpha, so a fill does not
  // shift when it lands on a different ground. Each is its accent at 12% over
  // [ink], resolved once here.
  static const filamentWash = Color(0xFF281F16);
  static const daylightWash = Color(0xFF1B2121);
  static const flareWash = Color(0xFF261917);

  /// Ink that reads on top of [filament] — for a filled primary button. 9.2:1.
  static const onFilament = Color(0xFF1A0E04);

  /// Something needs you, but nothing is broken: an expiring token, a dry run,
  /// a draft written under settings you have since changed.
  ///
  /// Deliberately the SAME warm as [filament] rather than a fourth colour. A
  /// draft awaiting review and a token about to expire ask for exactly the same
  /// thing — your attention. The separate name exists because "filament" would
  /// read as nonsense on a connection warning.
  static const attention = filament;
}

/// Spacing rhythm. Nothing between these values.
abstract final class S {
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x5 = 24.0;
  static const x6 = 32.0;
  static const x7 = 48.0;
}

/// Corner radius.
///
/// Raised from 4/8/14. The tighter set read as an instrument, which was the
/// intent, but combined with a visible border on every surface it also read as
/// tight — a screen of small hard-cornered boxes. Softer corners with fewer
/// borders is the same seriousness without the clench.
abstract final class R {
  /// Chips, inputs, small controls.
  static const sm = 7.0;

  /// Objects you act on — a draft, a slot.
  static const md = 12.0;

  /// Sheets.
  static const lg = 18.0;
}

/// Three faces, three jobs, no overlap.
abstract final class F {
  /// THE SLUG. Section rules, titles, chips, day initials. Uppercase, tracked.
  /// Condensed because a phone column is narrow and a newsroom deck always was.
  ///
  /// Static instances, not a variable axis: a `fontVariations` list in a
  /// TextStyle silently makes it non-const and takes every const widget tree
  /// down with it.
  static const cond = 'BarlowCondensed';

  /// THE COPY. The post, and anything else read as language.
  static const sans = 'PlexSans';

  /// THE CLOCK. Times, counts, scores, ids. Tabular figures, always.
  static const mono = 'PlexMono';
}

/// Weight on the variable Plex Sans.
///
/// Flutter does not map [TextStyle.fontWeight] onto a variable font's `wght`
/// axis: setting it yields the default instance plus synthetic emboldening,
/// which looks smeared. Weight comes from an explicit axis value, written
/// inline as a const list so every style below stays const.
const _w400 = [FontVariation('wght', 400)];
const _w500 = [FontVariation('wght', 500)];
const _w600 = [FontVariation('wght', 600)];

/// Type scale. See the table in DESIGN.md.
abstract final class T {
  // ---- the copy, in the sans
  /// THE POST. The most readable thing on screen, because reading the draft
  /// carefully is the job this app exists to support.
  static const copy = TextStyle(
    fontFamily: F.sans, fontSize: 17, height: 1.62, color: C.paper,
    fontVariations: _w400,
  );
  static const body = TextStyle(
    fontFamily: F.sans, fontSize: 15, height: 1.5, color: C.paper,
    fontVariations: _w400,
  );
  static const bodyStrong = TextStyle(
    fontFamily: F.sans, fontSize: 15, height: 1.5, color: C.paper,
    fontVariations: _w500,
  );
  static const small = TextStyle(
    fontFamily: F.sans, fontSize: 13.5, height: 1.45, color: C.paperDim,
    fontVariations: _w400,
  );
  static const micro = TextStyle(
    fontFamily: F.sans, fontSize: 12, height: 1.4, color: C.paperFaint,
    fontVariations: _w400,
  );

  // ---- the furniture, in the condensed
  /// Eyebrows, chips, field labels. Uppercase at the call site.
  static const slug = TextStyle(
    fontFamily: F.cond, fontSize: 11.5, height: 1.2, color: C.paperFaint,
    fontWeight: FontWeight.w600, letterSpacing: 1.4,
  );

  /// Section headings, on a hairline. Uppercase at the call site.
  static const sectionRule = TextStyle(
    fontFamily: F.cond, fontSize: 13, height: 1.2, color: C.paperDim,
    fontWeight: FontWeight.w600, letterSpacing: 1.2,
  );

  /// Screen titles.
  static const title = TextStyle(
    fontFamily: F.cond, fontSize: 22, height: 1.15, color: C.paper,
    fontWeight: FontWeight.w700, letterSpacing: -0.2,
  );

  /// The masthead on the Desk.
  static const display = TextStyle(
    fontFamily: F.cond, fontSize: 34, height: 1.05, color: C.paper,
    fontWeight: FontWeight.w700, letterSpacing: -0.4,
  );

  // ---- the clock, in the mono
  /// Any figure that sits in a column or changes in place.
  ///
  /// Tabular figures are load-bearing rather than decorative: without them a
  /// countdown reflows as digits change width, and a number that jitters while
  /// you read it reads as broken.
  static const data = TextStyle(
    fontFamily: F.mono, fontSize: 14, height: 1.3, color: C.paperDim,
    fontWeight: FontWeight.w600,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// Ids, hostnames, machine strings.
  static const mono = TextStyle(
    fontFamily: F.mono, fontSize: 12.5, height: 1.45, color: C.paperFaint,
  );

  /// THE COUNTDOWN. At most one per screen.
  static const clock = TextStyle(
    fontFamily: F.mono, fontSize: 44, height: 1, color: C.filament,
    fontWeight: FontWeight.w700, letterSpacing: -1.5,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}

/// Minimum touch target. Below this a control is a coin toss on a phone.
const double kMinTouch = 48.0;

/// One duration for every state change. Long enough to read as a transition,
/// short enough never to be in the way.
const Duration kStateChange = Duration(milliseconds: 180);

/// Route transitions.
const Duration kRouteChange = Duration(milliseconds: 320);

/// Whether to build motion at all.
///
/// Reduced motion is honoured by NOT creating the timeline, not by shortening
/// it — a 1ms animation still schedules frames and still moves things a user
/// asked not to have moved.
bool motionAllowed(BuildContext context) {
  final media = MediaQuery.maybeOf(context);
  if (media == null) return true;
  return !media.disableAnimations;
}

ThemeData buildTheme() {
  final base = ThemeData.dark(useMaterial3: true);

  return base.copyWith(
    scaffoldBackgroundColor: C.ink,
    canvasColor: C.ink,
    colorScheme: const ColorScheme.dark(
      brightness: Brightness.dark,
      // Primary is the desk: almost every primary action in this app is
      // something you do to a draft that is still yours.
      primary: C.filament,
      onPrimary: C.onFilament,
      secondary: C.daylight,
      onSecondary: Color(0xFF03191D),
      surface: C.ink2,
      onSurface: C.paper,
      error: C.flare,
      onError: Color(0xFF20060A),
      outline: C.ruleStrong,
      surfaceContainerHighest: C.ink3,
    ),
    textTheme: base.textTheme
        .apply(fontFamily: F.sans, bodyColor: C.paper, displayColor: C.paper),
    dividerColor: C.rule,
    dividerTheme: const DividerThemeData(color: C.rule, thickness: 1, space: 1),
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: C.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: T.title,
      iconTheme: IconThemeData(color: C.paperDim, size: 22),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: C.ink3,
      contentTextStyle: TextStyle(
        fontFamily: F.sans, color: C.paper, fontSize: 14, height: 1.4,
        fontVariations: _w400,
      ),
      actionTextColor: C.filament,
      behavior: SnackBarBehavior.floating,
      insetPadding: EdgeInsets.all(S.x3),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: C.ink2,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(R.lg),
        side: const BorderSide(color: C.rule),
      ),
      titleTextStyle: T.title,
      contentTextStyle: T.small,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: C.ink2,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(R.lg)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: C.ink3,
      contentPadding: const EdgeInsets.symmetric(horizontal: S.x3, vertical: S.x3),
      hintStyle: const TextStyle(
        fontFamily: F.sans, color: C.paperFaint, fontSize: 15, fontVariations: _w400,
      ),
      border: _inputBorder(C.ruleStrong),
      enabledBorder: _inputBorder(C.ruleStrong),
      focusedBorder: _inputBorder(C.filament, width: 2),
      errorBorder: _inputBorder(C.flare),
      focusedErrorBorder: _inputBorder(C.flare, width: 2),
      errorStyle: const TextStyle(fontFamily: F.sans, color: C.flare, fontSize: 12.5),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.filament,
        foregroundColor: C.onFilament,
        disabledBackgroundColor: C.ink3,
        disabledForegroundColor: C.paperFaint,
        minimumSize: const Size(0, kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        textStyle: const TextStyle(
          fontFamily: F.sans, fontSize: 15, height: 1.2, fontVariations: _w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: C.paper,
        disabledForegroundColor: C.paperFaint,
        minimumSize: const Size(0, kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        side: const BorderSide(color: C.ruleStrong),
        textStyle: const TextStyle(
          fontFamily: F.sans, fontSize: 15, height: 1.2, fontVariations: _w500,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: C.filament,
        minimumSize: const Size(0, kMinTouch),
        textStyle: const TextStyle(
          fontFamily: F.sans, fontSize: 15, height: 1.2, fontVariations: _w500,
        ),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(kMinTouch, kMinTouch),
        foregroundColor: C.paperDim,
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.filament : C.paperFaint,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.filamentWash : C.ink3,
      ),
      trackOutlineColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? C.filament : C.ruleStrong,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: C.ink2,
      indicatorColor: C.filamentWash,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontFamily: F.cond,
          fontSize: 12,
          height: 1.1,
          letterSpacing: 1.0,
          fontWeight: FontWeight.w600,
          color: s.contains(WidgetState.selected) ? C.filament : C.paperFaint,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(
          size: 22,
          color: s.contains(WidgetState.selected) ? C.filament : C.paperFaint,
        ),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: C.paperFaint,
      textColor: C.paper,
      minVerticalPadding: S.x3,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: C.filament,
      linearTrackColor: C.ink3,
      circularTrackColor: Colors.transparent,
    ),
    timePickerTheme: TimePickerThemeData(
      backgroundColor: C.ink2,
      dialBackgroundColor: C.ink3,
      hourMinuteColor: C.ink3,
      hourMinuteTextColor: C.paper,
      dayPeriodColor: C.filamentWash,
      dayPeriodTextColor: C.paper,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.lg)),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: C.ink3,
        borderRadius: BorderRadius.circular(R.sm),
        border: Border.all(color: C.rule),
      ),
      textStyle: const TextStyle(fontFamily: F.sans, fontSize: 12.5, color: C.paper),
    ),
  );
}

OutlineInputBorder _inputBorder(Color color, {double width = 1}) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(R.sm),
      borderSide: BorderSide(color: color, width: width),
    );

/// Dark system bars matching the page — without this the app sits in someone
/// else's frame.
const systemChrome = SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.light,
  statusBarBrightness: Brightness.dark,
  systemNavigationBarColor: C.ink2,
  systemNavigationBarIconBrightness: Brightness.light,
);
