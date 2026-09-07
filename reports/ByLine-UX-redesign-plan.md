# ByLine: complete Android and Windows experience

Prepared before UI implementation, 6 September 2026. Scope: first launch, OAuth, onboarding, daily approval, editor, history, voice, interests, delivery, advanced timetable, connection and diagnostics. The working local backend remains the test environment. Budget: zero; no paid assets, generation, hosting or external design service required.

## Research and diagnosis

This is a heuristic review of the code and the owner's hands-on feedback, not a claim that interviews or a usability study have occurred. Professional users do not universally prefer one theme. Here the owner explicitly wants a lighter reading experience and more control, so light is the chosen default.

- [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): body text needs at least 4.5:1 contrast. Use deep blue text on white; pale blue is a surface color. Test actual token pairs rather than assuming all blues are accessible.
- [Flutter adaptive guidance](https://docs.flutter.dev/ui/adaptive-responsive/best-practices): adapt to available width, preserve state across layout changes, and constrain long content instead of stretching phone forms across a monitor.
- [Microsoft layout guidance](https://learn.microsoft.com/en-us/windows/apps/design/layout/): desktop windows need responsive navigation and a coherent hierarchy at varied sizes.
- [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): emphasize the few controls needed for the current task while retaining specialist controls in clearly named expandable sections.
- Applied installed Claude skills: UI Visual Design System, Mobile UX Design, Desktop App Design, Accessibility & Inclusive Design under the owner's `.claude/skills` directory. Their general guidance is adapted to Flutter; no Claude API calls or paid agents are involved.

Current issues: black/gold tokens are global; condensed all-cap labels make ordinary settings look technical; large desktop windows stretch controls; onboarding hides examples; voice opens with presets and many chips before reaching free-text rules; custom interests cannot be edited naturally after setup; delivery uses a coarse slider; advanced timetable language incorrectly implies no daily draft exists without slots; next-delivery text displays raw timestamps. Loading, success and error states need more consistent presentation.

## Design system

Soft blue-gray canvas (#F5F7FB), white content surfaces, dark slate body text (#17243B), slate secondary text (#506078), deep blue primary (#2457C5), pale blue selected surfaces (#EAF0FF). Green confirmations and red errors have icons/text as well as color. White text only on sufficiently dark filled buttons. Inputs use visible slate outlines and blue keyboard focus. Rounded 12–20px surfaces, limited borders, generous space between sections; avoid nesting everything in cards. Use bundled Plex Sans for reading and headings and tabular numbers only where useful. Touch targets at least 48 logical pixels; no clipped labels at larger text sizes. Motion is brief and respects system reduced-motion settings.

## Journey and screen specification

| Stage | Experience | Preserved contract |
|---|---|---|
| First launch | Clear ByLine identity, short promise, focused sign-in panel; connection error has Retry; browser handoff shows waiting/cancel | Existing provider flags, secure verifier, interrupted login recovery, legacy installation access |
| LinkedIn | Immediate connected-name confirmation; no developer setup for clients | OAuth, separate member account, encrypted credentials |
| Interests | Industry helps choose sources; suggested chips plus editable personal topics and clear limits | Source-backed discovery, 3–5 onboarding topics; custom interests feed writer persona |
| Voice | Describe how you write in plain language; pasted examples prominent; four presets optional | Existing corpus, style rules, preview, banned phrases, signature and granular style controls |
| Sample | Readable post surface, source link, regenerate/edit voice, explicit acceptance | Revision-bound acceptance; no publish during setup |
| Delivery | Exact time picker with keyboard entry, quick morning choices, timezone field with suggestions | Server time validation, timezone rescheduling, one daily approval default |
| Notifications | Plain explanation, allow/later, test control with delivery feedback | FCM foreground and background, Windows toast polling, notification tap routing |
| Ready | Specific first delivery and next action | Activation only after accepted sample |
| Daily use | One readable draft with clear source and Approve/Edit/Skip; helpful next-delivery empty state | Reviewed snapshot protection, one-tap publish, skip, manual generation and advanced draft access |
| Editor/history | Light reading/editing surfaces; keep attachments, rewrites, scheduling and archive actions | Existing endpoints and state mutations |
| Preferences | Voice and topics easy to find; everyday delivery distinguished from advanced publishing slots | Pause, auto-publish, caps, connection, diagnostics and all legacy controls retained |

Desktop: navigation rail at wider sizes, content limited to readable width, keyboard focus and resizable layouts. Phone: labelled bottom navigation, single-column forms and touch-sized controls. Controls change position only when the layout requires it; state survives width changes.

## Implementation order and safeguards

1. Save this plan; leave credentials, account data, published posts and schedule unchanged.
2. Replace global tokens and shared components; adapt navigation and content bounds.
3. Redesign welcome, onboarding, daily reading and delivery controls.
4. Surface voice rules and examples; add persistent custom interests without changing broad feed choices. Additive server validation only where necessary. Preserve advanced controls behind clear disclosure.
5. Test contrast, phone and desktop layouts, text scaling, custom-input persistence, existing onboarding and publishing request semantics. Run existing Flutter tests and relevant backend checks. Generate previews from real widgets; inspect phone screenshots.
6. Build/install Android in place (preserve session); build Windows release and provide the complete executable folder. Do not send LinkedIn posts during verification. Avoid paid AI calls; use fixtures for generation tests.

## Moving beyond localhost, after the redesign

The desktop and Android clients ultimately connect to one public HTTPS backend, which owns OAuth callback handling, Gemini credentials, PostgreSQL, scheduling and FCM. Customers install the app and sign in; no web dashboard or customer API keys are needed.

At zero budget, a controlled remote pilot can use an HTTPS tunnel to the existing computer while it stays awake. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) are for testing, use a generated hostname and are not a durable production endpoint. A stable endpoint and callback registration are required before reliable client distribution. This is not a promise of free always-on production hosting. The next hosting decision must verify current provider limits, commercial terms, background scheduling, database persistence, backups and billing-disabled guarantees before provisioning. No public deployment is part of this UI change.

## Acceptance and limits

No deleted capabilities; no new onboarding API-key fields; custom voice and interests are saved and used, not decorative controls; exact delivery time is supported; minimum text contrast checks pass; navigation works at phone and desktop widths; tests and both native builds pass. Human TalkBack/Narrator testing and a broader client usability study remain separate validation—automated tests cannot certify complete accessibility.

## Implementation and verification — 6 September 2026

Implemented the light palette and typography across native screens, responsive desktop navigation, readable content widths, welcoming sign-in and matching browser-return page, custom onboarding voice instructions, prominent writing examples, optional voice presets and expandable advanced controls, persisted personal interests, exact delivery-time input, clearer timetable language and a readable daily approval surface. Existing APIs and actions were preserved; custom interests use an additive authenticated endpoint that updates only the current account's interests while retaining its voice and source categories.

Validation completed:

- **148 Flutter tests passed**, including existing onboarding/sample-acceptance, approval-request, editing, scheduling and notification tests. New coverage includes contrast token pairs, eight screens at 390/900/1280 widths, small-phone layouts with 160% text, custom voice editing and exact-minute input.
- **47 local backend integration checks passed**: custom voice persistence and writer style, custom interests persistence, account isolation, invalid-input rejection, preservation of voice/source categories, exact-minute rescheduling, reviewed-snapshot approval and the existing daily loop. All generation/publishing in this suite uses the isolated fixture database. It confirmed zero Gemini calls and zero LinkedIn distributions.
- `flutter analyze`, TypeScript checking and the existing backend self-check suite passed.
- Android debug APK and Windows release build succeeded. The complete Windows release folder was packaged as `.byline-local/ByLine-Windows.zip`; the Android APK is `.byline-local/byline-live.apk`.
- Inspected widget-rendered previews using synthetic data, including daily desktop, phone topics and onboarding sample screens. These render the actual Flutter widgets and bundled fonts.

The phone was disconnected during final build verification, so installation and a fresh physical-device UI check remain pending. The Windows executable passed a process-launch smoke check; a complete interactive desktop sign-in/notification check remains pending. These limits do not replace the owner's earlier successful live phone publishing test, and that earlier test is not represented as validation of this new interface.

No public host, paid service or new billable AI call was introduced. The APK is a development build, not a signed store release. Google provider configuration, production credentials/hosting, account deletion/export, provider linking, release distribution and overnight real-device delivery remain release work described in `BYLINE-LIVE.md`.
