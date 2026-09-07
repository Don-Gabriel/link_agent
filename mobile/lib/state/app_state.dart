/// Single app-wide store.
///
/// One ChangeNotifier is the right size here: the backend hands back the entire
/// dashboard in one GET /api/status, so there is exactly one server truth to
/// hold and every mutation ends by re-fetching it. Splitting that into per-
/// screen stores would create the possibility of two screens disagreeing, which
/// is precisely the bug class an approval queue must not have.
library;

import '../auth_return.dart';
import 'dart:async' show unawaited;

import 'package:flutter/foundation.dart' show ChangeNotifier, debugPrint;

import '../api/client.dart';
import '../push.dart' show stopPush;
import '../api/models.dart';

enum AuthPhase { unknown, signedOut, signedIn }

class AppState extends ChangeNotifier {
  AppState(this._api);

  final ApiClient _api;
  ApiClient get api => _api;

  AuthPhase phase = AuthPhase.unknown;
  AppStatus? status;
  Map<String, dynamic>? reviewDelivery;

  /// Set while a full refresh is in flight, so screens can show a spinner
  /// without every button needing its own flag.
  bool loading = false;
  int _refreshRevision = 0;

  /// The last error worth showing at the top of a screen. Cleared on success.
  String? error;

  /// The draft the composer is editing, or null when composing something new.
  /// Lives here rather than in the composer because the queue is what starts
  /// an edit, and the two screens are siblings in a tab shell.
  Post? editing;

  /// Bumped whenever the composer should jump to the front. The home shell
  /// watches this rather than the editing target itself, so "edit this again"
  /// still switches tabs when the same post is already loaded.
  int composeRequest = 0;

  /// Text waiting to be dropped into an EMPTY composer, and the tags with it.
  ///
  /// Distinct from [editing], which loads an existing post to change. This is a
  /// suggestion for something new — currently only a follow-up — and it is
  /// consumed once: the composer takes it, clears it, and it never reappears if
  /// the user navigates away and back.
  String? composeSeed;
  List<String> composeSeedHashtags = const [];

  /// Take the pending seed, if any, and forget it.
  ({String text, List<String> hashtags})? takeComposeSeed() {
    final text = composeSeed;
    if (text == null) return null;
    final tags = composeSeedHashtags;
    composeSeed = null;
    composeSeedHashtags = const [];
    return (text: text, hashtags: tags);
  }

  /// A tab a notification asked for, and a counter so the same tab twice still
  /// registers. Same shape as [composeRequest] and for the same reason: the
  /// shell has to be able to tell "asked again" from "asked once".
  int tabRequest = 0;
  int requestedTab = 0;

  /// Bring a tab forward. Called when a notification is tapped.
  void requestTab(int index) {
    requestedTab = index;
    tabRequest++;
    notifyListeners();
  }

  void startEditing(Post post) {
    editing = post;
    composeRequest++;
    notifyListeners();
  }

  void stopEditing() {
    if (editing == null) return;
    editing = null;
    notifyListeners();
  }

  String get baseUrl => _api.baseUrl;
  Agent? get agent => status?.agent;
  StyleConfig get style => agent?.style ?? StyleConfig.houseStyle;

  /// Everything that shapes how the writer sounds, as one comparable string.
  ///
  /// For change DETECTION, never for display. The composer used to watch
  /// [StyleConfig.summary], which names the structure, the emoji policy and the
  /// tag count — three fields out of a prompt built from every style rule plus
  /// the author's writing samples and edit notes. Editing the register, the
  /// length, a banned phrase or a sample moved the real voice and left the
  /// composer's "voice changed" banner silent.
  String get styleFingerprint {
    final a = agent;
    if (a == null) return '';
    return [
      a.style.toJson().toString(),
      a.corpus.join(String.fromCharCode(0)),
      a.editNotes ?? '',
    ].join('|');
  }

