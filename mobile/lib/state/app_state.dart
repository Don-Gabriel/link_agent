/// Single app-wide store.
///
/// One ChangeNotifier is the right size here: the backend hands back the entire
/// dashboard in one GET /api/status, so there is exactly one server truth to
/// hold and every mutation ends by re-fetching it. Splitting that into per-
/// screen stores would create the possibility of two screens disagreeing, which
/// is precisely the bug class an approval queue must not have.
library;

import 'package:flutter/foundation.dart' show ChangeNotifier, debugPrint;

import '../api/client.dart';
import '../api/models.dart';

enum AuthPhase { unknown, signedOut, signedIn }

class AppState extends ChangeNotifier {
  AppState(this._api);

  final ApiClient _api;
  ApiClient get api => _api;

  AuthPhase phase = AuthPhase.unknown;
  AppStatus? status;

  /// Set while a full refresh is in flight, so screens can show a spinner
  /// without every button needing its own flag.
  bool loading = false;

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
    await _api.logOut();
    phase = AuthPhase.signedOut;
    status = null;
    error = null;
    notifyListeners();
  }

  Future<void> refresh() async {
    loading = true;
    notifyListeners();
    try {
      final json = await _api.get('/api/status');
      status = AppStatus.fromJson(json as Map<String, dynamic>);
      error = null;
    } on ApiException catch (e) {
      // An expired or rejected cookie must drop us back to the gate rather than
      // leaving a signed-in shell that fails on every tap.
      if (e.isUnauthorized) {
        await _api.clearSession();
        phase = AuthPhase.signedOut;
        status = null;
      }
      error = e.toString();
    }
    loading = false;
    notifyListeners();
  }

  /// Run a mutation, surface its error, and re-sync from the server.
  ///
  /// Returns null on success or the error string on failure, so callers can
  /// decide between a snackbar and inline text without re-reading [error].
  Future<String?> mutate(Future<void> Function() action) async {
    loading = true;
    notifyListeners();
    try {
      await action();
    } on ApiException catch (e) {
      loading = false;
      error = e.toString();
      notifyListeners();
      return e.toString();
    }
    await refresh();
    return null;
  }

  // ---------------------------------------------------------------- actions

  Future<String?> setStyle(StyleConfig style) =>
      mutate(() => _api.patch('/api/settings', {'style': style.toJson()}));

  Future<String?> applyPreset(String presetId) =>
      mutate(() => _api.patch('/api/settings', {'preset': presetId}));

  Future<String?> setAutoPublish(bool value) =>
      mutate(() => _api.patch('/api/settings', {'autoPublish': value}));

  Future<String?> setPaused(bool value) =>
      mutate(() => _api.patch('/api/settings', {'paused': value}));

  /// How many posts the agent may publish by itself per rolling 24h (1-3).
  Future<String?> setAutoPublishCap(int value) =>
      mutate(() => _api.patch('/api/settings', {'autoPublishCap': value}));

  /// "HH:MM" in the agent's timezone. Changing it reschedules the next run —
  /// and because nextDailyRun is strictly future, setting today's time after
  /// it has passed moves the run to tomorrow.
  Future<String?> setPostTime(String hhmm) =>
      mutate(() => _api.patch('/api/settings', {'postTimeLocal': hhmm}));

  Future<String?> setTimezone(String tz) =>
      mutate(() => _api.patch('/api/settings', {'timezone': tz}));

  Future<String?> setCategories(List<String> categories) =>
      mutate(() => _api.patch('/api/settings', {'categories': categories}));

  /// Force a cycle now, ignoring the schedule.
  ///
  /// Session-authenticated, unlike /api/cron/tick which needs the cron secret
  /// the app deliberately does not hold. Returns as soon as the work is
  /// started — the draft appears on a later refresh, 30-60s out.
  Future<String?> runCycleNow() => mutate(() => _api.post('/api/cycle/run', const {}));

  // PATCH, not POST: /api/posts/[seq] exports PATCH and answers anything else
  // with a 405. Only /api/posts (compose) is a POST.

  /// "I have read this — let it go out at its scheduled time."
  ///
  /// The primary action on a scheduled draft, and deliberately NOT the same
  /// thing as publishing. Before slots existed, approving a draft sent it
  /// immediately; that is the wrong default once a post has a time of its own,
  /// because clearing something at 08:48 should not publish it at 08:48.
  Future<String?> clear(int seq) => mutate(() => _api.patch('/api/posts/$seq', {'action': 'clear'}));

  /// Withdraw clearance. On a hold-mode slot this is enough to stop the send.
  Future<String?> unclear(int seq) =>
      mutate(() => _api.patch('/api/posts/$seq', {'action': 'unclear'}));

  /// Send right now, ignoring the schedule. The override, not the default.
  Future<String?> sendNow(int seq) =>
      mutate(() => _api.patch('/api/posts/$seq', {'action': 'publish'}));

  /// Move a post to a different time, or lift it off the schedule with null.
  Future<String?> reschedule(int seq, DateTime? when) => mutate(() => _api.patch(
        '/api/posts/$seq',
        {'action': 'reschedule', 'scheduledFor': when?.toUtc().toIso8601String()},
      ));

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

  Future<String?> discard(int seq) => mutate(() => _api.patch('/api/posts/$seq', {'action': 'discard'}));

  Future<String?> editPost(
    int seq,
    String text,
    List<String> hashtags, {
    List<String>? mediaIds,
  }) =>
      mutate(() => _api.patch('/api/posts/$seq', {
            'action': 'edit',
            'text': text,
            'hashtags': hashtags,
            // Omitted entirely when null: the server treats an absent key as
            // "leave the existing images alone".
            'mediaIds': ?mediaIds,
          }));

  /// Ask the writer for a different treatment of a draft. Returns the variant
  /// text; nothing is saved until the user accepts it with [editPost].
  ///
  /// [variant] cycles the angle the writer is told to take, so pressing the
  /// button repeatedly gives genuinely different options rather than the same
  /// rephrasing each time.
  Future<String> rewriteDraft(int seq, {int variant = 0}) =>
      _readVariant(_api.patch('/api/posts/$seq', {'action': 'rewrite', 'variant': variant}));

  /// Same, for text that has not been saved yet — the composer writing
  /// something new has no seq to reference.
  Future<String> rewriteText(String text, {int variant = 0}) =>
      _readVariant(_api.post('/api/compose/rewrite', {'text': text, 'variant': variant}));

  Future<String> _readVariant(Future<dynamic> call) async {
    final json = await call;
    final text = (json as Map<String, dynamic>?)?['text'];
    if (text is! String || text.trim().isEmpty) {
      throw ApiException(0, 'rewrite_failed', detail: 'The writer returned nothing usable.');
    }
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
  }) =>
      mutate(() => _api.post('/api/posts', {
            'text': text,
            'polish': polish,
            'publishNow': publishNow,
            'category': ?category,
            'hashtags': hashtags,
            'mediaIds': mediaIds,
            // Your own post goes on the same timetable as a generated one —
            // the send pass does not care who wrote the text. Scheduling counts
            // as clearing it: you wrote it, so there is nothing left to review.
            'scheduledFor': ?scheduledFor?.toUtc().toIso8601String(),
          }));

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
  }) =>
      mutate(() => _api.post('/api/slots', {
            'localTime': localTime,
            'daysMask': ?daysMask,
            'leadMinutes': ?leadMinutes,
            'autoPublish': autoPublish,
            'categories': categories,
          }));

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

  Future<String?> removeSlot(String id) => mutate(() => _api.delete('/api/slots/$id'));

  /// Preview a candidate voice without saving it. Returns the server payload
  /// rather than storing it — a preview is screen-local by nature.
  Future<Map<String, dynamic>> previewStyle(StyleConfig style) async {
    final json = await _api.post('/api/style/preview', {'style': style.toJson()});
    return (json as Map<String, dynamic>?) ?? const {};
  }
}
