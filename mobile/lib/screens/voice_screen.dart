/// The voice editor — every setting from lib/style.ts, on a phone.
///
/// Three decisions shape this screen:
///
/// 1. Plain-language guidance first. Dropdowns keep structured preferences
///    compact, while examples and free text remain directly editable.
///
/// 2. Edits are staged and applied with Save. A dozen controls only make sense
///    as a combination, and Preview exists so the combination can be read
///    before it is committed to tomorrow's post.
///
/// 3. Save and Preview live in a bar pinned to the bottom, not at the end of
///    the scroll. Change a chip at the top of a screen this long and the
///    control that commits it was six sections away.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/experience.dart';
import '../widgets/form_select.dart';
import '../widgets/primitives.dart';
import '../widgets/unsaved_changes_guard.dart';
import '../widgets/editorial.dart';
import '../widgets/writing_preferences.dart';

class VoiceScreen extends StatefulWidget {
  const VoiceScreen({super.key});

  @override
  State<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends State<VoiceScreen> {
  StyleConfig? _draft;
  late final TextEditingController _rules;
  @override
  void initState() {
    super.initState();
    _rules = TextEditingController(
      text: context.read<AppState>().style.customRules.join('\n'),
    );
  }

  @override
  void dispose() {
    _rules.dispose();
    super.dispose();
  }

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
    if (_style.customRules.length > 12 ||
        _style.customRules.any((r) => r.length > 240)) {
      setState(
        () => _error =
            'Use up to 12 instructions, each no longer than 240 characters.',
      );
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final submitted = _style;
    final error = await context.read<AppState>().setStyle(submitted);
    if (!mounted) return;
    setState(() {
      _error = error;
      if (error == null &&
          _style.toJson().toString() == submitted.toJson().toString()) {
        _draft = null;
      }
    });
    if (error == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Voice saved.')));
    }
  }

  Future<void> _runPreview() async {
    setState(() {
      _previewing = true;
      _error = null;
    });
    try {
      final requested = _style.toJson().toString();
      final state = context.read<AppState>();
      final voice = state.styleFingerprint;
      final result = await state.previewStyle(_style);
      if (!mounted) return;
      setState(() {
        if (requested == _style.toJson().toString() &&
            voice == state.styleFingerprint) {
          _preview = result;
        }
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

    return UnsavedChangesGuard(
      dirty: _dirty,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Voice'),
          actions: [
            if (_dirty)
              const Padding(
                padding: EdgeInsets.only(right: S.x4),
                child: Center(child: Slug('unsaved', tone: Tone.desk)),
              ),
          ],
        ),
        body: SafeArea(
          child: PageSurface(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(S.x4, S.x5, S.x4, S.x5),
              children: [
                const StudioBanner(
                  compact: true,
                  scene: StudioScene.voice,
                  eyebrow: 'YOUR POINT OF VIEW',
                  title: 'Make it sound like you.',
                  caption:
                      'Your words, your rhythm, your way of seeing things.',
                ),
                const SizedBox(height: 24),
                // The staged style, not the saved one. Showing the saved summary
                // while the controls below display something else reads as "my
                // change did nothing".
                Text(style.summary, style: T.body.copyWith(color: C.paperDim)),
                const SizedBox(height: S.x5),
                const SectionRule('Describe your voice'),
                const Text(
                  'Tell ByLine how you want to sound. Your examples and instructions shape every draft.',
                  style: T.small,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _rules,
                  minLines: 4,
                  maxLines: 8,
                  decoration: const InputDecoration(
                    labelText: 'Your own rules',
                    hintText:
                        'Write like I’m explaining an idea to a colleague.\nKeep it practical and warm.\nAvoid buzzwords and exaggerated claims.',
                    helperText:
                        'Up to 12 instructions, one per line; 240 characters each.',
                    helperMaxLines: 2,
                  ),
                  onChanged: (v) =>
                      _set(_style.copyWith(customRules: _lines(v))),
                ),
                const SizedBox(height: 24),
                const _WritingSamples(),
                const SizedBox(height: 24),
                const SectionRule('Optional starting points'),
                FormSelect<String>(
                  label: 'Start from a preset',
                  hint: 'Custom voice — choose a preset to replace it',
                  value: null,
                  options: {
                    for (final p in state.status?.presets ?? <StylePreset>[])
                      p.id: p.label,
                  },
                  onChanged: (id) {
                    final preset = state.status!.presets.firstWhere(
                      (p) => p.id == id,
                    );
                    final next = preset.style.copyWith(
                      customRules: _style.customRules,
                      bannedPhrases: _style.bannedPhrases,
                    );
                    _set(next);
                  },
                ),
                const SizedBox(height: S.x6),

                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('Fine-tune your writing'),
                  subtitle: const Text(
                    'Structure, length, emoji, signatures and phrases to avoid',
                  ),
                  children: [
                    WritingPreferences(
                      value: style,
                      onChanged: state.loading ? null : _set,
                    ),
                    const SectionRule('Signature line'),
                    SwitchRow(
                      title: 'Use a signature line',
                      blurb:
                          'A rationed catchphrase — at most one short quote, and not in '
                          'every post.',
                      value: sig != null,
                      onChanged: (on) => _set(
                        on
                            ? style.copyWith(
                                signature: const SignatureConfig(
                                  source: 'Books and talks',
                                  maxWords: 12,
                                  budgetPerFive: 1,
                                  banned: [],
                                ),
                              )
                            : style.copyWith(clearSignature: true),
                      ),
                    ),
                    if (sig != null) ...[
                      const SizedBox(height: S.x4),
                      Field(
                        label: 'Quotes drawn from',
                        child: TextFormField(
                          initialValue: sig.source,
                          style: T.body,
                          decoration: const InputDecoration(
                            hintText:
                                'An author, book or speaker you return to',
                          ),
                          // _set, not a bare assignment: _dirty is computed during
                          // build, so writing _draft without a rebuild leaves Save
                          // disabled and the edit unsaveable.
                          onChanged: (v) => _set(
                            style.copyWith(signature: sig.copyWith(source: v)),
                          ),
                        ),
                      ),
                      _Stepper(
                        label: 'At most per 5 posts',
                        value: sig.budgetPerFive,
                        min: 1,
                        max: 5,
                        step: 1,
                        onChanged: (v) => _set(
                          style.copyWith(
                            signature: sig.copyWith(budgetPerFive: v),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: S.x5),

                    const SectionRule('Rules'),
                    Field(
                      label: 'Banned phrases',
                      hint: 'One per line.',
                      child: TextFormField(
                        initialValue: style.bannedPhrases.join('\n'),
                        maxLines: 5,
                        minLines: 3,
                        style: T.body,
                        onChanged: (v) =>
                            _set(style.copyWith(bannedPhrases: _lines(v))),
                      ),
                    ),
                  ],
                ),

                if (_error != null) ErrorNote(_error!),

                if (_preview != null) ...[
                  const SizedBox(height: S.x5),
                  _Preview(preview: _preview!),
                ],

                if (_dirty) ...[
                  const SizedBox(height: S.x4),
                  Center(
                    child: TextButton(
                      onPressed: () => setState(() {
                        _draft = null;
                        _rules.text = context
                            .read<AppState>()
                            .style
                            .customRules
                            .join('\n');
                        _preview = null;
                      }),
                      child: const Text('Revert changes'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        bottomNavigationBar: _ActionBar(
          dirty: _dirty,
          previewing: _previewing,
          busy: state.loading,
          onPreview: _runPreview,
          onSave: _save,
        ),
      ),
    );
  }

  static List<String> _lines(String v) =>
      v.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
}

/// Pinned to the bottom so the commit is always one reach away.
class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.dirty,
    required this.previewing,
    required this.busy,
    required this.onPreview,
    required this.onSave,
  });

  final bool dirty;
  final bool previewing;
  final bool busy;
  final VoidCallback onPreview;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) => Container(
    decoration: const BoxDecoration(
      color: C.ink2,
      border: Border(top: BorderSide(color: C.rule)),
    ),
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(S.x3),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: previewing || busy ? null : onPreview,
                icon: previewing
                    ? const SizedBox(
                        height: 15,
                        width: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.visibility_outlined, size: 17),
                label: Text(previewing ? 'Writing…' : 'Preview'),
              ),
            ),
            const SizedBox(width: S.x2),
            Expanded(
              child: FilledButton(
                onPressed: dirty && !busy ? onSave : null,
                child: Text(dirty ? 'Save' : 'Saved'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Writing samples, and what the agent has learned from your edits.
class _WritingSamples extends StatefulWidget {
  const _WritingSamples();

  @override
  State<_WritingSamples> createState() => _WritingSamplesState();
}

class _WritingSamplesState extends State<_WritingSamples> {
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
    final messenger = ScaffoldMessenger.of(context);
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
      messenger.showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final samples = state.corpus;
    final notes = state.agent?.editNotes;
    final typed = _input.text.trim().length;
    final canAdd =
        typed >= _minSampleChars &&
        typed <= 2400 &&
        samples.length < 10 &&
        !_adding &&
        !state.loading;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionRule(
          'How you write',
          trailing: samples.isEmpty
              ? null
              : Text(
                  '${samples.length}',
                  style: T.data.copyWith(fontSize: 12.5),
                ),
        ),
        Text(
          samples.isEmpty
              ? 'Paste a few posts you are happy with. The writer studies them before '
                    'drafting — this changes the voice more than any setting below.'
              : 'The writer studies up to three of these before drafting.',
          style: T.micro,
        ),
        const SizedBox(height: S.x4),

        for (var i = 0; i < samples.length; i++) ...[
          _Sample(
            text: samples[i],
            onRemove: state.loading ? null : () => state.removeCorpusSample(i),
          ),
          const SizedBox(height: S.x2),
        ],
        if (samples.isNotEmpty) const SizedBox(height: S.x2),

        TextField(
          key: const Key('voice-sample'),
          controller: _input,
          maxLength: 2400,
          maxLines: 5,
          minLines: 3,
          style: T.body,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText:
                'Paste a post here — one you wrote, or one whose voice you want.',
          ),
        ),
        const SizedBox(height: S.x3),
        Row(
          children: [
            Expanded(
              child: Text(
                // A short paste teaches a model nothing and the server drops it
                // silently — so say the threshold rather than letting the button
                // look broken.
                samples.length >= 10
                    ? 'You have 10 samples. Remove one to add another.'
                    : typed == 0
                    ? 'At least $_minSampleChars characters.'
                    : typed < _minSampleChars
                    ? '${_minSampleChars - typed} more characters needed.'
                    : '$typed characters.',
                style: T.micro,
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
          const SizedBox(height: S.x5),
          ObjectCard(
            padding: const EdgeInsets.all(S.x3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('WHAT IT LEARNED FROM YOUR EDITS', style: T.slug),
                const SizedBox(height: S.x2),
                Text(notes.trim(), style: T.small),
                const SizedBox(height: S.x2),
                Text(
                  'Written from drafts you rewrote before publishing. It updates itself '
                  'as you edit more.',
                  style: T.micro,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Sample extends StatelessWidget {
  const _Sample({required this.text, required this.onRemove});

  final String text;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(S.x3, S.x2, S.x1, S.x2),
    decoration: BoxDecoration(
      color: C.ink2,
      border: Border.all(color: C.rule),
      borderRadius: BorderRadius.circular(R.sm),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Text(
            text,
            style: T.small,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        IconButton(
          onPressed: onRemove,
          icon: const Icon(Icons.close, size: 17),
          tooltip: 'Remove this sample',
          style: IconButton.styleFrom(
            minimumSize: const Size(kMinTouch, kMinTouch),
            foregroundColor: C.paperFaint,
          ),
        ),
      ],
    ),
  );
}

/// Numeric control with big hit areas. A phone keyboard for a number between 0
/// and 5 is the wrong tool; two 48px buttons are the right one.
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
    return Padding(
      padding: const EdgeInsets.only(bottom: S.x3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: T.body)),
          _StepButton(
            icon: Icons.remove,
            label: 'Decrease $label',
            onTap: value - step >= min ? () => onChanged(value - step) : null,
          ),
          SizedBox(
            width: 52,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: T.data.copyWith(fontSize: 17, color: C.paper),
            ),
          ),
          _StepButton(
            icon: Icons.add,
            label: 'Increase $label',
            onTap: value + step <= max ? () => onChanged(value + step) : null,
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.icon,
    required this.onTap,
    required this.label,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String label;

  @override
  Widget build(BuildContext context) => IconButton(
    onPressed: onTap,
    icon: Icon(icon, size: 19),
    tooltip: label,
    style: IconButton.styleFrom(
      minimumSize: const Size(kMinTouch, kMinTouch),
      backgroundColor: C.ink2,
      foregroundColor: onTap == null ? C.paperFaint : C.paper,
      side: const BorderSide(color: C.ruleStrong),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
    ),
  );
}

class _Preview extends StatelessWidget {
  const _Preview({required this.preview});

  final Map<String, dynamic> preview;

  @override
  Widget build(BuildContext context) {
    final after = preview['after'] as String? ?? '';
    final sourceLabel = preview['sourceLabel'] as String? ?? 'a sample';
    final length = preview['length'] as Map<String, dynamic>?;
    final chars = length?['escapedChars'];
    final within = length?['withinLimit'] != false;

    return ObjectCard(
      tone: Tone.out,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Slug('preview', tone: Tone.out),
              const SizedBox(width: S.x2),
              if (chars != null)
                Slug('$chars chars', tone: within ? Tone.quiet : Tone.broken),
            ],
          ),
          const SizedBox(height: S.x2),
          Text('Rewritten from $sourceLabel — not saved.', style: T.micro),
          const SizedBox(height: S.x3),
          Text(after, style: T.copy),
        ],
      ),
    );
  }
}
