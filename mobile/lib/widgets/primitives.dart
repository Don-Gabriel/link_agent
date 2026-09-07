/// The shared vocabulary. Every screen is built from these; no screen reaches
/// for a raw Color, EdgeInsets or TextStyle.
///
/// THE LAYOUT RULE, which is the whole difference from what came before:
///
///   > Copy sits on the page. A box means an object you act on.
///
/// The old system put every screen inside a stack of identical bordered
/// panels, so nothing had hierarchy and the post — the one thing on screen
/// worth reading — was a third of the box it sat in. Sections here are
/// separated by rhythm and a [SectionRule]; [ObjectCard] is reserved for the
/// three things that are genuinely objects: a draft awaiting a decision, a
/// posting slot, and a sheet.
///
/// And an ObjectCard is a FILL, not an outline. Separation comes from the
/// raised ground and the space around it; a border on top of that is the same
/// statement made twice, and a page of outlined rectangles is what reads as
/// cramped no matter how much padding is inside them.
library;

import 'package:flutter/material.dart';

import '../theme.dart';
import 'form_select.dart';
import 'editorial.dart';

/// What a piece of state MEANS. Never "what colour is it".
enum Tone {
  /// On the desk. Still yours to change.
  desk,

  /// Out in the world. Published, cleared, connected, settled.
  out,

  /// Broken. Missed, failed, expired.
  broken,

  /// Deliberate silence, or plain information. Gets no colour on purpose.
  quiet,
}

extension ToneColour on Tone {
  Color get ink => switch (this) {
    Tone.desk => C.filament,
    Tone.out => C.daylight,
    Tone.broken => C.flare,
    Tone.quiet => C.paperFaint,
  };

  Color get wash => switch (this) {
    Tone.desk => C.filamentWash,
    Tone.out => C.daylightWash,
    Tone.broken => C.flareWash,
    Tone.quiet => C.ink3,
  };
}

// ---------------------------------------------------------------- structure

/// A section heading: condensed uppercase slug on a hairline that runs to the
/// edge. This is what replaced the panel title — it separates without boxing.
class SectionRule extends StatelessWidget {
  const SectionRule(
    this.label, {
    super.key,
    this.trailing,
    this.tone = Tone.quiet,
  });

  final String label;

  /// A count, a control, a status word.
  final Widget? trailing;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: S.x3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Flexible(
            child: Text(
              label,
              style: T.sectionRule.copyWith(
                color: tone == Tone.quiet ? C.paperDim : tone.ink,
              ),
            ),
          ),
          const SizedBox(width: S.x3),
          const Expanded(
            child: Divider(color: C.rule, height: 1, thickness: 1),
          ),
          if (trailing != null) ...[const SizedBox(width: S.x3), trailing!],
        ],
      ),
    );
  }
}

/// A raised surface. Reserved for something you act on — a draft, a slot.
class ObjectCard extends StatelessWidget {
  const ObjectCard({
    super.key,
    required this.child,
    this.tone,
    this.padding = const EdgeInsets.all(S.x4),
    this.emphasis = false,
  });

  final Widget child;

  /// Tints the edge. Null leaves it neutral, which is the common case — a card
  /// that shouts about its own state before you have read it is noise.
  final Tone? tone;

  /// A brighter edge and a wash behind it, for the one object on a screen that
  /// has a deadline.
  final bool emphasis;

  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    // A light boundary keeps actionable objects distinct on a white workspace.
    // Sections and navigation remain flat; only drafts and slots use this edge.
    final edge = Border.all(
      color: tone == null
          ? C.rule
          : tone!.ink.withValues(alpha: emphasis ? 0.55 : 0.28),
    );

    return AnimatedContainer(
      duration: motionAllowed(context) ? kStateChange : Duration.zero,
      curve: Curves.easeOut,
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: emphasis ? C.ink3 : C.ink2,
        border: edge,
        borderRadius: BorderRadius.circular(R.md),
      ),
      child: child,
    );
  }
}

/// A labelled form row.
class Field extends StatelessWidget {
  const Field({super.key, required this.label, required this.child, this.hint});