  /// How many drafts are asking for a DECISION right now.
  ///
  /// Not how many drafts exist. A cleared draft is still in the queue but has
  /// stopped asking anything of you, and a badge that never clears is a badge
  /// people learn to ignore.
  int get onTheDesk {
    final s = status;
    if (s == null) return 0;
    return s.queue
        .where((p) => !p.isCleared && (p.isDraft || p.status == 'approved'))
        .length;
  }

  /// Something in the machinery needs a human — the scheduler has stopped, or
  /// LinkedIn access is expiring or gone. Deliberately excludes drafts: those
  /// are the job, not a fault.
  bool get needsAttention {
    final s = status;
    if (s == null) return false;
    return !s.scheduler.healthy ||
        s.account.needsReauth ||
        s.account.expiringSoon;
  }

  Future<void> bootstrap() async {
    phase = _api.hasSession ? AuthPhase.signedIn : AuthPhase.signedOut;
    notifyListeners();
    if (phase == AuthPhase.signedIn) await refresh();
  }

  Future<void> setBaseUrl(String value) async {
    await _api.setBaseUrl(value);
    notifyListeners();
  }

  Future<bool> signIn(String password) async {
    error = null;
    loading = true;
    notifyListeners();
    try {
      await _api.logIn(password);
      phase = AuthPhase.signedIn;
      loading = false;
      notifyListeners();
      await refresh();
      return true;
    } on ApiException catch (e) {
      error = e.error == 'invalid_password' ? 'Wrong password.' : e.toString();
      loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> signOut() async {
    _refreshRevision++;
    phase = AuthPhase.signedOut;
    await stopPush();
    if (_deviceToken != null) {
      try {
        await _api.delete(
          '/api/devices?token=${Uri.encodeComponent(_deviceToken!)}',
        );
      } catch (_) {}
    }
    _deviceToken = null;
    editing = null;
    composeSeed = null;
    composeSeedHashtags = const [];
    _draftWatch++;
    await _api.logOut();
    phase = AuthPhase.signedOut;
    status = null;
    reviewDelivery = null;
    error = null;
    notifyListeners();
  }

  /// Re-read everything from the server.
  ///
  /// [quiet] skips the loading flag. A background poll must not disable every
  /// control on screen every fifteen seconds — the spinner is for refreshes the
  /// user asked for and is waiting on.
  Future<void> refresh({bool quiet = false}) async {
    final revision = ++_refreshRevision;
    if (!quiet) {
      loading = true;
      notifyListeners();
    }
    try {
      final json = await _api.get('/api/status');
      if (revision != _refreshRevision) return;
      status = AppStatus.fromJson(json as Map<String, dynamic>);
      reviewDelivery = json['reviewDelivery'] is Map
          ? Map<String, dynamic>.from(json['reviewDelivery'] as Map)
          : null;
      error = null;
    } on ApiException catch (e) {
      if (revision != _refreshRevision) return;
      // An expired or rejected cookie must drop us back to the gate rather than
      // leaving a signed-in shell that fails on every tap.
      if (e.isUnauthorized) {
        _draftWatch++;
        await stopPush();
        await _api.clearSession();
        phase = AuthPhase.signedOut;
        status = null;
        reviewDelivery = null;
        editing = null;
        composeSeed = null;
        composeSeedHashtags = const [];
      }
      error = e.toString();
    }
    loading = false;
    notifyListeners();
  }

  /// Watch for the draft a cycle is about to produce.
  ///
  /// A cycle answers in about a second and then works for another 30-60 in the
  /// background, so the refresh that [mutate] already did cannot possibly show
  /// the result — the draft does not exist yet. Without this the queue stays
  /// empty until the user thinks to pull down, which reads as the button
  /// having done nothing.
  ///
  /// A push notification also triggers a refresh the moment the draft lands,
  /// and is faster than any of these. This is the fallback for the phone that
  /// refused notification permission, and for the case where the cycle finds
  /// nothing worth writing — where no notification is sent at all, correctly,
  /// and the app should still stop looking busy.
  int _draftWatch = 0;
  Future<void> _watchForDraft(int before) async {
    final watch = ++_draftWatch;
    // Spaced out rather than fixed: a cycle is two LLM calls and finishes
    // anywhere in a wide window, so this checks often early and backs off.
    for (final seconds in const [12, 12, 15, 15, 20, 25, 30]) {
      await Future<void>.delayed(Duration(seconds: seconds));
      // Superseded by a newer run, or signed out in the meantime.
      if (watch != _draftWatch || phase != AuthPhase.signedIn) return;
      await refresh(quiet: true);
      if ((status?.queue.length ?? 0) > before) return;
    }
  }

  /// Run a mutation, surface its error, and re-sync from the server.
  ///
  /// Returns null on success or the error string on failure, so callers can
  /// decide between a snackbar and inline text without re-reading [error].
  ///
  /// Use [mutateAgent] instead for anything that only changes agent settings —
  /// this one pays for a full status refetch, which is the right price for a
  /// mutation that moves posts or slots and far too much for a toggle.
  Future<String?> mutate(Future<void> Function() action) async {
    _refreshRevision++;
    loading = true;
    notifyListeners();
    try {
      await action();
    } on ApiException catch (e) {
      // A rejected send can still change the post to failed/unknown. Refresh
      // that result so the screen offers recovery for the actual saved state.
      await refresh(quiet: true);
      loading = false;
      error = e.toString();
      notifyListeners();
      return e.toString();
    }
    await refresh();
    return null;
  }

  /// A settings change that only touches the agent, applied from the response.
  ///
  /// PATCH /api/settings already answers with the updated agent, so re-fetching
  /// the whole dashboard afterwards asked a database on another continent to
  /// rebuild the queue, the history, the rejection log, the slot timeline and
  /// the LLM budget — none of which the change could have altered. Every toggle
  /// cost two sequential round trips at roughly half a second each, with the
  /// entire UI disabled in between. This costs one, and the second is the one
  /// that was pure waste.
  ///
  /// Anything that moves the schedule (timezone, post time) still goes through
  /// [mutate]: the server recomputes every slot's next occurrence, and those
  /// live outside the agent object.
  Future<String?> mutateAgent(Future<dynamic> Function() action) async {
    _refreshRevision++;
    loading = true;
    notifyListeners();
    try {
      final json = await action();
      final updated = json is Map<String, dynamic>
          ? json['agent'] as Map<String, dynamic>?
          : null;
      if (updated != null && status != null) {
        _refreshRevision++;
        status = status!.withAgent(Agent.fromJson(updated));
        error = null;
        loading = false;
        notifyListeners();
        return null;
      }
    } on ApiException catch (e) {
      loading = false;
      error = e.toString();
      notifyListeners();
      return e.toString();
    }
    // The server answered without an agent — an older build, or a shape we do
    // not recognise. Fall back to the full refetch rather than showing state
    // that might now be wrong.
    await refresh();
    return null;
  }

  // ---------------------------------------------------------------- actions
  //
  // These all take mutateAgent: PATCH /api/settings returns the updated agent,
  // and nothing else on the dashboard is derived from these fields. setPostTime
  // and setTimezone are the exceptions and stay on mutate — they reschedule
  // every slot, which lives outside the agent object.

  Future<String?> setStyle(StyleConfig style) =>
      mutateAgent(() => _api.patch('/api/settings', {'style': style.toJson()}));

  Future<String?> applyPreset(String presetId) =>
      mutateAgent(() => _api.patch('/api/settings', {'preset': presetId}));

  Future<String?> setAutoPublish(bool value) =>
      mutateAgent(() => _api.patch('/api/settings', {'autoPublish': value}));

  Future<String?> setPaused(bool value) =>
      mutateAgent(() => _api.patch('/api/settings', {'paused': value}));

  /// How many posts the agent may publish by itself per rolling 24h (1-3).
  Future<String?> setAutoPublishCap(int value) =>
      mutateAgent(() => _api.patch('/api/settings', {'autoPublishCap': value}));

  /// "HH:MM" in the agent's timezone. Changing it reschedules the next run —
  /// and because nextDailyRun is strictly future, setting today's time after
  /// it has passed moves the run to tomorrow.
  Future<String?> setPostTime(String hhmm) =>
      mutate(() => _api.patch('/api/settings', {'postTimeLocal': hhmm}));

  Future<String?> setTimezone(String tz) =>
      mutate(() => _api.patch('/api/settings', {'timezone': tz}));

  /// Toggle a category, applied on screen before the server has answered.
  ///
  /// A chip tap is the most-repeated interaction in the app and it changes one
  /// list on one object, so waiting half a second with every chip disabled to
  /// find out whether it worked is the wrong trade. The new selection is shown
  /// at once and the server's answer overwrites it a moment later; if the
  /// request fails the previous selection is restored and the error surfaces,
  /// so a rejected change can never be left looking accepted.
  ///
  /// Deliberately does NOT set [loading] — that disables every control on the
  /// screen, which is exactly the freeze this is removing.
  Future<String?> setCategories(List<String> categories) async {
    // Nothing blocks a second tap while the first is in flight, so two replies
    // can land out of order and the older one would win. Only the newest
    // request is allowed to write the server's answer back.
    final mySeq = ++_categoriesSeq;
    final previous = status?.agent;
    if (previous != null && status != null) {
      status = status!.withAgent(previous.withCategories(categories));
      error = null;
      notifyListeners();
    }
    try {
      final json = await _api.patch('/api/settings', {
        'categories': categories,
      });
      if (mySeq != _categoriesSeq) {
        return null; // a newer tap already owns the state
      }
      final updated = json is Map<String, dynamic>
          ? json['agent'] as Map<String, dynamic>?
          : null;
      if (updated != null && status != null) {
        // The server is the authority on what was actually stored: it refuses
        // to leave the agent with no categories, and it rewrites the scope line
        // to match. Taking its answer keeps the header honest.
        status = status!.withAgent(Agent.fromJson(updated));
      } else {
        await refresh();
      }
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      // Only roll back if nothing newer has been sent — otherwise this would
      // undo a selection the user has since made and the server has accepted.
      if (mySeq == _categoriesSeq && previous != null && status != null) {
        status = status!.withAgent(previous);
      }
      error = e.toString();
      notifyListeners();
      return e.toString();
    }
  }

  int _categoriesSeq = 0;

  /// Attach this phone to the agent, so the server can push to it.
  ///
  /// Called on every launch, not only the first: FCM rotates tokens whenever it
  /// likes and tells no one, so re-registering is the only way the server's
  /// address stays current. The endpoint upserts, which is what makes that
  /// cheap. Failure is deliberately quiet — an app that cannot register for
  /// notifications is still a working control surface, and saying so on the
  /// gate screen would be alarming out of all proportion.
  String? _deviceToken;
  Future<String?> testDeviceNotification() async {
    if (_deviceToken == null) {
      return 'Enable notifications on this device first.';
    }
    return mutate(
      () =>
          _api.post('/api/devices', {'action': 'test', 'token': _deviceToken}),
    );
  }

  Future<bool> registerDevice(String token) async {
    if (phase != AuthPhase.signedIn) return false;
    try {
      final result = await _api.post('/api/devices', {
        'token': token,
        'platform': 'android',
      });
      _deviceToken = token;
      return (result as Map)['configured'] == true;
    } on ApiException catch (e) {
      debugPrint('[state] could not register for notifications: $e');
      return false;
    }
  }

  /// Ask the writer for a follow-up to a post that has already gone out, and
  /// carry it to the composer.
  ///
  /// Nothing is saved: the endpoint answers with text and never writes a row,
  /// so this is a suggestion about what to write next rather than a post
  /// created on the author's behalf. Leaving edit mode first matters — a
  /// follow-up is a NEW post, and arriving in a composer still bound to the
  /// original would silently overwrite the thing being followed up.
  Future<String?> followUp(int seq) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final json = await _api.patch('/api/posts/$seq', {
        'action': 'followup',
      }, timeout: kWriterTimeout);
      final map = json as Map<String, dynamic>?;
      final text = map?['text'];
      if (text is! String || text.trim().isEmpty) {
        loading = false;
        notifyListeners();
        return 'The writer returned nothing usable.';
      }
      final tags = map?['hashtags'];
      editing = null;
      composeSeed = text;
      composeSeedHashtags = tags is List
          ? tags.whereType<String>().toList()
          : const [];
      composeRequest++; // brings the composer forward
      loading = false;
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      loading = false;
      error = e.toString();
      notifyListeners();
      return e.toString();
    }
  }

