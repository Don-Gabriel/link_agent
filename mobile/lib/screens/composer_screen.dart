/// Write a new post, or edit a drafted one.
///
/// One screen for both, rather than a separate edit sheet, because they are the
/// same job: getting a piece of text right before it goes out. Splitting them
/// meant the editor had no attachments, no voice controls in reach, and no way
/// to ask for another version — everything the composer already had.
///
/// Three things here are deliberate:
///
///   * Rewriting NEVER overwrites silently. A variant is shown beside the
///     current text and replaces it only when the user says so.
///   * A voice change does not rewrite anything on its own. It raises a banner
///     offering to. Silently regenerating text somebody typed, because they
///     touched a settings toggle on another tab, would be indefensible.
///   * Rewriting reads the CURRENT voice — every style rule, plus the author's
///     writing samples and edit notes — because the server builds that prompt
///     fresh on each request. Anything saved on the Voice tab is in effect on
///     the very next press, with nothing cached in between.
///   * Images upload on save, not on pick, so abandoning a draft does not leave
///     orphaned assets registered at LinkedIn.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';
import '../widgets/post_card.dart';

/// Mirrors MAX_BODY_CHARS in lib/format.ts.
const int kMaxBodyChars = 2400;

class ComposerScreen extends StatefulWidget {
  const ComposerScreen({super.key});

  @override
  State<ComposerScreen> createState() => _ComposerScreenState();
}

class _ComposerScreenState extends State<ComposerScreen> {
  final _text = TextEditingController();
  final _tagInput = TextEditingController();
  final _picker = ImagePicker();

  /// Hashtags on this post. Loaded from the draft when editing — sending an
  /// empty list on every edit silently stripped the tags the writer chose.
  List<String> _hashtags = [];

  bool _polish = false;
  bool _busy = false;
  String? _error;
  String? _status;

  /// Local image files chosen but not yet uploaded.
  final List<XFile> _pending = [];

  /// Media ids already attached to the draft being edited.
  List<String> _existingMedia = [];

  /// A rewrite waiting to be accepted or dismissed.
  String? _variant;
  int _variantIndex = 0;

  /// Which post this screen is currently loaded with, so we only re-fill when
  /// the target actually changes rather than on every rebuild.
  int? _loadedSeq;

  /// When this post should go out, or null for "not on the timetable". A
  /// hand-written post can be scheduled exactly like a generated one.
  DateTime? _scheduledFor;

