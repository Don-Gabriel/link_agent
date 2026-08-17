/// Typed views over the /api/status payload.
///
/// Every constructor is total: a missing or wrong-typed field falls back to a
/// sane value rather than throwing. The app must stay usable when the backend
/// is a version ahead or behind, and a null-check crash on a field nobody
/// reads is the worst possible way to find that out.
library;

/// Mirrors lib/style.ts StyleConfig. The server validates and clamps, so the
/// app can send a partial patch and trust what comes back.
class StyleConfig {
  const StyleConfig({
    required this.structure,
    required this.emoji,
    required this.hook,
    required this.cta,
    required this.minWords,
    required this.maxWords,
    required this.hashtagCount,
    required this.register,
    required this.signature,
    required this.customRules,
    required this.bannedPhrases,
  });

  final String structure;
  final String emoji;
  final String hook;
  final String cta;
  final int minWords;
  final int maxWords;
  final int hashtagCount;
  final String register;
  final SignatureConfig? signature;
  final List<String> customRules;
  final List<String> bannedPhrases;

  static const houseStyle = StyleConfig(
    structure: 'prose',
    emoji: 'none',
    hook: 'sharp',
    cta: 'none',
    minWords: 120,
    maxWords: 220,
    hashtagCount: 2,
    register: 'practitioner',
    signature: null,
    customRules: [],
    bannedPhrases: [],
  );

  factory StyleConfig.fromJson(Map<String, dynamic>? j) {
    if (j == null) return houseStyle;
    return StyleConfig(
      structure: _str(j['structure'], 'prose'),
      emoji: _str(j['emoji'], 'none'),
      hook: _str(j['hook'], 'sharp'),
      cta: _str(j['cta'], 'none'),
      minWords: _int(j['minWords'], 120),
      maxWords: _int(j['maxWords'], 220),
      hashtagCount: _int(j['hashtagCount'], 2),
      register: _str(j['register'], 'practitioner'),
      signature: switch (_map(j['signature'])) {
        final sig? => SignatureConfig.fromJson(sig),
        _ => null,
      },
      customRules: _strList(j['customRules']),
      bannedPhrases: _strList(j['bannedPhrases']),
    );
  }

  Map<String, dynamic> toJson() => {
        'structure': structure,
        'emoji': emoji,
        'hook': hook,
        'cta': cta,
        'minWords': minWords,
        'maxWords': maxWords,
        'hashtagCount': hashtagCount,
        'register': register,
        'signature': signature?.toJson(),
        'customRules': customRules,
        'bannedPhrases': bannedPhrases,
      };

  StyleConfig copyWith({
    String? structure,
    String? emoji,
    String? hook,
    String? cta,
    int? minWords,
    int? maxWords,
    int? hashtagCount,
    String? register,
    List<String>? customRules,
    List<String>? bannedPhrases,
    // Nullable field needs an explicit sentinel: passing null must be able to
    // mean "clear the signature", not "leave it alone".
    bool clearSignature = false,
    SignatureConfig? signature,
  }) =>
      StyleConfig(
        structure: structure ?? this.structure,
        emoji: emoji ?? this.emoji,
        hook: hook ?? this.hook,
        cta: cta ?? this.cta,
        minWords: minWords ?? this.minWords,
        maxWords: maxWords ?? this.maxWords,
        hashtagCount: hashtagCount ?? this.hashtagCount,
        register: register ?? this.register,
        signature: clearSignature ? null : (signature ?? this.signature),
        customRules: customRules ?? this.customRules,
        bannedPhrases: bannedPhrases ?? this.bannedPhrases,
      );

  /// One-line summary for the collapsed settings row.
  String get summary => [
        _structureLabels[structure] ?? structure,
        emoji == 'none' ? 'no emoji' : '$emoji emoji',
        hashtagCount == 0 ? 'no tags' : '$hashtagCount tags',
        '$minWords–$maxWords words',
        signature == null ? 'no signature' : '${signature!.source} line',
      ].join(' · ');
}

class SignatureConfig {
  const SignatureConfig({
    required this.source,
    required this.maxWords,
    required this.budgetPerFive,
    required this.banned,
  });

  final String source;
  final int maxWords;
  final int budgetPerFive;
  final List<String> banned;

  factory SignatureConfig.fromJson(Map<String, dynamic> j) => SignatureConfig(
        source: _str(j['source'], ''),
        maxWords: _int(j['maxWords'], 12),
        budgetPerFive: _int(j['budgetPerFive'], 1),
        banned: _strList(j['banned']),
      );

  Map<String, dynamic> toJson() => {
        'source': source,
        'maxWords': maxWords,
        'budgetPerFive': budgetPerFive,
        'banned': banned,
      };

