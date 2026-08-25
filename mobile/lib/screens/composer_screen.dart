/// Write a new post, or edit a drafted one.
///
/// A FULL-SCREEN ROUTE, not a tab. Writing has a beginning and an end; as a tab
/// it was ambient, its half-finished state lived forever in an IndexedStack,
/// and "edit this draft" had to travel through a counter in app state to bring
/// a sibling tab forward. Here it is pushed, it owns the screen while it is
/// open, and closing it asks about unsaved text.
///
/// One screen for both jobs, because they are the same job: getting a piece of
/// text right before it goes out. A separate edit sheet had no attachments, no
/// rewrite and no voice summary — everything the composer already had.
///
/// Four things here are deliberate:
///
///   * Rewriting NEVER overwrites silently. A variant is shown beside the
///     current text and replaces it only when the author says so.
///   * A voice change does not rewrite anything on its own. It raises a banner
///     offering to. Silently regenerating text somebody typed, because they
///     touched a toggle on another screen, would be indefensible.
///   * Rewriting reads the CURRENT voice — every style rule, plus the author's
///     samples and edit notes — because the server builds that prompt fresh on
///     each request. Anything saved on the Voice screen is in effect on the
///     very next press.
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
import '../widgets/draft_card.dart';
import '../widgets/primitives.dart';

/// Mirrors MAX_BODY_CHARS in lib/format.ts.
const int kMaxBodyChars = 2400;

/// Words, counted the same way the server counts them.
///
/// Must stay in step with countWords() in lib/critique.ts — that is the count
/// the writer is repaired against, and a composer that disagreed with it would
/// send the author chasing a number the backend was not enforcing.
int countWords(String text) =>
    text.trim().isEmpty ? 0 : text.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;

/// Guards against a second push. The compose request counter can fire while the
/// composer is already open — tapping "edit" on a card that is already loaded,
/// or a follow-up arriving — and stacking two composers would leave one of them
/// holding an edit lock nobody can release.
bool _composerOpen = false;

