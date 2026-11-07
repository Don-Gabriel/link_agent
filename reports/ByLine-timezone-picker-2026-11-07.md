# ByLine 1.0.5: searchable timezone selection

Date: 7 November 2026. Android version **1.0.5 (build 6)**.

## User experience

Initial setup and **Me → Timetable → Timezone** use the same searchable picker.
Users select a timezone rather than typing an identifier. The full offline list
contains 597 IANA zones and aliases, with city/region labels and current UTC
offsets. Search accepts city names, region names, IANA identifiers or UTC offsets.
The picker includes a **Use device timezone** shortcut. Selection is staged until
**Apply**; **Cancel** preserves the previous choice.

Fresh setups default to the device timezone. Resumed setups and existing settings
retain the saved choice. Detection has a three-second ceiling, requires no location
permission, and cannot overwrite a selection made while detection was pending.
If detection is unavailable, the existing fallback remains visible and the full
list is still usable. Saving initial voice settings waits for the bounded lookup
to finish, preventing an early save from persisting the initial UTC fallback.

The search keyboard is the only text input. On a small screen, opening the keyboard
hides supplementary header details to leave room for results and Apply/Cancel.
Search results and controls also accommodate larger text and desktop layouts.

## Implementation

- `mobile/lib/timezones.dart`: shared offline catalogue, friendly labels, current
  offset calculation, and bounded device timezone detection.
- `mobile/lib/widgets/timezone_picker.dart`: shared selector and searchable dialog.
- `mobile/lib/widgets/experience.dart`: exports the shared selector, replacing the
  old 17-item autocomplete and unrestricted text field.
- `mobile/lib/screens/onboarding_screen.dart`: local defaults with manual-choice
  protection, and the selector in initial scheduling.
- `mobile/lib/screens/timetable_screen.dart`: the same selector replaces the free
  text settings dialog; saves the IANA identifier through the existing API.
- `mobile/pubspec.yaml` / lockfile: directly depend on `timezone` 0.11.2 with IANA
  data 2026e. Only this dependency changed. Version increased to 1.0.5+6.

Current offsets are display information; scheduling continues to use the saved
IANA identifier, so the server retains its existing daylight-saving behavior.
The database's non-geographic `Factory` placeholder is excluded. All 597 offered
identifiers were checked against the project's Node/Intl timezone validation.

## Verification

- Flutter analyzer passed, and the complete **197-test Flutter suite** passed.
- Thirteen dedicated timezone tests cover the full catalogue, fractional/DST
  offsets, search, staged selection, Cancel, device lookup failure, disabled state,
  local defaults, preserved settings, late-detection races, initial setup saves,
  timetable API saves, keyboard layout, desktop layout and large text.
- After adding the guard against duplicate taps while device detection is pending,
  all 22 timezone/first-run/catalogue-and-voice regression checks passed.
- Rendered phone layouts at 390 px and 360 px with 160% text were visually reviewed.
- The signed release APK was built, and its package/version and existing signing
  certificate were verified with Android SDK tools. Metadata and SHA-256 are in
  `releases/android/release.json` and `SHA256SUMS`.

No backend deployment or schema change was needed. The PDF was not changed.
No APK was installed on the owner's phone during this work.

References: [timezone package](https://pub.dev/packages/timezone),
[timezone data changelog](https://pub.dev/packages/timezone/changelog),
[device timezone API](https://pub.dev/documentation/flutter_timezone/latest/flutter_timezone/FlutterTimezone-class.html).