  SignatureConfig copyWith({String? source, int? maxWords, int? budgetPerFive, List<String>? banned}) =>
      SignatureConfig(
        source: source ?? this.source,
        maxWords: maxWords ?? this.maxWords,
        budgetPerFive: budgetPerFive ?? this.budgetPerFive,
        banned: banned ?? this.banned,
      );
}

class StylePreset {
  const StylePreset({required this.id, required this.label, required this.blurb, required this.style});

  final String id;
  final String label;
  final String blurb;
  final StyleConfig style;

  factory StylePreset.fromJson(Map<String, dynamic> j) => StylePreset(
        id: _str(j['id'], ''),
        label: _str(j['label'], ''),
        blurb: _str(j['blurb'], ''),
        style: StyleConfig.fromJson(_map(j['style'])),
      );
}

class Agent {
  const Agent({
    required this.agentId,
    required this.name,
    required this.domain,
    required this.categories,
    required this.timezone,
    required this.postTimeLocal,
    required this.autoPublish,
    required this.paused,
    required this.autoPublishCap,
    required this.style,
  });

  final String agentId;
  final String name;
  final String domain;
  final List<String> categories;
  final String timezone;
  final String postTimeLocal;
  final bool autoPublish;
  final bool paused;

  /// Posts the AGENT may publish per rolling 24h (1-3). Manual publishing is
  /// bounded by LinkedIn's own limits, not by this.
  final int autoPublishCap;
  final StyleConfig style;

  factory Agent.fromJson(Map<String, dynamic> j) => Agent(
        agentId: _str(j['agentId'], ''),
        name: _str(j['name'], 'Agent'),
        domain: _str(j['domain'], ''),
        categories: _strList(j['categories']),
        timezone: _str(j['timezone'], 'UTC'),
        postTimeLocal: _str(j['postTimeLocal'], '09:30'),
        autoPublish: _bool(j['autoPublish']),
        paused: _bool(j['paused']),
        autoPublishCap: _int(j['autoPublishCap'], 1),
        style: StyleConfig.fromJson(_map(j['style'])),
      );
}

class Account {
  const Account({
    required this.connected,
    this.memberName,
    this.daysRemaining,
    this.expiringSoon = false,
    this.needsReauth = false,
    this.lastError,
  });

  final bool connected;
  final String? memberName;
  final int? daysRemaining;
  final bool expiringSoon;
  final bool needsReauth;
  final String? lastError;

  bool get usable => connected && !needsReauth;

  factory Account.fromJson(Map<String, dynamic>? j) {
    if (j == null) return const Account(connected: false);
    return Account(
      connected: _bool(j['connected']),
      memberName: j['memberName'] as String?,
      daysRemaining: j['daysRemaining'] is num ? (j['daysRemaining'] as num).toInt() : null,
      expiringSoon: _bool(j['expiringSoon']),
      needsReauth: _bool(j['needsReauth']),
      lastError: j['lastError'] as String?,
    );
  }
}

class Post {
  const Post({
    required this.id,
    required this.seq,
    required this.text,
    required this.hook,
    required this.rationale,
    required this.status,
    required this.kind,
    required this.category,
    required this.scores,
    required this.sources,
    required this.media,
    required this.hashtags,
    required this.usedQuote,
    required this.createdAt,
    required this.publishedAt,
  });

  final String id;
  final int seq;
  final String text;
  final String hook;
  final String rationale;
  final String status;
  final String kind;
  final String? category;
  final Map<String, num> scores;
  final List<String> sources;

  /// media_assets ids already attached to this post.
  final List<String> media;
  final List<String> hashtags;
  final bool usedQuote;
  final DateTime? createdAt;
  final DateTime? publishedAt;

  bool get isDraft => status == 'draft';
  bool get isPublished => status == 'published';

  factory Post.fromJson(Map<String, dynamic> j) => Post(
        id: _str(j['id'], ''),
        seq: _int(j['seq'], 0),
        text: _str(j['text'], ''),
        hook: _str(j['hook'], ''),
        rationale: _str(j['rationale'], ''),
        status: _str(j['status'], 'draft'),
        kind: _str(j['kind'], 'auto'),
        category: j['category'] as String?,
        scores: j['scores'] is Map
            ? (j['scores'] as Map).map((k, v) => MapEntry('$k', v is num ? v : 0))
            : const {},
        sources: _strList(j['sources']),
        media: _strList(j['media']),
        hashtags: _strList(j['hashtags']),
        usedQuote: _bool(j['usedQuote']),
        createdAt: DateTime.tryParse(_str(j['createdAt'], '')),
        publishedAt: DateTime.tryParse(_str(j['publishedAt'], '')),
      );
}

/// Both publishing allowances, counted over a rolling 24 hours.
class Budget {
  const Budget({
    required this.autoUsed,
    required this.autoCap,
    required this.manualUsed,
    required this.manualCap,
    required this.linkedinDailyRequests,
  });