  final String label;
  final String? hint;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: S.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: T.slug),
          if (hint != null) ...[
            const SizedBox(height: S.x1),
            Text(hint!, style: T.micro),
          ],
          const SizedBox(height: S.x2),
          child,
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ markers

/// A short state word. Carries an icon whenever the state matters, because
/// colour is never allowed to be the only signal.
class Slug extends StatelessWidget {
  const Slug(this.label, {super.key, this.tone = Tone.quiet, this.icon});

  final String label;
  final Tone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colour = tone.ink;
    return Container(
      padding: EdgeInsets.fromLTRB(icon == null ? S.x2 : 6, 3, S.x2, 4),
      decoration: BoxDecoration(
        color: tone == Tone.quiet ? C.ink3 : tone.wash,
        // Coloured markers keep a faint edge because the wash behind them is
        // subtle; a neutral one is carried by its fill alone. Outlining every
        // small thing on screen is a large part of what reads as busy.
        border: tone == Tone.quiet
            ? null
            : Border.all(color: colour.withValues(alpha: 0.28)),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: colour),
            const SizedBox(width: S.x1),
          ],
          Text(label.toUpperCase(), style: T.slug.copyWith(color: colour)),
        ],
      ),
    );
  }
}

/// A thin proportion bar. Used for scores and budgets.
class Meter extends StatelessWidget {
  const Meter({super.key, required this.value, this.tone = Tone.out});

  /// 0..1.
  final double value;
  final Tone tone;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(999),
    child: LinearProgressIndicator(
      value: value.clamp(0.0, 1.0),
      minHeight: 3,
      backgroundColor: C.ink3,
      valueColor: AlwaysStoppedAnimation(tone.ink),
    ),
  );
}

/// Something the user should know before reading the rest of the screen: a dry
/// run, an expiring token, a stopped scheduler.
///
/// Not a card. It is a condition of the page, so it spans the page and carries
/// the tone on a left bar rather than a full border.
class Notice extends StatelessWidget {
  const Notice({
    super.key,
    required this.tone,
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  final Tone tone;
  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colour = tone.ink;
    return Container(
      padding: const EdgeInsets.fromLTRB(S.x3, S.x3, S.x3, S.x3),
      decoration: BoxDecoration(
        color: tone.wash,
        border: Border(left: BorderSide(color: colour, width: 2)),
        borderRadius: const BorderRadius.horizontal(
          right: Radius.circular(R.sm),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 17, color: colour),
          const SizedBox(width: S.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: T.bodyStrong.copyWith(color: colour, fontSize: 14),
                ),
                const SizedBox(height: 2),
                Text(body, style: T.micro.copyWith(color: C.paperDim)),
                if (actionLabel != null) ...[
                  const SizedBox(height: S.x2),
                  SizedBox(
                    height: 36,
                    child: OutlinedButton(
                      onPressed: onAction,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 36),
                        padding: const EdgeInsets.symmetric(horizontal: S.x3),
                        foregroundColor: colour,
                        side: BorderSide(color: colour.withValues(alpha: 0.5)),
                      ),
                      child: Text(actionLabel!),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A condition, on ONE line, that leads somewhere it can be fixed.
///
/// The multi-line [Notice] is right where the explanation is the point — on the
/// settings page that owns the problem. It is wrong at the top of the Desk,
/// where two of them stacked pushed the deadline off the screen. Anything
/// standing between the reader and the thing with a countdown has to earn its
/// height, and three lines of prose about a token does not.
class ConditionStrip extends StatelessWidget {
  const ConditionStrip({
    super.key,
    required this.tone,
    required this.icon,
    required this.text,
    this.onTap,
  });

  final Tone tone;
  final IconData icon;
  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colour = tone.ink;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        constraints: const BoxConstraints(minHeight: 40),
        padding: const EdgeInsets.symmetric(horizontal: S.x3, vertical: S.x2),
        decoration: BoxDecoration(
          color: tone.wash,
          border: Border(left: BorderSide(color: colour, width: 2)),
          borderRadius: const BorderRadius.horizontal(
            right: Radius.circular(R.sm),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 15, color: colour),
            const SizedBox(width: S.x2),
            Expanded(
              child: Text(
                text,
                style: T.small.copyWith(color: colour, height: 1.3),
              ),
            ),
            if (onTap != null)
              Icon(
                Icons.chevron_right,
                size: 17,
                color: colour.withValues(alpha: 0.7),
              ),
          ],
        ),
      ),
    );
  }
}

/// Inline failure, next to the thing that failed. Says what happened; never
/// apologises, never vague.
class ErrorNote extends StatelessWidget {
  const ErrorNote(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: S.x2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.error_outline, size: 16, color: C.flare),
        const SizedBox(width: S.x2),
        Expanded(
          child: Text(message, style: T.small.copyWith(color: C.flare)),
        ),
      ],
    ),
  );
}