/// Open the composer. Loads whatever app state is pointing at: a post to edit,
/// a follow-up to season it with, or nothing at all.
Future<void> openComposer(BuildContext context) async {
  if (_composerOpen) return;
  _composerOpen = true;
  try {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ComposerScreen(), fullscreenDialog: true),
    );
  } finally {
    _composerOpen = false;
  }
}

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

  /// The post being edited, or null when writing something new.
  int? _loadedSeq;

  /// The text this screen opened with, so leaving can tell whether anything
  /// was actually typed.
  String _openedWith = '';

  /// When this post should go out, or null for "not on the timetable". A
  /// hand-written post can be scheduled exactly like a generated one.
  DateTime? _scheduledFor;

  /// The voice at the moment the current text was loaded or generated.
  /// Compared against the live one to decide whether the text is stale.
  String? _voiceAtLoad;

  /// Held rather than looked up.
  ///
  /// [dispose] has to release the edit lock, and by the time it runs this
  /// element is deactivated — `context.read` from there throws "looking up a
  /// deactivated widget's ancestor is unsafe", which took the whole screen down
  /// every time the composer was closed on a draft.
  late final AppState _state;

  bool get _editing => _loadedSeq != null;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));

    final state = context.read<AppState>();
    _state = state;
    _voiceAtLoad = state.styleFingerprint;

    final target = state.editing;
    if (target != null) {
      _loadedSeq = target.seq;
      _text.text = target.text;
      _existingMedia = List.of(target.media);
      _hashtags = List.of(target.hashtags);
      _scheduledFor = target.scheduledFor;
      // Take the edit lock so the scheduled send cannot fire while this is open
      // and publish half a sentence. Time-bounded on the server, so forgetting
      // to release it costs a delay rather than a silenced posting time.
      if (target.isScheduled) state.holdForEditing(target.seq);
    } else {
      // A follow-up arrives as text with no post behind it, and is consumed on
      // the way so it cannot resurrect over something typed later.
      final seed = state.takeComposeSeed();
      if (seed != null) {
        _text.text = seed.text;
        _hashtags = List.of(seed.hashtags);
        _status = 'A follow-up, ready to edit. Not saved yet.';
      }
    }
    _openedWith = _text.text;
  }

  @override
  void dispose() {
    final seq = _loadedSeq;
    if (seq != null) {
      // Release the hold on the way out, or a scheduled post stays blocked
      // until the server expires it.
      _state.releaseEditing(seq);
    }
    _text.dispose();
    _tagInput.dispose();
    super.dispose();
  }

  /// Leaving with typed text asks first. Everything else closes silently.
  Future<bool> _confirmLeave() async {
    if (_busy) return false;
    if (_text.text.trim() == _openedWith.trim()) return true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_editing ? 'Leave without saving?' : 'Discard this post?'),
        content: Text(
          _editing
              ? 'The queued draft keeps its current text.'
              : 'Nothing has been saved yet, and this text is not kept.',
          style: T.small,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep writing')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.flare, foregroundColor: C.paper),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(_editing ? 'Leave' : 'Discard'),
          ),
        ],
      ),
    );
    return ok == true;
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

  Future<void> _pickImages() async {
    try {
      // Downscale at pick time: /api/media caps the body at 4MB and a modern
      // phone photo is several times that.
      final picked =
          await _picker.pickMultiImage(maxWidth: 1920, maxHeight: 1920, imageQuality: 85);
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
      final ids =
          await context.read<AppState>().uploadImages(_pending.map((f) => f.path).toList());
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
    // outright, which quietly deleted tags someone had typed deliberately — the
    // model's opinion about tags is worth less than an explicit choice.
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
            '${kept.length == 1 ? 'hashtag' : 'hashtags'} kept, ${added.length} added. '
            'Not saved yet.',
      };
    });
  }

  /// Show the post exactly as it will be assembled, then confirm.
  ///
  /// Nothing leaves this screen without the author having seen the final text —
  /// body and hashtags together, with the fold where LinkedIn will cut it. The
  /// text box shows the body alone, which is not the same thing: the tags and
  /// the truncation are where posts actually go wrong.
  Future<bool> _previewAndConfirm({required bool publishNow}) async {
    final state = context.read<AppState>();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => _PreviewSheet(
        body: _text.text.trim(),
        hashtags: _hashtags,
        imageCount: _pending.length + _existingMedia.length,
        publishNow: publishNow,
        liveMode: state.status?.liveMode ?? false,
        editing: _editing,
      ),
    );
    return ok == true;
  }

  Future<void> _save({required bool publishNow}) async {
    final state = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
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
      if (error == null) {
        await state.releaseEditing(seq);
        _loadedSeq = null;
      }
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
    });
    if (error != null) return;

    state.stopEditing();
    messenger.showSnackBar(
      SnackBar(
        content: Text(publishNow
            ? 'Published.'
            : seq != null
                ? 'Draft updated.'
                : 'Saved to the desk.'),
      ),
    );
    // The work is done and the result is on the Desk. Staying on a blank
    // composer would leave the author looking at nothing.
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final style = state.style;

    final length = _text.text.trim().length;
    final tooShort = length < 20;
    final tooLong = length > kMaxBodyChars;
    final hookLength = _text.text.split('\n').first.length;

    // The rule the author configured is in WORDS. Every counter here used to be
    // in characters, so the one number they had actually set was the one number
    // the screen never showed — a post could sit at a fifth of the required
    // length with nothing on screen disagreeing.
    final words = countWords(_text.text);
    final wordsOff = words > 0 && (words < style.minWords || words > style.maxWords);
    final canSend = !_busy && !tooShort && !tooLong;

    // Compared against the FULL voice, not style.summary. That summary names
    // the structure, the emoji policy and the tag count and nothing else, so
    // changing the register, the hook, the length or a custom rule left this
    // banner silent — the voice really had moved on and the composer said
    // nothing about it.
    final voiceStale =
        _voiceAtLoad != null && _voiceAtLoad != state.styleFingerprint && length > 0;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        // Captured before the dialog: the lint cannot see that this closure's
        // context and the State's are the same one.
        final navigator = Navigator.of(context);
        if (await _confirmLeave() && mounted) navigator.pop();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'Close',
            onPressed: _busy
                ? null
                : () async {
                    final navigator = Navigator.of(context);
                    if (await _confirmLeave() && mounted) navigator.pop();
                  },
          ),
          title: Text(_editing ? 'Editing ${state.editing?.id ?? ''}' : 'Write'),
          actions: [
            if (_busy)
              const Padding(
                padding: EdgeInsets.only(right: S.x4),
                child: Center(
                  child: SizedBox(
                    height: 17,
                    width: 17,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(S.x4, S.x2, S.x4, S.x5),
            children: [
              if (voiceStale) ...[
                Notice(
                  tone: Tone.desk,
                  icon: Icons.tune,
                  title: 'Your voice changed',
                  body: 'This text was written under the old settings — ${style.summary}.',
                  actionLabel: 'Rewrite',
                  onAction: _busy || tooShort ? null : _rewrite,
                ),
                const SizedBox(height: S.x4),
              ],

              // The page IS the text field. No panel around it, nothing
              // competing: this is the one thing the screen is for.
              TextField(
                // Keyed so a test can reach the body field by name. Without it
                // the only handle is `find.byType(TextField).first`, which
                // silently becomes the hashtag input once the page is scrolled
                // far enough to unmount this one.
                key: const Key('composer-body'),
                controller: _text,
                maxLines: null,
                minLines: 10,
                autofocus: !_editing,
                style: T.copy,
                enabled: !_busy,
                decoration: const InputDecoration(
                  hintText: 'What happened, what you learned, what you disagree with.',
                  border: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  filled: false,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              const SizedBox(height: S.x4),

              // One compact line of meters. Words first: it is the rule the
              // author set and the one the writer is held to. Characters matter
              // only near LinkedIn's ceiling, which ordinary posts never reach.
              Wrap(
                spacing: S.x2,
                runSpacing: S.x2,
                children: [
                  Slug(
                    '$words / ${style.minWords}–${style.maxWords} words',
                    tone: words == 0 ? Tone.quiet : (wordsOff ? Tone.desk : Tone.out),
                  ),
                  if (length > 0)
                    Slug(
                      'hook $hookLength / $kFoldChars',
                      tone: hookLength > kFoldChars ? Tone.desk : Tone.out,
                    ),
                  if (tooLong || length > kMaxBodyChars - 400)
                    Slug('$length / $kMaxBodyChars', tone: tooLong ? Tone.broken : Tone.quiet),
                ],
              ),
              const SizedBox(height: S.x5),

              if (style.hashtagCount > 0) ...[
                _Hashtags(
                  tags: _hashtags,
                  cap: style.hashtagCount,
                  controller: _tagInput,
                  busy: _busy,
                  onAdd: () => _addTag(style.hashtagCount),
                  onRemove: (tag) => setState(() => _hashtags = [..._hashtags]..remove(tag)),
                ),
                const SizedBox(height: S.x5),
              ],

              _Attachments(
                pending: _pending,
                existingCount: _existingMedia.length,
                busy: _busy,
                onAdd: _pickImages,
                onRemove: (i) => setState(() => _pending.removeAt(i)),
                onClearExisting: () => setState(() => _existingMedia = []),
              ),
              const SizedBox(height: S.x5),

              if (!_editing) ...[
                const SectionRule('Before it goes out'),
                SwitchRow(
                  title: 'Polish in your voice',
                  blurb: 'Tightens the hook and applies your style rules. Never invents facts.',
                  value: _polish,
                  onChanged: _busy ? null : (v) => setState(() => _polish = v),
                ),
                const SizedBox(height: S.x3),
              ],

              // Available while writing something new too, not only when
              // editing a saved draft — a second opinion is most useful before
              // the text has been committed to anything.
              OutlinedButton.icon(
                onPressed: _busy || tooShort ? null : _rewrite,
                icon: const Icon(Icons.auto_awesome_outlined, size: 17),
                label: Text(_variant == null ? 'Rewrite with AI' : 'Try another version'),
              ),
              if (tooShort && length > 0)
                const Padding(
                  padding: EdgeInsets.only(top: S.x2),
                  child: Text('Write at least 20 characters to rewrite.', style: T.micro),
                ),

              if (_status != null)
                Padding(
                  padding: const EdgeInsets.only(top: S.x3),
                  child: Text(_status!, style: T.micro.copyWith(color: C.daylight)),
                ),
              if (_error != null) ErrorNote(_error!),

              if (_variant != null) ...[
                const SizedBox(height: S.x5),
                _Variant(
                  text: _variant!,
                  busy: _busy,
                  onAccept: _acceptVariant,
                  onDismiss: () => setState(() => _variant = null),
                  onAnother: _busy ? null : _rewrite,
                ),
              ],
            ],
          ),
        ),
        // Pinned, so the commit never scrolls away under the text it applies to.
        bottomNavigationBar: _CommitBar(
          editing: _editing,
          canSend: canSend,
          connected: state.status?.account.usable ?? false,
          onSave: () => _save(publishNow: false),
          onPublish: () => _save(publishNow: true),
        ),
      ),
    );
  }
}

