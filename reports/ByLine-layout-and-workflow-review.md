# ByLine layout and workflow review — 6 September 2026

## Plan before implementation

1. Give the native app a continuous white workspace with aligned section boundaries. Use one desktop sidebar beside the main workspace; remove the unrelated third-column routine card. Group mobile preferences and daily actions with dividers, tighter spacing, and consistent margins. Keep dropdowns, custom input, accessible contrast, and all existing actions.
2. Put the actionable draft count on My posts on Android and Windows. Keep Home free of that count. Check notification destinations and navigation state as well as the icon.
3. Return desktop browser authentication to the running app using a short-lived loopback listener and a random return path. Keep provider redirect registration unchanged, keep credentials in the verifier-protected API exchange, and handle cancellation/expired callbacks without sending native users to the legacy website. Apply this to initial sign-in and reconnection.
4. Inspect the project by workflow: authentication, onboarding, interests/sources, voice, sample acceptance, daily preparation, scheduling, editing/media, approval/skip/publishing recovery, history, notifications, settings, sessions, persistence, operator setup and budget controls. Exercise safe workflows against the isolated fixture server and inspect real service state read-only. Do not publish to LinkedIn or invoke paid-capable AI during verification.
5. Build Android and Windows, inspect actual rendered interfaces and interaction where available, reinstall Android preserving data, and replace the Windows ZIP in Downloads. Record observed results separately from automated coverage and external checks still requiring the account owner.

## Technical references

- [RFC 8252, loopback interface redirects](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3): temporary listeners on the loopback interface. ByLine uses this only for the browser-to-app return signal; the registered provider callback stays on the backend.
- [Windows foreground activation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow): Windows can deny focus changes. Restore the app and request foreground activation, with taskbar attention as a fallback.

## Findings and verification

Implementation and verification results will be recorded here as the review proceeds.