  final int autoUsed;
  final int autoCap;
  final int manualUsed;
  final int manualCap;
  final int linkedinDailyRequests;

  int get autoLeft => (autoCap - autoUsed).clamp(0, autoCap);
  bool get autoExhausted => autoUsed >= autoCap;

  factory Budget.fromJson(Map<String, dynamic>? j) => Budget(
        autoUsed: _int(j?['autoUsed'], 0),
        autoCap: _int(j?['autoCap'], 1),
        manualUsed: _int(j?['manualUsed'], 0),
        manualCap: _int(j?['manualCap'], 40),
        linkedinDailyRequests: _int(j?['linkedinDailyRequests'], 150),
      );
}

/// A story the judge scored and rejected, with its reason.
class Rejection {
  const Rejection({required this.title, required this.url, required this.reason});

  final String title;
  final String url;
  final String reason;

  factory Rejection.fromJson(Map<String, dynamic> j) => Rejection(
        title: _str(j['title'], ''),
        url: _str(j['url'], ''),
        reason: _str(j['reason'], ''),
      );
}

/// One model's usage against its daily quota.
class LlmUsage {
  const LlmUsage({required this.model, required this.calls, required this.cap});

  final String model;
  final int calls;
  final int cap;

  factory LlmUsage.fromJson(Map<String, dynamic> j) => LlmUsage(
        model: _str(j['model'], ''),
        calls: _int(j['calls'], 0),
        cap: _int(j['cap'], 0),
      );
}

/// The whole dashboard in one object, matching GET /api/status.
class AppStatus {
  const AppStatus({
    required this.initialized,
    required this.agent,
    required this.account,
    required this.liveMode,
    required this.maxAutoCap,
    required this.presets,
    required this.queue,
    required this.history,
    required this.rejections,
    required this.llm,
    required this.budget,
    required this.nextRunLocal,
    required this.cycleCount,
    required this.ambiguousCount,
  });

  final bool initialized;
  final Agent? agent;
  final Account account;
  final bool liveMode;
  final int maxAutoCap;
  final List<StylePreset> presets;
  final List<Post> queue;
  final List<Post> history;
  final List<Rejection> rejections;
  final List<LlmUsage> llm;
  final Budget budget;
  final String? nextRunLocal;
  final int cycleCount;
  final int ambiguousCount;

  factory AppStatus.fromJson(Map<String, dynamic> j) {
    final config = _map(j['config']) ?? const <String, dynamic>{};
    final schedule = _map(j['schedule']) ?? const <String, dynamic>{};
    return AppStatus(
      initialized: _bool(j['initialized']),
      agent: switch (_map(j['agent'])) {
        final a? => Agent.fromJson(a),
        _ => null,
      },
      account: Account.fromJson(_map(j['account'])),
      liveMode: _bool(config['liveMode']),
      maxAutoCap: _int(config['maxAutoCap'], 3),
      presets: _list(config['presets']).map(StylePreset.fromJson).toList(),
      queue: _list(j['queue']).map(Post.fromJson).toList(),
      history: _list(j['history']).map(Post.fromJson).toList(),
      rejections: _list(j['rejections']).map(Rejection.fromJson).toList(),
      llm: _list(j['llm']).map(LlmUsage.fromJson).toList(),
      budget: Budget.fromJson(_map(j['budget'])),
      nextRunLocal: schedule['nextRunLocal'] as String?,
      cycleCount: _int(schedule['cycleCount'], 0),
      ambiguousCount: _list(j['ambiguous']).length,
    );
  }
}

// ------------------------------------------------------------------ coercion

String _str(dynamic v, String fallback) => v is String ? v : fallback;
int _int(dynamic v, int fallback) => v is num ? v.toInt() : fallback;
bool _bool(dynamic v) => v == true;

List<String> _strList(dynamic v) =>
    v is List ? v.whereType<String>().toList() : const <String>[];

/// Coerce any map to `Map<String, dynamic>`, or null.
///
/// `jsonDecode` always produces `Map<String, dynamic>`, so a plain
/// `as Map<String, dynamic>` works against the live API and then throws the
/// moment anything else hands us a map — a `Map<String, Object>` literal in a
/// test, a fixture, a cached payload. A decoder whose contract is "never
/// throws" cannot contain a cast that does.
Map<String, dynamic>? _map(dynamic v) =>
    v is Map ? v.map((k, value) => MapEntry('$k', value)) : null;

List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((m) => m.map((k, value) => MapEntry('$k', value))).toList()
    : const [];

const _structureLabels = {
  'prose': 'Paragraphs',
  'bullets': 'Bullet list',
  'short-lines': 'Short lines',
  'mixed': 'Lead + bullets',
};