/// An empty screen is an invitation to act, not a shrug.
class Empty extends StatelessWidget {
  const Empty({
    super.key,
    required this.icon,
    required this.title,
    required this.blurb,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String blurb;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: S.x7, horizontal: S.x4),
    child: Column(
      children: [
        const StudioArt(scene: StudioScene.ideas, height: 112),
        Icon(icon, size: 22, color: C.filament),
        const SizedBox(height: S.x4),
        Text(
          title.toUpperCase(),
          style: T.sectionRule,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: S.x2),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Text(blurb, style: T.small, textAlign: TextAlign.center),
        ),
        if (actionLabel != null) ...[
          const SizedBox(height: S.x4),
          OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ],
    ),
  );
}

// ------------------------------------------------------------------ controls

/// Single-choice form dropdowns preserve the existing value contracts.
class Choice<V> extends StatelessWidget {
  const Choice({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.enabled = true,
  });
  final V value;
  final Map<V, String> options;
  final ValueChanged<V> onChanged;
  final bool enabled;
  @override
  Widget build(BuildContext context) => FormSelect<V>(
    value: value,
    options: options,
    onChanged: enabled ? onChanged : null,
  );
}

/// One selectable chip. 48 high because these are primary controls.
class PickChip extends StatelessWidget {
  const PickChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(R.sm),
        child: AnimatedContainer(
          duration: motionAllowed(context) ? kStateChange : Duration.zero,
          constraints: const BoxConstraints(minHeight: kMinTouch),
          padding: const EdgeInsets.symmetric(horizontal: S.x4),
          decoration: BoxDecoration(
            color: selected ? C.filamentWash : C.ink2,
            border: Border.all(color: selected ? C.filament : C.ruleStrong),
            borderRadius: BorderRadius.circular(R.sm),
          ),
          // Center with both factors at 1, NOT Container(alignment:) — a
          // Container given an alignment expands to whatever width the parent
          // offers, which turns a row of chips into a stack of full-width bars.
          child: Center(
            widthFactor: 1,
            heightFactor: 1,
            child: Text(
              label,
              style: T.body.copyWith(
                color: !enabled
                    ? C.paperFaint
                    : selected
                    ? C.paper
                    : C.paperDim,
                fontVariations: selected
                    ? const [FontVariation('wght', 600)]
                    : const [FontVariation('wght', 400)],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A title, an explanation, and a switch.
class SwitchRow extends StatefulWidget {
  const SwitchRow({
    super.key,
    required this.title,
    required this.blurb,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String blurb;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  State<SwitchRow> createState() => _SwitchRowState();
}

class _SwitchRowState extends State<SwitchRow> {
  /// What this switch shows while the server catches up.
  ///
  /// THE FIX for toggles that felt broken. Every one of these calls the API,
  /// and the API sets a global `loading` flag that disabled the switch — so the
  /// thumb did not move until a round trip to Vercel came back, which on a
  /// phone is hundreds of milliseconds of a control that visibly ignored you.
  ///
  /// The thumb moves NOW and the request follows. If the server disagrees or
  /// fails, [didUpdateWidget] drops the guess and the switch snaps back to the
  /// truth — which is the correct behaviour for an optimistic control, and is
  /// visible rather than silent because the failure also raises a snackbar.
  bool? _optimistic;

  @override
  void didUpdateWidget(SwitchRow old) {
    super.didUpdateWidget(old);
    // The moment real state agrees with the guess — or contradicts it — the
    // guess has done its job.
    if (_optimistic != null && widget.value != old.value) {
      setState(() => _optimistic = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final shown = _optimistic ?? widget.value;
    final onChanged = widget.onChanged;

    return Semantics(
      toggled: shown,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: S.x2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title, style: T.bodyStrong),
                  const SizedBox(height: 2),
                  Text(widget.blurb, style: T.micro),
                ],
              ),
            ),
            const SizedBox(width: S.x3),
            Switch(
              value: shown,
              // Deliberately still live while a request is in flight. Disabling
              // it was the bug; guarding against a second tap of the SAME value
              // is all that was actually needed.
              onChanged: onChanged == null
                  ? null
                  : (v) {
                      if (v == shown) return;
                      setState(() => _optimistic = v);
                      onChanged(v);
                    },
            ),
          ],
        ),
      ),
    );
  }
}

/// A label and a value, read-only.
class Readout extends StatelessWidget {
  const Readout(this.label, this.value, {super.key, this.tone = Tone.quiet});

  final String label;
  final String value;
  final Tone tone;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: S.x2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: T.small)),
        const SizedBox(width: S.x3),
        Text(
          value,
          style: T.data.copyWith(
            color: tone == Tone.quiet ? C.paper : tone.ink,
          ),
        ),
      ],
    ),
  );
}

