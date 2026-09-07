# ByLine illustrated workspace

Direction: a calm writing studio, retaining LinkedIn blue, warm white surfaces and dark readable type. Introduce original paper, pen, plant, calendar and conversation illustrations rather than stock photos or decorative statistics.

- Home: illustrated daily state, a useful writing prompt, and a warm profile cover. Existing approval, editing and delivery actions retain their behavior.
- My Posts and Archive: compact editorial headers; illustrations should support empty states without displacing the actual drafts.
- Voice, delivery, interests and composer: one compact contextual introduction per page, with consistent margins and section anchors.
- Welcome and onboarding: the same artwork family, adapted to each setup step.
- Responsive: wide headers have larger artwork; phone headers use compact artwork, and large accessibility text hides decorative art to preserve reading space.
- Assets: local Flutter vector drawing, no network images, no image-generation charges, no fake activity or metrics.
- Packaging: compile Android and Windows, install APK and replace Downloads ZIP. User handles visual and functional acceptance; do not launch apps or run tests.

Implemented: five original vector scenes (writing, voice, ideas, routine, completion), responsive editorial banners, a profile cover, an end-of-day writing prompt, illustrated empty states, matching welcome/onboarding artwork, and a light Windows title bar. All text remains separate from the artwork; decorative drawings are excluded from screen-reader output and hidden from banners at larger text scales.

Behavior: existing callbacks, post data, settings values, permissions, publishing, scheduling and backend routes are unchanged in this design pass. No network artwork or additional dependencies were introduced. The previous functional-audit limitations remain unchanged.

Validation: packaging compilation only. No apps were launched and no automated or hands-on tests were run; visual acceptance remains with the user.
