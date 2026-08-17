/// Single app-wide store.
///
/// One ChangeNotifier is the right size here: the backend hands back the entire
/// dashboard in one GET /api/status, so there is exactly one server truth to
/// hold and every mutation ends by re-fetching it. Splitting that into per-
/// screen stores would create the possibility of two screens disagreeing, which
/// is precisely the bug class an approval queue must not have.
library;

import 'package:flutter/foundation.dart';

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
  Future<String?> approve(int seq) => mutate(() => _api.patch('/api/posts/$seq', {'action': 'publish'}));

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
  }) =>
      mutate(() => _api.post('/api/posts', {
            'text': text,
            'polish': polish,
            'publishNow': publishNow,
            'category': ?category,
            'hashtags': hashtags,
            'mediaIds': mediaIds,
          }));

  /// Preview a candidate voice without saving it. Returns the server payload
  /// rather than storing it — a preview is screen-local by nature.
  Future<Map<String, dynamic>> previewStyle(StyleConfig style) async {
    final json = await _api.post('/api/style/preview', {'style': style.toJson()});
    return (json as Map<String, dynamic>?) ?? const {};
  }
}