  /// The voice summary at the moment the current text was loaded or generated.
  /// Compared against the live one to decide whether the text is stale.
  String? _voiceAtLoad;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    _tagInput.dispose();
    super.dispose();
  }

  /// LinkedIn's hashtag template accepts a single alphanumeric word; anything
  /// shorter than three characters is noise. Mirrors normalizeHashtag in
  /// lib/format.ts, which is what actually assembles the published text.
  void _addTag(int cap) {
    final cleaned = _tagInput.text.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
    if (cleaned.length < 3 || cleaned.length > 40) return;
    if (_hashtags.length >= cap || _hashtags.contains(cleaned)) return;
    setState(() {
      _hashtags = [..._hashtags, cleaned];
      _tagInput.clear();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncWithEditingTarget();
  }

  void _syncWithEditingTarget() {
    final state = context.read<AppState>();
    final target = state.editing;

    if (target == null) {
      if (_loadedSeq != null) {
        // Left edit mode — clear back to a blank composer. Release the edit
        // lock on the way out, or a scheduled post stays blocked until the
        // server expires the hold.
        state.releaseEditing(_loadedSeq!);
        _loadedSeq = null;
        _text.clear();
        _pending.clear();
        _existingMedia = [];
        _hashtags = [];
        _scheduledFor = null;
        _variant = null;
        _voiceAtLoad = state.styleFingerprint;
      }
      return;
    }

    if (_loadedSeq == target.seq) return;
    // Opening a different post releases the previous one's lock.
    if (_loadedSeq != null) state.releaseEditing(_loadedSeq!);
    _loadedSeq = target.seq;
    _text.text = target.text;
    _existingMedia = List.of(target.media);
    _hashtags = List.of(target.hashtags);
    _scheduledFor = target.scheduledFor;
    _pending.clear();
    _variant = null;
    _voiceAtLoad = state.styleFingerprint;

    // Take the edit lock so the scheduled send cannot fire while this is open
    // and publish half a sentence. Time-bounded on the server, so forgetting to
    // release it costs a delay rather than a silenced slot.
    if (target.isScheduled) state.holdForEditing(target.seq);
  }

  bool get _editing => _loadedSeq != null;

  Future<void> _pickImages() async {
    try {
      // Downscale at pick time: /api/media caps the body at 4MB and a modern
      // phone photo is several times that.
      final picked = await _picker.pickMultiImage(maxWidth: 1920, maxHeight: 1920, imageQuality: 85);
      if (picked.isEmpty) return;
      setState(() {
        _pending.addAll(picked);
        final total = _pending.length + _existingMedia.length;
        if (total > 20) _pending.removeRange(20 - _existingMedia.length, _pending.length);
        _error = null;
      });
    } on Exception catch (e) {
      setState(() => _error = 'Could not open the picker: $e');
    }
  }

  Future<List<String>?> _uploadPending() async {
    if (_pending.isEmpty) return _existingMedia;
    try {
      final ids = await context.read<AppState>().uploadImages(_pending.map((f) => f.path).toList());
      return [..._existingMedia, ...ids];
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = 'Image upload failed — $e');
      return null;
    }
  }

  Future<void> _rewrite() async {
    final seq = _loadedSeq;
    final typed = _text.text.trim();
    // Unsaved text has no seq to reference, so it goes to the endpoint that
    // takes the body directly. Both return a variant and save nothing.
    if (seq == null && typed.length < 20) return;

    setState(() {
      _busy = true;
      _error = null;
      _status = null;
    });
    try {
      final state = context.read<AppState>();
      final text = seq != null
          ? await state.rewriteDraft(seq, variant: _variantIndex)
          : await state.rewriteText(typed, variant: _variantIndex);
      if (!mounted) return;
      setState(() {
        _variant = text;
        _variantIndex++;
        _busy = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = '$e';
      });
    }
  }

  void _acceptVariant() {
    final variant = _variant;
    if (variant == null) return;
    final state = context.read<AppState>();

    // The author's hashtags are kept, and the rewrite's suggestions fill
    // whatever room is left under the cap. This used to replace the list
    // outright, which quietly deleted tags someone had typed deliberately —
    // the model's opinion about tags is worth less than an explicit choice.
    //
    // Existing tags are never dropped even if there are already more of them
    // than the cap allows: trimming is the tag editor's job, not a side effect
    // of pressing rewrite.
    final kept = List.of(_hashtags);
    final room = state.style.hashtagCount - kept.length;
    final added = room <= 0
        ? const <String>[]
        : state.lastVariantHashtags
            .where((t) => !kept.any((k) => k.toLowerCase() == t.toLowerCase()))
            .take(room)
            .toList();

    setState(() {
      _text.text = variant;
      _hashtags = [...kept, ...added];
      _variant = null;
      _voiceAtLoad = state.styleFingerprint;
      _status = switch ((kept.isEmpty, added.isEmpty)) {
        (true, true) => 'Applied. Not saved yet.',
        (true, false) => 'Applied, with ${added.length} suggested '
            '${added.length == 1 ? 'hashtag' : 'hashtags'}. Not saved yet.',
        (false, true) => 'Applied. Your hashtags are unchanged. Not saved yet.',
        (false, false) => 'Applied. Your ${kept.length} '
            '${kept.length == 1 ? 'hashtag' : 'hashtags'} kept, ${added.length} added. Not saved yet.',
      };
    });
  }

  /// Show the post exactly as it will be assembled, then confirm.
  ///
  /// Nothing leaves this screen without the author having seen the final text —
  /// body, source line and hashtags together, with the fold marker where
  /// LinkedIn will cut it. The composer's text box shows the body alone, which
  /// is not the same thing: the tags and the truncation are where posts
  /// actually go wrong.
  Future<bool> _previewAndConfirm({required bool publishNow}) async {
    final state = context.read<AppState>();
    final live = state.status?.liveMode ?? false;
    final imageCount = _pending.length + _existingMedia.length;

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: C.surface,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(R.lg)),
      ),
      builder: (ctx) => _PreviewSheet(
        body: _text.text.trim(),
        hashtags: _hashtags,
        imageCount: imageCount,
        publishNow: publishNow,
        liveMode: live,
        editing: _editing,
      ),
    );
    return ok == true;
  }

  Future<void> _save({required bool publishNow}) async {
    final state = context.read<AppState>();
    if (!await _previewAndConfirm(publishNow: publishNow)) return;
    if (!mounted) return;

    setState(() {
      _busy = true;
      _error = null;
      _status = null;
    });

    final mediaIds = await _uploadPending();
    if (mediaIds == null) {
      if (mounted) setState(() => _busy = false);
      return;
    }

    String? error;
    final seq = _loadedSeq;
    if (seq != null) {
      error = await state.editPost(seq, _text.text.trim(), _hashtags, mediaIds: mediaIds);
      // Saving ends the edit, so the hold goes with it — otherwise a scheduled
      // post would sit blocked until the server expired the lock.
      if (error == null) await state.releaseEditing(seq);
      if (error == null && publishNow) error = await state.sendNow(seq);
    } else {
      error = await state.compose(
        text: _text.text.trim(),
        polish: _polish,
        publishNow: publishNow,
        hashtags: _hashtags,
        mediaIds: mediaIds,
        scheduledFor: _scheduledFor,
      );
    }

    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
      if (error == null) {
        _pending.clear();
        if (seq == null) _text.clear();
      }
    });

    if (error == null) {
      state.stopEditing();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(publishNow
              ? 'Published.'
              : seq != null
                  ? 'Draft updated.'
                  : 'Saved to the queue.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // NOT _syncWithEditingTarget() here. It assigns to _text, whose listener
    // calls setState — doing that during build is "setState called during
    // build". didChangeDependencies covers it: context.watch registers this
    // widget as a dependent, so a notifyListeners from the queue's "edit this"
    // reaches us there first.
    final state = context.watch<AppState>();

    final length = _text.text.trim().length;
    final tooShort = length < 20;
    final tooLong = length > kMaxBodyChars;
    final hookLength = _text.text.split('\n').first.length;
    final canSend = !_busy && !tooShort && !tooLong;
    // Compared against the FULL voice, not style.summary. That summary names
    // the structure, the emoji policy and the tag count and nothing else, so
    // changing the register, the hook, the length or a custom rule left the
    // banner silent — the voice really had moved on and the composer said
    // nothing about it.
    final voiceStale = _voiceAtLoad != null && _voiceAtLoad != state.styleFingerprint && length > 0;

    return ListView(
      padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
      children: [
        if (_editing) ...[
          _Banner(
            tone: BadgeTone.live,
            icon: Icons.edit_outlined,
            title: 'Editing ${state.editing?.id ?? ''}',
            body: 'Changes replace the queued draft.',
            actionLabel: 'Cancel',
            onAction: _busy ? null : () => context.read<AppState>().stopEditing(),
          ),
          const SizedBox(height: S.x3),
        ],

        if (voiceStale) ...[
          _Banner(
            tone: BadgeTone.warn,
            icon: Icons.tune,
            title: 'Your voice changed',
            body: 'This text was written under the old settings — ${state.style.summary}.',
            actionLabel: 'Rewrite',
            onAction: _busy || tooShort ? null : _rewrite,
          ),
          const SizedBox(height: S.x3),
        ],

        Panel(
          title: _editing ? 'Draft' : 'Compose',
          subtitle: state.style.summary,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _text,
                maxLines: null,
                minLines: 8,
                style: T.body,
                enabled: !_busy,
                decoration: const InputDecoration(
                  hintText: 'What happened, what you learned, what you disagree with.',
                ),
              ),
              const SizedBox(height: S.x3),
              // Wrap, not Row: on a narrow phone the two counters together are
              // wider than the panel once the numbers reach three digits.
              Wrap(
                spacing: S.x2,
                runSpacing: S.x2,
                children: [
                  Badge2('$length / $kMaxBodyChars', tone: tooLong ? BadgeTone.alarm : BadgeTone.neutral),
                  if (length > 0)
                    Badge2(
                      'hook $hookLength / $kFoldChars',
                      tone: hookLength > kFoldChars ? BadgeTone.warn : BadgeTone.good,
                    ),
                ],
              ),

              if (state.style.hashtagCount > 0) ...[
                const SizedBox(height: S.x4),
                _Hashtags(
                  tags: _hashtags,
                  cap: state.style.hashtagCount,
                  controller: _tagInput,
                  busy: _busy,
                  onAdd: () => _addTag(state.style.hashtagCount),
                  onRemove: (tag) => setState(() => _hashtags = [..._hashtags]..remove(tag)),
                ),
              ],

              const SizedBox(height: S.x4),
              _Attachments(
                pending: _pending,
                existingCount: _existingMedia.length,
                busy: _busy,
                onAdd: _pickImages,
                onRemove: (i) => setState(() => _pending.removeAt(i)),
                onClearExisting: () => setState(() => _existingMedia = []),
              ),

              if (!_editing) ...[
                const SizedBox(height: S.x2),
                ToggleRow(
                  title: 'Polish in your voice',
                  blurb: 'Tightens the hook and applies your style rules. Never invents facts.',
                  value: _polish,
                  onChanged: _busy ? null : (v) => setState(() => _polish = v),
                ),
              ],

              const SizedBox(height: S.x3),
              // Available while writing something new too, not just when editing
              // a saved draft — a second opinion is most useful before the text
              // has been committed to anything.
              OutlinedButton.icon(
                onPressed: _busy || tooShort ? null : _rewrite,
                icon: _busy
                    ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.auto_awesome_outlined, size: 18),
                label: Text(_variant == null ? 'Rewrite with AI' : 'Try another version'),
              ),
              if (tooShort && length > 0)
                const Padding(
                  padding: EdgeInsets.only(top: S.x2),
                  child: Text('Write at least 20 characters to rewrite.', style: T.xs),
                ),
              const SizedBox(height: S.x2),

              FilledButton(
                onPressed: canSend ? () => _save(publishNow: false) : null,
                child: Text(_busy
                    ? 'Working…'
                    : _editing
                        ? 'Save changes'
                        : 'Save to queue'),
              ),
              const SizedBox(height: S.x2),
              OutlinedButton(
                onPressed: canSend && (state.status?.account.usable ?? false)
                    ? () => _save(publishNow: true)
                    : null,
                child: const Text('Publish now'),
              ),
              if (!(state.status?.account.usable ?? false))
                const Padding(
                  padding: EdgeInsets.only(top: S.x2),
                  child: Text('Connect LinkedIn to publish directly.', style: T.xs),
                ),
              if (_status != null)
                Padding(
                  padding: const EdgeInsets.only(top: S.x2),
                  child: Text(_status!, style: T.xs.copyWith(color: C.good)),
                ),
              if (_error != null) ErrorText(_error!),
            ],
          ),
        ),

        if (_variant != null) ...[
          const SizedBox(height: S.x4),
          _VariantPanel(
            text: _variant!,
            busy: _busy,
            onAccept: _acceptVariant,
            onDismiss: () => setState(() => _variant = null),
            onAnother: _busy ? null : _rewrite,
          ),
        ],
      ],
    );
  }
}