  // -------------------------------------------------------------- LinkedIn

  /// Ask the server for LinkedIn's consent URL.
  ///
  /// `?json=1` because the browser-facing route answers with a 302, which this
  /// client must not follow: consent has to happen in the SYSTEM browser, not
  /// inside the app's HTTP stack.
  Future<String?> linkedInConsentUrl() async {
    try {
      final returnUri = await prepareDesktopAuthReturn(
        onReturn: () => refresh(quiet: true),
      );
      final suffix = returnUri == null
          ? ''
          : '&returnUri=${Uri.encodeComponent(returnUri)}';
      final res = await _api.get('/api/linkedin/connect?json=1$suffix');
      final url = (res as Map)['url'];
      return url is String && url.isNotEmpty ? url : null;
    } on ApiException catch (e) {
      debugPrint('[state] could not get a consent URL: $e');
      return null;
    }
  }

  Future<String?> disconnectLinkedIn() =>
      mutate(() => _api.post('/api/linkedin/disconnect', const {}));

  /// Writing samples the writer studies before drafting.
  ///
  /// Replaced wholesale rather than appended: the corpus is a set the author
  /// edits, and a merge would make removing a sample impossible. The server
  /// drops anything under 80 characters, so a stray paste cannot become a
  /// "sample" that teaches the model nothing.
  List<String> get corpus => agent?.corpus ?? const [];

