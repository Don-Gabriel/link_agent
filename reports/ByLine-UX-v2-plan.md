# ByLine UX v2 — planned before implementation

6 September 2026. The owner rejected the previous refresh because it retained the button-heavy structure. This revision changes navigation, forms, page composition and daily-post states, while retaining the working backend and zero-budget safeguards.

## Reference analysis

LinkedIn's [published design examples](https://design.linkedin.com/) include desktop feed and mobile profile/network screens. Its [design principles](https://design.linkedin.com/design-principles) emphasize useful, simple and trustworthy experiences. Its [desktop redesign explanation](https://www.linkedin.com/blog/member/product/linkedin-desktop-redesign-puts-conversations-and-content-at-the-center) describes top-level navigation and content as the main focus; it is historical evidence, not a claim that every current account has that exact layout. Current public app/store and image-search references reinforce the profile summary, central post card, author metadata, source preview and mobile bottom-navigation patterns.

Use the familiar LinkedIn blue (#0A66C2), warm neutral canvas (#F3F2EF), white cards, charcoal text, restrained gray borders and pill-shaped primary actions. Keep ByLine's name and own iconography. Do not add LinkedIn's logo or imply that ByLine is LinkedIn. Form controls use visible labels, clear focus outlines and accessible dark text. Contrast is measured against the actual backgrounds.

Applied installed Claude skills: UI Visual Design System, Mobile UX Design, Desktop App Design, Accessibility & Inclusive Design. This is a reference/heuristic review with the owner's feedback, not a formal user study.

## New structure

- **Home:** author/profile summary, a compact 'Start a post' entry, today's suggestion or an explicit daily outcome, and next-delivery information. Desktop uses a top navigation bar with profile/context columns around a narrow feed. Mobile puts the feed first with a compact account header and bottom navigation.
- **My posts:** retained draft management and published/source history, with dropdown navigation/filtering instead of segmented button rows. Existing editing, attachments, rewrite, schedule, hold and publish controls remain available.
- **Me:** profile/connection card followed by grouped preference rows. Writing preferences, interests and delivery are ordinary editable forms; technical diagnostics stay separate.
- **Voice:** free-text instructions and examples, a preset dropdown, and labelled dropdowns for structure, emoji, opening, closing and audience. Advanced length, signature and banned-phrase controls remain.
- **Topics:** searchable multi-select picker with a checked list and Apply/Cancel; selected topics appear as a summary, not a wall of buttons. Custom topics remain editable. Source categories retain the at-least-one rule.
- **Delivery and timetable:** exact time entry, searchable timezone selection with custom IANA input, and a weekday picker rather than seven small selector buttons. Preserve individual minutes, lead times, caps and automatic publishing safeguards.
- **First launch and setup:** a focused sign-in card, labelled progress/navigation, white form surfaces, industry/voice dropdowns, topic picker, readable sample card and specific completion message. Existing OAuth and sample acceptance rules remain.

## Daily preparation state contract

Currently `/api/review-delivery` returns `alreadyPrepared` and a sequence, which the client drops. Published or discarded posts disappear from the draft queue. Fix this by returning a complete, account-scoped daily-post summary and exposing today's state on reload. Distinguish not prepared, preparing/retrying, draft, approved/scheduled, published, skipped, failed and uncertain publishing. Existing posts never trigger another AI generation or another publish.

The button must show progress and a visible result. A repeated prepare opens the existing post. Published and skipped posts get a clear explanation, a read-only view of that exact post and next-delivery information; failures get a useful recovery route. Do not reset the daily cap or silently create duplicates.

## Verification and delivery

Use fixture data for AI and publishing tests. Add repeat-prepare tests for draft/published/skipped states and tenant isolation, dropdown/multi-select keyboard and selection tests, phone/desktop rendering and enlarged text. Retain existing behavior tests, adapting only the intended new control interactions. Inspect actual widget previews, then build Android and Windows, install on the connected phone in place and replace the Downloads Windows archive with a verified updated copy. Do not publish a LinkedIn post during testing.
