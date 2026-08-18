# Bundled typefaces

IBM Plex Mono and IBM Plex Sans, by IBM / Mike Abbink, Bold Monday.
Licensed under the SIL Open Font License 1.1 — see OFL.txt.

Bundled as assets rather than fetched at runtime. PATTERNS.md records a CDN
font silently returning "access restricted" on an earlier project and taking
the type treatment down with it; an app should never need the network to
render its own text.

  IBMPlexMono-Regular.ttf    400  times, counts, labels
  IBMPlexMono-SemiBold.ttf   600  section heads, slot times
  IBMPlexMono-Bold.ttf       700  countdowns, the hero clock
  IBMPlexSans.ttf            variable (wght 100-700, wdth 85-100)

Plex Sans is the VARIABLE cut, because google/fonts no longer publishes static
instances for it. Flutter does not map TextStyle.fontWeight onto a variable
axis, so weight is set with `fontVariations: [FontVariation('wght', n)]` —
theme.dart does this in one place and screens never repeat it.
