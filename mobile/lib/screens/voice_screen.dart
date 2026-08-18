/// The voice editor — every setting from lib/style.ts, on a phone.
///
/// Two decisions shape this screen:
///
/// 1. Segmented chips instead of dropdowns. These option sets are short, and
///    the user's actual question is "what are my choices" — a dropdown hides
///    exactly that behind a tap.
///
/// 2. Edits are staged locally and applied with Save. A dozen controls only
///    make sense as a combination, and Preview exists so the combination can
///    be read before it is committed to tomorrow's post.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';

class VoiceScreen extends StatefulWidget {
  const VoiceScreen({super.key});

  @override
  State<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends State<VoiceScreen> {
  StyleConfig? _draft;
  Map<String, dynamic>? _preview;
  bool _previewing = false;
  String? _error;

  StyleConfig get _style => _draft ?? context.read<AppState>().style;

  void _set(StyleConfig next) => setState(() {
        _draft = next;
        // A preview of the previous settings is worse than no preview.
        _preview = null;
      });

  bool get _dirty {
    if (_draft == null) return false;
    final saved = context.read<AppState>().style;
    return _draft!.toJson().toString() != saved.toJson().toString();
  }

  Future<void> _save() async {
    final error = await context.read<AppState>().setStyle(_style);
    if (!mounted) return;
    setState(() {
      _error = error;
      if (error == null) _draft = null; // fall back through to the saved value
    });
    if (error == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Voice saved.')));
    }
  }

  Future<void> _runPreview() async {
    setState(() {
      _previewing = true;
      _error = null;
    });
    try {
      final result = await context.read<AppState>().previewStyle(_style);
      if (!mounted) return;
      setState(() {
        _preview = result;
        _previewing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _previewing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final style = _style;
    final sig = style.signature;

    return ListView(
      padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
      children: [
        Panel(
          // Show the STAGED style, not the saved one. Showing the saved summary
          // while the controls below display something else reads as "my change
          // did nothing" — the header looks like a live readout of the settings
          // right under it.
          title: _dirty ? 'Voice — unsaved' : 'Current voice',
          subtitle: style.summary,
          trailing: _dirty ? const Badge2('UNSAVED', tone: BadgeTone.warn) : null,
          child: Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            children: [
              for (final preset in state.status?.presets ?? const <StylePreset>[])
                ActionChip2(
                  label: preset.label,
                  tooltip: preset.blurb,
                  onTap: () => _set(preset.style),
                ),
            ],
          ),
        ),
        const SizedBox(height: S.x4),

        // Deliberately above the knobs. Everything below this describes the
        // voice from the outside; this is the voice itself, and it moves the
        // output further than any of the settings under it.
        const _WritingSamplesPanel(),
        const SizedBox(height: S.x4),

        Panel(
          title: 'Shape',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Field(
                label: 'Structure',
                child: ChoiceRow<String>(
                  value: style.structure,
                  options: const {
                    'prose': 'Paragraphs',
                    'bullets': 'Bullets',
                    'short-lines': 'Short lines',
                    'mixed': 'Lead + bullets',
                  },
                  onChanged: (v) => _set(style.copyWith(structure: v)),
                ),
              ),
              Field(
                label: 'Emoji',
                child: ChoiceRow<String>(
                  value: style.emoji,
                  options: const {'none': 'None', 'sparing': 'Sparing', 'expressive': 'Expressive'},
                  onChanged: (v) => _set(style.copyWith(emoji: v)),
                ),
              ),
              Field(
                label: 'Opening line',
                child: ChoiceRow<String>(
                  value: style.hook,
                  options: const {'plain': 'Plain', 'sharp': 'Sharp', 'bold': 'Bold claim'},
                  onChanged: (v) => _set(style.copyWith(hook: v)),
                ),
              ),
              Field(
                label: 'Closing',
                child: ChoiceRow<String>(
                  value: style.cta,
                  options: const {'none': 'No CTA', 'soft': 'Soft question', 'direct': 'Direct ask'},
                  onChanged: (v) => _set(style.copyWith(cta: v)),
                ),
              ),
              Field(
                label: 'Written for',
                child: ChoiceRow<String>(
                  value: style.register,
                  options: const {
                    'practitioner': 'Peers',
                    'peer': 'Professionals',
                    'accessible': 'Anyone',
                  },
                  onChanged: (v) => _set(style.copyWith(register: v)),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: S.x4),

        Panel(
          title: 'Length and tags',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Stepper(
                label: 'Minimum words',
                value: style.minWords,
                min: 40,
                max: style.maxWords - 20,
                step: 10,
                onChanged: (v) => _set(style.copyWith(minWords: v)),
              ),
              _Stepper(
                label: 'Maximum words',
                value: style.maxWords,
                min: style.minWords + 20,
                max: 500,
                step: 10,
                onChanged: (v) => _set(style.copyWith(maxWords: v)),
              ),
              _Stepper(
                label: 'Hashtags',
                value: style.hashtagCount,
                min: 0,
                max: 5,
                step: 1,
                onChanged: (v) => _set(style.copyWith(hashtagCount: v)),
              ),
            ],
          ),
        ),
        const SizedBox(height: S.x4),

        Panel(
          title: 'Signature line',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ToggleRow(
                title: 'Use a signature line',
                blurb: 'A rationed catchphrase — at most one short quote, and not in every post.',
                value: sig != null,
                onChanged: (on) => _set(
                  on
                      ? style.copyWith(
                          signature: const SignatureConfig(
                            source: 'Marvel films',
                            maxWords: 12,
                            budgetPerFive: 1,
                            banned: [],
                          ),
                        )
                      : style.copyWith(clearSignature: true),
                ),
              ),
              if (sig != null) ...[
                const SizedBox(height: S.x3),
                Field(
                  label: 'Quotes drawn from',
                  child: TextFormField(
                    initialValue: sig.source,
                    style: const TextStyle(fontSize: 15, color: C.text),
                    decoration: const InputDecoration(hintText: 'Marvel films'),
                    // setState, not a bare assignment: _dirty is computed during
                    // build, so writing _draft without a rebuild leaves Save
                    // disabled and the edit unsaveable.
                    onChanged: (v) => _set(style.copyWith(signature: sig.copyWith(source: v))),
                  ),
                ),
                _Stepper(
                  label: 'At most per 5 posts',
                  value: sig.budgetPerFive,
                  min: 1,
                  max: 5,
                  step: 1,
                  onChanged: (v) =>
                      _set(style.copyWith(signature: sig.copyWith(budgetPerFive: v))),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: S.x4),

        Panel(
          title: 'Rules',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Field(
                label: 'Banned phrases (one per line)',
                child: TextFormField(
                  initialValue: style.bannedPhrases.join('\n'),
                  maxLines: 5,
                  minLines: 3,
                  style: const TextStyle(fontSize: 14, color: C.text, height: 1.5),
                  onChanged: (v) => _set(style.copyWith(bannedPhrases: _lines(v))),
                ),
              ),
              Field(
                label: 'Your own rules (one per line)',
                child: TextFormField(
                  initialValue: style.customRules.join('\n'),
                  maxLines: 5,
                  minLines: 3,
                  style: const TextStyle(fontSize: 14, color: C.text, height: 1.5),
                  decoration: const InputDecoration(
                    hintText: 'Never mention my employer by name',
                  ),
                  onChanged: (v) => _set(style.copyWith(customRules: _lines(v))),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: S.x4),

        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _previewing || state.loading ? null : _runPreview,
                icon: _previewing
                    ? const SizedBox(
                        height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.visibility_outlined, size: 18),
                label: Text(_previewing ? 'Writing…' : 'Preview'),
              ),
            ),
            const SizedBox(width: S.x2),
            Expanded(
              child: FilledButton(
                onPressed: _dirty && !state.loading ? _save : null,
                child: Text(_dirty ? 'Save' : 'Saved'),
              ),
            ),
          ],
        ),
        if (_dirty) ...[
          const SizedBox(height: S.x2),
          TextButton(
            onPressed: () => setState(() {
              _draft = null;
              _preview = null;
            }),
            child: const Text('Revert changes'),
          ),
        ],
        if (_error != null) ErrorText(_error!),

        if (_preview != null) ...[
          const SizedBox(height: S.x4),
          _PreviewPanel(preview: _preview!),
        ],
      ],
    );
  }

  static List<String> _lines(String v) =>
      v.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
}

/// Numeric control with big hit areas. A phone keyboard for a number between
/// 0 and 5 is the wrong tool; two 48px buttons are the right one.
/// Writing samples, and what the agent has learned from your edits.
///
/// This is the one control on this screen that shows the writer prose rather
/// than describing it. Everything else here is a rule ABOUT the voice; a sample
/// is the voice, and three real posts move a model's register further than any
/// number of settings.
class _WritingSamplesPanel extends StatefulWidget {
  const _WritingSamplesPanel();

  @override
  State<_WritingSamplesPanel> createState() => _WritingSamplesPanelState();
}

class _WritingSamplesPanelState extends State<_WritingSamplesPanel> {
  static const _minSampleChars = 80;

  final _input = TextEditingController();
  bool _adding = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final state = context.read<AppState>();
    final text = _input.text.trim();
    if (text.length < _minSampleChars) return;

    setState(() => _adding = true);
    final error = await state.addCorpusSample(text);
    if (!mounted) return;
    setState(() => _adding = false);
    if (error == null) {
      _input.clear();
      FocusScope.of(context).unfocus();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final samples = state.corpus;
    final notes = state.agent?.editNotes;
    final typed = _input.text.trim().length;
    final canAdd = typed >= _minSampleChars && !_adding && !state.loading;

    return Panel(
      title: 'How you write',
      subtitle: samples.isEmpty
          ? 'Paste a few posts you are happy with. The writer studies them before drafting — this changes the voice more than any setting below.'
          : '${samples.length} sample${samples.length == 1 ? "" : "s"}. The writer studies up to three before drafting.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < samples.length; i++) ...[
            _SampleTile(
              text: samples[i],
              onRemove: state.loading ? null : () => state.removeCorpusSample(i),
            ),
            const SizedBox(height: S.x2),
          ],
          if (samples.isNotEmpty) const SizedBox(height: S.x2),
          TextField(
            controller: _input,
            maxLines: 5,
            minLines: 3,
            style: T.body,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'Paste a post here — one you wrote, or one whose voice you want.',
            ),
          ),
          const SizedBox(height: S.x2),
          Row(
            children: [
              Expanded(
                child: Text(
                  // A short paste teaches a model nothing, and the server drops
                  // it silently — so say the threshold rather than letting the
                  // button look broken.
                  typed == 0
                      ? 'At least $_minSampleChars characters.'
                      : typed < _minSampleChars
                          ? '${_minSampleChars - typed} more characters needed.'
                          : '$typed characters.',
                  style: T.xs,
                ),
              ),
              const SizedBox(width: S.x2),
              FilledButton(
                onPressed: canAdd ? _add : null,
                child: Text(_adding ? 'Adding…' : 'Add sample'),
              ),
            ],
          ),
          if (notes != null && notes.trim().isNotEmpty) ...[
            const SizedBox(height: S.x4),
            Container(
              padding: const EdgeInsets.all(S.x3),
              decoration: BoxDecoration(
                color: C.surface2,
                border: Border.all(color: C.border),
                borderRadius: BorderRadius.circular(R.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('WHAT IT LEARNED FROM YOUR EDITS', style: T.panelHead),
                  const SizedBox(height: S.x2),
                  Text(notes.trim(), style: T.sm),
                  const SizedBox(height: S.x2),
                  Text(
                    'Written from drafts you rewrote before publishing. It updates itself as you edit more.',
                    style: T.xs,
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SampleTile extends StatelessWidget {
  const _SampleTile({required this.text, required this.onRemove});

  final String text;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(S.x3, S.x3, S.x2, S.x3),
      decoration: BoxDecoration(
        color: C.surface2,
        border: Border.all(color: C.border),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(text, style: T.sm, maxLines: 3, overflow: TextOverflow.ellipsis),
          ),
          IconButton(
            onPressed: onRemove,
            icon: const Icon(Icons.close, size: 18),
            tooltip: 'Remove this sample',
            style: IconButton.styleFrom(
              minimumSize: const Size(kMinTouch, kMinTouch),
              foregroundColor: C.textFaint,
            ),
          ),
        ],
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.step,
    required this.onChanged,
  });

  final String label;
  final int value;
  final int min;
  final int max;
  final int step;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final canDown = value - step >= min;
    final canUp = value + step <= max;

    return Padding(
      padding: const EdgeInsets.only(bottom: S.x3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 15, color: C.text))),
          _StepButton(
            icon: Icons.remove,
            onTap: canDown ? () => onChanged(value - step) : null,
            semanticLabel: 'Decrease $label',
          ),
          SizedBox(
            width: 52,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 17,
                color: C.text,
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          _StepButton(
            icon: Icons.add,
            onTap: canUp ? () => onChanged(value + step) : null,
            semanticLabel: 'Increase $label',
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap, required this.semanticLabel});

  final IconData icon;
  final VoidCallback? onTap;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      icon: Icon(icon, size: 20),
      tooltip: semanticLabel,
      style: IconButton.styleFrom(
        minimumSize: const Size(kMinTouch, kMinTouch),
        backgroundColor: C.surface2,
        foregroundColor: onTap == null ? C.textFaint : C.text,
        side: const BorderSide(color: C.borderStrong),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
      ),
    );
  }
}

class _PreviewPanel extends StatelessWidget {
  const _PreviewPanel({required this.preview});

  final Map<String, dynamic> preview;

  @override
  Widget build(BuildContext context) {
    final after = preview['after'] as String? ?? '';
    final sourceLabel = preview['sourceLabel'] as String? ?? 'a sample';
    final length = preview['length'] as Map<String, dynamic>?;
    final chars = length?['escapedChars'];
    final within = length?['withinLimit'] != false;

    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: C.surface2,
        border: Border.all(color: C.borderStrong, style: BorderStyle.solid),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Badge2('PREVIEW', tone: BadgeTone.live),
              const SizedBox(width: S.x2),
              if (chars != null)
                Badge2('$chars chars', tone: within ? BadgeTone.neutral : BadgeTone.bad),
            ],
          ),
          const SizedBox(height: S.x2),
          Text('Rewritten from $sourceLabel — not saved.', style: T.xs),
          const SizedBox(height: S.x3),
          Text(after, style: T.body),
        ],
      ),
    );
  }
}