  Future<String?> setCorpus(List<String> samples) =>
      mutateAgent(() => _api.patch('/api/settings', {'corpus': samples}));

  Future<String?> addCorpusSample(String text) =>
      setCorpus([...corpus, text.trim()]);

  Future<String?> removeCorpusSample(int index) {
    if (index < 0 || index >= corpus.length) return Future.value(null);
    final next = [...corpus]..removeAt(index);
    return setCorpus(next);
  }

  /// Force a cycle now, ignoring the schedule.
  ///
  /// Session-authenticated, unlike /api/cron/tick which needs the cron secret
  /// the app deliberately does not hold. Returns as soon as the work is
  /// started — the draft appears on a later refresh, 30-60s out.
  Future<String?> runCycleNow() async {
    final before = status?.queue.length ?? 0;
    final error = await mutate(() => _api.post('/api/cycle/run', const {}));
    if (error != null) return error;
    // Deliberately not awaited: the button returns now, and the queue fills in
    // by itself when the writer is done.
    unawaited(_watchForDraft(before));
    return null;
  }

  // PATCH, not POST: /api/posts/[seq] exports PATCH and answers anything else
  // with a 405. Only /api/posts (compose) is a POST.

  /// "I have read this — let it go out at its scheduled time."
  ///
  /// The primary action on a scheduled draft, and deliberately NOT the same
  /// thing as publishing. Before slots existed, approving a draft sent it
  /// immediately; that is the wrong default once a post has a time of its own,
  /// because clearing something at 08:48 should not publish it at 08:48.
  Future<String?> clear(int seq, {Post? reviewed}) => mutate(
    () => _api.patch('/api/posts/$seq', {
      'action': 'clear',
      if (reviewed != null)
        'reviewed': {
          'text': reviewed.text,
          'hashtags': reviewed.hashtags,
          'media': reviewed.media,
        },
    }),
  );