/// A row that opens something. Full-width target, chevron to say so.
class NavRow extends StatelessWidget {
  const NavRow({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.icon,
    this.tone,
  });

  final String label;
  final String value;
  final IconData? icon;
  final Tone? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(vertical: S.x3),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 20, color: tone?.ink ?? C.paperFaint),
              const SizedBox(width: S.x3),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    label,
                    style: T.bodyStrong.copyWith(
                      color: onTap == null ? C.paperFaint : C.paper,
                    ),
                  ),
                  if (value.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      value,
                      style: T.micro.copyWith(color: tone?.ink ?? C.paperFaint),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: S.x2),
            const Icon(Icons.chevron_right, size: 20, color: C.paperFaint),
          ],
        ),
      ),
    );
  }
}

/// A row that folds something away. Used for the judge's reasoning, which is
/// the answer to a question asked occasionally — not five meters competing
/// with the copy on every draft.
class Disclosure extends StatefulWidget {
  const Disclosure({
    super.key,
    required this.label,
    required this.child,
    this.trailing,
  });

  final String label;
  final String? trailing;
  final Widget child;

  @override
  State<Disclosure> createState() => _DisclosureState();
}

class _DisclosureState extends State<Disclosure> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          button: true,
          expanded: _open,
          child: InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Container(
              constraints: const BoxConstraints(minHeight: kMinTouch),
              alignment: Alignment.centerLeft,
              child: Row(
                children: [
                  AnimatedRotation(
                    turns: _open ? 0.25 : 0,
                    duration: motionAllowed(context)
                        ? kStateChange
                        : Duration.zero,
                    child: const Icon(
                      Icons.chevron_right,
                      size: 18,
                      color: C.paperFaint,
                    ),
                  ),
                  const SizedBox(width: S.x2),
                  Expanded(child: Text(widget.label, style: T.slug)),
                  if (widget.trailing != null)
                    Text(widget.trailing!, style: T.data),
                ],
              ),
            ),
          ),
        ),
        if (_open)
          Padding(
            padding: const EdgeInsets.only(top: S.x2, bottom: S.x2),
            child: widget.child,
          ),
      ],
    );
  }
}

/// The write button, as a header action rather than a floating one.
///
/// Compact and outlined: writing your own post is a real thing you do, but it
/// is not the recurring job — deciding on what the agent wrote is — so it sits
/// beside the refresh control instead of claiming the corner of the screen.
class WriteButton extends StatelessWidget {
  const WriteButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Write a post',
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: S.x3),
        decoration: BoxDecoration(
          color: C.filamentWash,
          border: Border.all(color: C.filament.withValues(alpha: 0.55)),
          borderRadius: BorderRadius.circular(R.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.edit_outlined, size: 15, color: C.filament),
            const SizedBox(width: S.x2),
            Text('WRITE', style: T.slug.copyWith(color: C.filament)),
          ],
        ),
      ),
    ),
  );
}