/// Save and publish, pinned to the bottom.
class _CommitBar extends StatelessWidget {
  const _CommitBar({
    required this.editing,
    required this.canSend,
    required this.connected,
    required this.onSave,
    required this.onPublish,
  });

  final bool editing;
  final bool canSend;
  final bool connected;
  final VoidCallback onSave;
  final VoidCallback onPublish;

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
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        onPressed: canSend ? onSave : null,
                        child: Text(editing ? 'Save changes' : 'Save to the desk'),
                      ),
                    ),
                    const SizedBox(width: S.x2),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: canSend && connected ? onPublish : null,
                        child: const Text('Publish now'),
                      ),
                    ),
                  ],
                ),
                if (!connected)
                  const Padding(
                    padding: EdgeInsets.only(top: S.x2),
                    child: Text('Connect LinkedIn to publish directly.', style: T.micro),
                  ),
              ],
            ),
          ),
        ),
      );
}

/// The post exactly as it will be sent: body and hashtags assembled, with the
/// fold in place.
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
            : 'Save to the desk';

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
            decoration: BoxDecoration(
              color: C.ruleStrong,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(S.x4, S.x3, S.x2, 0),
            child: Row(
              children: [
                // Expanded rather than Spacer: at 360pt the label and the Back
                // button together overflowed the sheet by 19 pixels.
                Expanded(
                  child: Text(
                    'THIS IS WHAT GOES OUT',
                    style: T.slug,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
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
              padding: const EdgeInsets.fromLTRB(S.x4, S.x3, S.x4, S.x4),
              children: [
                FoldedCopy(text),
                const SizedBox(height: S.x5),
                Wrap(
                  spacing: S.x2,
                  runSpacing: S.x2,
                  children: [
                    Slug('${text.length} chars',
                        tone: text.length > kMaxBodyChars ? Tone.broken : Tone.quiet),
                    Slug(hashtags.isEmpty ? 'no tags' : '${hashtags.length} tags'),
                    if (imageCount > 0)
                      Slug('$imageCount image${imageCount == 1 ? '' : 's'}'),
                    if (publishNow)
                      Slug(liveMode ? 'live' : 'dry run',
                          tone: liveMode ? Tone.out : Tone.desk),
                  ],
                ),
                if (publishNow) ...[
                  const SizedBox(height: S.x3),
                  Text(
                    liveMode
                        ? 'This posts to your profile now. It cannot be unpublished from here.'
                        : 'Live mode is off, so nothing will actually reach LinkedIn.',
                    style: T.micro,
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

/// Hashtag editor. Capped by the voice config, because that same cap is applied
/// again server-side at assembly time — letting the author add five when their
/// style allows two would silently drop three.
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
        SectionRule(
          'Hashtags',
          trailing: Text('${tags.length} / $cap', style: T.data.copyWith(fontSize: 12.5)),
        ),
        if (tags.isNotEmpty)
          Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            children: [
              for (final tag in tags)
                InputChip(
                  label: Text('#$tag'),
                  onDeleted: busy ? null : () => onRemove(tag),
                  backgroundColor: C.ink2,
                  side: const BorderSide(color: C.ruleStrong),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
                  labelStyle: T.body.copyWith(color: C.daylight),
                  deleteIconColor: C.paperFaint,
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
class _Variant extends StatelessWidget {
  const _Variant({
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
  Widget build(BuildContext context) => ObjectCard(
        tone: Tone.desk,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Slug('suggested', tone: Tone.desk),
                const Spacer(),
                Text('${text.length} chars', style: T.mono),
              ],
            ),
            const SizedBox(height: S.x2),
            Text('Not saved. Replace your text with this?', style: T.micro),
            const SizedBox(height: S.x4),
            Text(text, style: T.copy),
            const SizedBox(height: S.x5),
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
            const SizedBox(height: S.x1),
            Center(
              child: TextButton(
                onPressed: busy ? null : onDismiss,
                child: const Text('Discard suggestion'),
              ),
            ),
          ],
        ),
      );
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
        SectionRule(
          'Images',
          trailing: existingCount > 0
              ? TextButton(
                  onPressed: busy ? null : onClearExisting,
                  style: TextButton.styleFrom(
                    minimumSize: const Size(0, 32),
                    padding: const EdgeInsets.symmetric(horizontal: S.x2),
                  ),
                  child: Text('Remove $existingCount attached',
                      overflow: TextOverflow.ellipsis),
                )
              : null,
        ),
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
                            color: C.ink3,
                            child: const Icon(Icons.broken_image_outlined, color: C.paperFaint),
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
                              color: C.ink,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.close, size: 15, color: C.flare),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              InkWell(
                onTap: busy ? null : onAdd,
                borderRadius: BorderRadius.circular(R.sm),
                child: Container(
                  width: 84,
                  height: 84,
                  decoration: BoxDecoration(
                    border: Border.all(color: C.ruleStrong),
                    borderRadius: BorderRadius.circular(R.sm),
                  ),
                  child: const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined, color: C.paperDim),
                      SizedBox(height: 2),
                      Text('Add', style: T.micro),
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