  /// Withdraw clearance. On a hold-mode slot this is enough to stop the send.
  Future<String?> unclear(int seq) =>
      mutate(() => _api.patch('/api/posts/$seq', {'action': 'unclear'}));

  /// Send right now, ignoring the schedule. The override, not the default.
  Future<String?> sendNow(int seq, {Post? reviewed}) => mutate(
    () => _api.patch('/api/posts/$seq', {
      'action': 'publish',
      if (reviewed != null)
        'reviewed': {
          'text': reviewed.text,
          'hashtags': reviewed.hashtags,
          'media': reviewed.media,
        },
    }),
  );

  /// Move a post to a different time, or lift it off the schedule with null.
  Future<String?> reschedule(int seq, DateTime? when) => mutate(
    () => _api.patch('/api/posts/$seq', {
      'action': 'reschedule',
      'scheduledFor': when?.toUtc().toIso8601String(),
    }),
  );

  /// Take the composer's edit lock so a scheduled send cannot fire mid-edit.
  ///
  /// Failure is swallowed on purpose: the hold is a courtesy, and refusing to
  /// let someone open a draft because a lock call failed would be worse than
  /// the race it prevents. The server expires holds on its own, so the cost of
  /// a missed release is bounded.
  Future<void> holdForEditing(int seq) async {
    try {
      await _api.patch('/api/posts/$seq', {'action': 'hold'});
    } on ApiException catch (e) {
      debugPrint('[state] could not hold p$seq for editing: $e');
    }
  }