/// The post exactly as it will be sent: body, source line and hashtags
/// assembled, with the fold marker in place.
class _PreviewSheet extends StatelessWidget {
  const _PreviewSheet({
    required this.body,
    required this.hashtags,
    required this.imageCount,
    required this.publishNow,
    required this.liveMode,
    required this.editing,
  });

  final String body;
  final List<String> hashtags;
  final int imageCount;
  final bool publishNow;
  final bool liveMode;
  final bool editing;

  /// Mirrors assemblePost in lib/format.ts. The source line is appended by the
  /// server for agent-written posts with no image, which the app cannot know
  /// here — so it is described rather than faked.
  String get _assembled =>
      hashtags.isEmpty ? body : '$body\n\n${hashtags.map((h) => '#$h').join(' ')}';

  @override
  Widget build(BuildContext context) {
    final text = _assembled;
    final action = publishNow
        ? (liveMode ? 'Publish to LinkedIn' : 'Publish (dry run)')
        : editing
            ? 'Save changes'
            : 'Save to queue';

    return DraggableScrollableSheet(
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, controller) => Column(
        children: [
          const SizedBox(height: S.x2),
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(color: C.borderStrong, borderRadius: BorderRadius.circular(999)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(S.x4, S.x3, S.x4, 0),
            child: Row(
              children: [
                Text('PREVIEW', style: T.panelHead),
                const Spacer(),
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Back'),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: controller,
              padding: const EdgeInsets.fromLTRB(S.x4, S.x2, S.x4, S.x4),
              children: [
                Text('This is what goes out.', style: T.sm),
                const SizedBox(height: S.x3),
                Container(
                  padding: const EdgeInsets.all(S.x3),
                  decoration: BoxDecoration(
                    color: C.surface2,
                    border: Border.all(color: C.border),
                    borderRadius: BorderRadius.circular(R.sm),
                  ),
                  child: _FoldedPreview(text),
                ),
                const SizedBox(height: S.x3),
                Wrap(
                  spacing: S.x2,
                  runSpacing: S.x2,
                  children: [
                    Badge2('${text.length} chars',
                        tone: text.length > 2400 ? BadgeTone.alarm : BadgeTone.neutral),
                    Badge2(hashtags.isEmpty ? 'no tags' : '${hashtags.length} tags'),
                    if (imageCount > 0) Badge2('$imageCount image${imageCount == 1 ? '' : 's'}'),
                    if (publishNow)
                      Badge2(liveMode ? 'LIVE' : 'dry run',
                          tone: liveMode ? BadgeTone.live : BadgeTone.warn),
                  ],
                ),
                if (publishNow) ...[
                  const SizedBox(height: S.x3),
                  Text(
                    liveMode
                        ? 'This posts to your profile now. It cannot be unpublished from here.'
                        : 'Live mode is off, so nothing will actually reach LinkedIn.',
                    style: T.xs,
                  ),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(S.x4, 0, S.x4, S.x3),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(action),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Preview text with the "see more" boundary drawn where LinkedIn cuts.
class _FoldedPreview extends StatelessWidget {
  const _FoldedPreview(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    if (text.length <= kFoldChars) return Text(text, style: T.body);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text.substring(0, kFoldChars), style: T.body),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: S.x3),
          child: Row(
            children: [
              const Expanded(child: Divider(color: C.borderStrong, height: 1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: S.x2),
                child: Text('see more', style: T.xs.copyWith(letterSpacing: 0.5)),
              ),
              const Expanded(child: Divider(color: C.borderStrong, height: 1)),
            ],
          ),
        ),
        Text(text.substring(kFoldChars), style: T.body.copyWith(color: C.textDim)),
      ],
    );
  }
}

/// Hashtag editor. Capped by the voice config, because that same cap is
/// applied again server-side at assembly time — letting the user add five
/// when their style allows two would silently drop three.
class _Hashtags extends StatelessWidget {
  const _Hashtags({
    required this.tags,
    required this.cap,
    required this.controller,
    required this.busy,
    required this.onAdd,
    required this.onRemove,
  });

  final List<String> tags;
  final int cap;
  final TextEditingController controller;
  final bool busy;
  final VoidCallback onAdd;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    final full = tags.length >= cap;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('HASHTAGS (${tags.length}/$cap)', style: T.fieldLabel),
        const SizedBox(height: S.x2),
        if (tags.isNotEmpty)
          Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            children: [
              for (final tag in tags)
                InputChip(
                  label: Text('#$tag'),
                  onDeleted: busy ? null : () => onRemove(tag),
                  backgroundColor: C.surface2,
                  side: const BorderSide(color: C.borderStrong),
                  labelStyle: const TextStyle(color: C.draft, fontSize: 14),
                  deleteIconColor: C.textFaint,
                ),
            ],
          ),
        if (!full) ...[
          const SizedBox(height: S.x2),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  enabled: !busy,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => onAdd(),
                  decoration: const InputDecoration(hintText: 'MusicTech'),
                ),
              ),
              const SizedBox(width: S.x2),
              OutlinedButton(onPressed: busy ? null : onAdd, child: const Text('Add')),
            ],
          ),
        ],
      ],
    );
  }
}

