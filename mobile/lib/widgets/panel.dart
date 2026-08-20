/// The shared surface primitives, matching the web dashboard's `.panel`,
/// `.field`, `.chip`, `.badge` and `.toggle`.
///
/// These exist so screens stay declarative and no screen reaches for a raw
/// Color or EdgeInsets. Every visual decision is here or in theme.dart.
library;

import 'package:flutter/material.dart';

import '../theme.dart';

/// A titled card. [trailing] sits on the heading row for a single control.
class Panel extends StatelessWidget {
  const Panel({super.key, this.title, this.subtitle, this.trailing, required this.child});

  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: C.surface,
        border: Border.all(color: C.border),
        borderRadius: BorderRadius.circular(R.md),
      ),
      padding: const EdgeInsets.all(S.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null)
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(child: Text(title!.toUpperCase(), style: T.panelHead)),
                ?trailing,
              ],
            ),
          if (subtitle != null) ...[
            const SizedBox(height: S.x1),
            Text(subtitle!, style: T.xs),
          ],
          if (title != null) const SizedBox(height: S.x3),
          child,
        ],
      ),
    );
  }
}

/// A labelled form row. The label is the web's uppercase field caption.
class Field extends StatelessWidget {
  const Field({super.key, required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: S.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: T.fieldLabel),
          const SizedBox(height: S.x2),
          child,
        ],
      ),
    );
  }
}

/// Segmented single-choice control. Used instead of a dropdown because these
/// option sets are short and a phone user should see the alternatives without
/// opening a menu — the whole point of the voice screen is comparing them.
// Type parameter is V, not T: `T` is the typography scale in theme.dart and a
// generic named T would shadow it inside this class.
class ChoiceRow<V> extends StatelessWidget {
  const ChoiceRow({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final V value;
  final Map<V, String> options;
  final ValueChanged<V> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: S.x2,
      runSpacing: S.x2,
      children: options.entries.map((e) {
        final on = e.key == value;
        return _Chip(label: e.value, selected: on, onTap: () => onChanged(e.key));
      }).toList(),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          // 44 high rather than hugging the text: these are the primary
          // controls on the voice screen and get tapped constantly.
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: S.x4),
          decoration: BoxDecoration(
            color: selected ? C.draftDim : C.surface2,
            border: Border.all(color: selected ? C.draft : C.borderStrong),
            borderRadius: BorderRadius.circular(999),
          ),
          // Center with both factors set to 1, NOT Container(alignment:) — a
          // Container given an alignment expands to fill whatever width the
          // parent offers, which turns a row of chips into a stack of
          // full-width bars inside a Wrap.
          child: Center(
            widthFactor: 1,
            heightFactor: 1,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 14,
                color: selected ? C.text : C.textDim,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tappable chip used for actions rather than selection (presets).
class ActionChip2 extends StatelessWidget {
  const ActionChip2({super.key, required this.label, required this.onTap, this.tooltip});

  final String label;
  final String? tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final chip = _Chip(label: label, selected: false, onTap: onTap ?? () {});
    return tooltip == null ? chip : Tooltip(message: tooltip!, child: chip);
  }
}

/// What a badge MEANS, not what colour it is.
///
/// `warn` is the amber "needs you"; `alarm` is the red "broken". They were
/// `warn` and `bad`, and `bad` said nothing about why.
enum BadgeTone { neutral, good, warn, alarm, live }

class Badge2 extends StatelessWidget {
  const Badge2(this.label, {super.key, this.tone = BadgeTone.neutral});

  final String label;
  final BadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      BadgeTone.good => C.good,
      BadgeTone.warn => C.attention,
      BadgeTone.alarm => C.alarm,
      BadgeTone.live => C.live,
      BadgeTone.neutral => C.textFaint,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: S.x2, vertical: S.x1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600, letterSpacing: 0.3),
      ),
    );
  }
}

/// A label + description + switch row, matching the web's `.toggle`.
class ToggleRow extends StatelessWidget {
  const ToggleRow({
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
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: S.x2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 15, color: C.text, fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text(blurb, style: T.xs),
              ],
            ),
          ),
          const SizedBox(width: S.x3),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

/// A label and a value. Read-only.
class Readout extends StatelessWidget {
  const Readout(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: S.x2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 120, child: Text(label, style: T.xs)),
            Expanded(
              child: Text(value, style: const TextStyle(fontSize: 14, color: C.text)),
            ),
          ],
        ),
      );
}

/// A settings row that opens a picker. Full-width tap target, chevron to say so.
class TappableRow extends StatelessWidget {
  const TappableRow({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        constraints: const BoxConstraints(minHeight: kMinTouch),
        padding: const EdgeInsets.symmetric(vertical: S.x2),
        child: Row(
          children: [
            SizedBox(width: 120, child: Text(label, style: T.xs)),
            Expanded(
              child: Text(
                value,
                style: TextStyle(fontSize: 15, color: onTap == null ? C.textFaint : C.text),
              ),
            ),
            const Icon(Icons.chevron_right, size: 20, color: C.textFaint),
          ],
        ),
      ),
    );
  }
}

/// Inline error text. Always shown next to the thing that failed.
class ErrorText extends StatelessWidget {
  const ErrorText(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: S.x2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.error_outline, size: 16, color: C.alarm),
            const SizedBox(width: S.x2),
            Expanded(child: Text(message, style: const TextStyle(fontSize: 13, color: C.alarm, height: 1.4))),
          ],
        ),
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.blurb});

  final IconData icon;
  final String title;
  final String blurb;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: S.x7, horizontal: S.x4),
        child: Column(
          children: [
            Icon(icon, size: 40, color: C.textFaint),
            const SizedBox(height: S.x4),
            Text(title, style: T.lg, textAlign: TextAlign.center),
            const SizedBox(height: S.x2),
            Text(blurb, style: T.sm, textAlign: TextAlign.center),
          ],
        ),
      );
}