  Future<void> releaseEditing(int seq) async {
    try {
      await _api.patch('/api/posts/$seq', {'action': 'release'});
    } on ApiException catch (e) {
      debugPrint('[state] could not release p$seq: $e');
    }
  }

  Future<String?> discard(int seq) =>
      mutate(() => _api.patch('/api/posts/$seq', {'action': 'discard'}));

  Future<String?> editPost(
    int seq,
    String text,
    List<String> hashtags, {
    List<String>? mediaIds,
  }) => mutate(
    () => _api.patch('/api/posts/$seq', {
      'action': 'edit',
      'text': text,
      'hashtags': hashtags,
      // Omitted entirely when null: the server treats an absent key as
      // "leave the existing images alone".
      'mediaIds': ?mediaIds,
    }),
  );

  /// Ask the writer for a different treatment of a draft. Returns the variant
  /// text; nothing is saved until the user accepts it with [editPost].
  ///
  /// [variant] cycles the angle the writer is told to take, so pressing the
  /// button repeatedly gives genuinely different options rather than the same
  /// rephrasing each time.
  Future<String> rewriteDraft(int seq, {int variant = 0}) => _readVariant(
    _api.patch('/api/posts/$seq', {
      'action': 'rewrite',
      'variant': variant,
    }, timeout: kWriterTimeout),
  );

  /// Same, for text that has not been saved yet — the composer writing
  /// something new has no seq to reference.
  Future<String> rewriteText(String text, {int variant = 0}) => _readVariant(
    _api.post('/api/compose/rewrite', {
      'text': text,
      'variant': variant,
    }, kWriterTimeout),
  );

  /// Hashtags returned with the last rewrite. The composer snapshots them with
  /// its text, previews both, and applies both only when the user accepts.
  List<String> lastVariantHashtags = const [];

  Future<String> _readVariant(Future<dynamic> call) async {
    final json = await call;
    final map = json as Map<String, dynamic>?;
    final text = map?['text'];
    if (text is! String || text.trim().isEmpty) {
      throw ApiException(
        0,
        'rewrite_failed',
        detail: 'The writer returned nothing usable.',
      );
    }
    final tags = map?['hashtags'];
    lastVariantHashtags = tags is List
        ? tags.whereType<String>().toList()
        : const [];
    return text;
  }