/// A proposed rewrite, shown beside the current text rather than replacing it.
class _VariantPanel extends StatelessWidget {
  const _VariantPanel({
    required this.text,
    required this.busy,
    required this.onAccept,
    required this.onDismiss,
    required this.onAnother,
  });

  final String text;
  final bool busy;
  final VoidCallback onAccept;
  final VoidCallback onDismiss;
  final VoidCallback? onAnother;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: C.surface2,
        border: Border.all(color: C.draft.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Badge2('SUGGESTED', tone: BadgeTone.live),
              const Spacer(),
              Text('${text.length} chars', style: T.xs),
            ],
          ),
          const SizedBox(height: S.x2),
          const Text('Not saved. Replace your text with this?', style: T.xs),
          const SizedBox(height: S.x3),
          Text(text, style: T.body),
          const SizedBox(height: S.x4),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: busy ? null : onAccept,
                  child: const Text('Use this'),
                ),
              ),
              const SizedBox(width: S.x2),
              Expanded(
                child: OutlinedButton(
                  onPressed: onAnother,
                  child: const Text('Another'),
                ),
              ),
            ],
          ),
          const SizedBox(height: S.x2),
          TextButton(onPressed: busy ? null : onDismiss, child: const Text('Discard suggestion')),
        ],
      ),
    );
  }
}