  /// Upload images and return their media ids, in the order given.
  Future<List<String>> uploadImages(List<String> paths) async {
    final ids = <String>[];
    for (final path in paths) {
      ids.add(await _api.uploadImage(path));
    }
    return ids;
  }

  Future<String?> compose({
    required String text,
    required bool polish,
    required bool publishNow,
    String? category,
    List<String> hashtags = const [],
    List<String> mediaIds = const [],
    DateTime? scheduledFor,
    void Function(int seq)? onCreated,
    String? clientRequestId,
  }) => mutate(() async {
    try {
      final result = await _api.post(
        '/api/posts',
        {
          'text': text,
          'polish': polish,
          'publishNow': publishNow,
          'clientRequestId': ?clientRequestId,
          'category': ?category,
          'hashtags': hashtags,
          'mediaIds': mediaIds,
          // Your own post goes on the same timetable as a generated one —
          // the send pass does not care who wrote the text. Scheduling counts
          // as clearing it: you wrote it, so there is nothing left to review.
          'scheduledFor': ?scheduledFor?.toUtc().toIso8601String(),
        },
        // Composing with polish on is a model call like any other.
        polish ? kWriterTimeout : null,
      );
      if (result is Map && result['seq'] is num) {
        onCreated?.call((result['seq'] as num).toInt());
      }
    } on ApiException catch (error) {
      if (error.postSeq != null) onCreated?.call(error.postSeq!);
      rethrow;
    }
  });

  // ------------------------------------------------------------------ slots

  List<PostSlot> get slots => status?.slots ?? const [];
  SlotLimits get slotLimits => status?.slotLimits ?? SlotLimits.fallback;

  bool get canAddSlot => slots.length < slotLimits.maxSlots;

  Future<String?> addSlot({
    required String localTime,
    int? daysMask,
    int? leadMinutes,
    bool autoPublish = false,
    List<String> categories = const [],
  }) => mutate(
    () => _api.post('/api/slots', {
      'localTime': localTime,
      'daysMask': ?daysMask,
      'leadMinutes': ?leadMinutes,
      'autoPublish': autoPublish,
      'categories': categories,
    }),
  );

  Future<String?> updateSlot(String id, Map<String, dynamic> patch) =>
      mutate(() => _api.patch('/api/slots/$id', patch));

  Future<String?> setSlotTime(String id, String localTime) =>
      updateSlot(id, {'localTime': localTime});

  Future<String?> setSlotDays(String id, int daysMask) =>
      updateSlot(id, {'daysMask': daysMask});

  /// The review window for this slot, in minutes. The server clamps it to its
  /// own floor and ceiling, so an out-of-range value lands at the bound rather
  /// than being rejected.
  Future<String?> setSlotLead(String id, int minutes) =>
      updateSlot(id, {'leadMinutes': minutes});

  /// Whether this slot may send without a human clearing the draft first.
  Future<String?> setSlotAutoPublish(String id, bool value) =>
      updateSlot(id, {'autoPublish': value});

  Future<String?> setSlotEnabled(String id, bool value) =>
      updateSlot(id, {'enabled': value});

  Future<String?> setSlotCategories(String id, List<String> categories) =>
      updateSlot(id, {'categories': categories});

  Future<String?> removeSlot(String id) =>
      mutate(() => _api.delete('/api/slots/$id'));

  /// Preview a candidate voice without saving it. Returns the server payload
  /// rather than storing it — a preview is screen-local by nature.
  Future<Map<String, dynamic>> previewStyle(StyleConfig style) async {
    final json = await _api.post('/api/style/preview', {
      'style': style.toJson(),
    }, kWriterTimeout);
    return (json as Map<String, dynamic>?) ?? const {};
  }
}