class _Attachments extends StatelessWidget {
  const _Attachments({
    required this.pending,
    required this.existingCount,
    required this.busy,
    required this.onAdd,
    required this.onRemove,
    required this.onClearExisting,
  });

  final List<XFile> pending;
  final int existingCount;
  final bool busy;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final VoidCallback onClearExisting;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('IMAGES', style: T.fieldLabel),
            const Spacer(),
            if (existingCount > 0)
              Flexible(
                child: TextButton(
                  onPressed: busy ? null : onClearExisting,
                  child: Text('Remove $existingCount attached', overflow: TextOverflow.ellipsis),
                ),
              ),
          ],
        ),
        const SizedBox(height: S.x2),
        SizedBox(
          height: 84,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (var i = 0; i < pending.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: S.x2),
                  child: Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(R.sm),
                        child: Image.file(
                          File(pending[i].path),
                          width: 84,
                          height: 84,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            width: 84,
                            height: 84,
                            color: C.surface3,
                            child: const Icon(Icons.broken_image_outlined, color: C.textFaint),
                          ),
                        ),
                      ),
                      Positioned(
                        top: 0,
                        right: 0,
                        child: GestureDetector(
                          onTap: busy ? null : () => onRemove(i),
                          child: Container(
                            padding: const EdgeInsets.all(2),
                            decoration: const BoxDecoration(
                              color: C.bg,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.close, size: 16, color: C.alarm),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              // Add tile, sized to the same 44px-plus touch target as everything else.
              InkWell(
                onTap: busy ? null : onAdd,
                borderRadius: BorderRadius.circular(R.sm),
                child: Container(
                  width: 84,
                  height: 84,
                  decoration: BoxDecoration(
                    border: Border.all(color: C.borderStrong),
                    borderRadius: BorderRadius.circular(R.sm),
                  ),
                  child: const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined, color: C.textDim),
                      SizedBox(height: 2),
                      Text('Add', style: T.xs),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.tone,
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  final BadgeTone tone;
  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      BadgeTone.alarm => C.alarm,
      BadgeTone.warn => C.attention,
      BadgeTone.good => C.good,
      BadgeTone.live => C.live,
      BadgeTone.neutral => C.textFaint,
    };
    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: S.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontSize: 14, color: color, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(body, style: T.xs),
              ],
            ),
          ),
          if (actionLabel != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ),
    );
  }
}
