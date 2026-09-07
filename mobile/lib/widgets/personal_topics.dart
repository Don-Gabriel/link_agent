import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'form_select.dart';
import 'unsaved_changes_guard.dart';
import 'editorial.dart';

class PersonalTopics extends StatefulWidget {
  const PersonalTopics({super.key});
  @override
  State<PersonalTopics> createState() => _PersonalTopicsState();
}

class _PersonalTopicsState extends State<PersonalTopics> {
  final _input = TextEditingController();
  List<String> _topics = [];
  bool _loading = true, _saving = false, _dirty = false, _loaded = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<AppState>().api.get('/api/interests');
      if (mounted) {
        setState(() {
          _topics = List<String>.from(data['topics'] as List);
          _error = null;
          _loading = false;
          _loaded = true;
          _dirty = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load your interests. Try again.';
        });
      }
    }
  }

  void _add() {
    final text = _input.text.trim();
    if (text.length < 2 ||
        text.length > 80 ||
        _topics.length >= 12 ||
        _topics.any((t) => t.toLowerCase() == text.toLowerCase())) {
      setState(
        () => _error =
            'Add a different topic (2–80 characters), up to 12 in total.',
      );
      return;
    }
    setState(() {
      _topics = [..._topics, text];
      _input.clear();
      _dirty = true;
      _error = null;
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final error = await context.read<AppState>().mutate(
      () => context.read<AppState>().api.post('/api/interests', {
        'topics': _topics,
      }),
    );
    if (mounted) {
      setState(() {
        _saving = false;
        _error = error;
        if (error == null) _dirty = false;
      });
    }
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => UnsavedChangesGuard(
    dirty: _dirty,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const StudioBanner(
          compact: true,
          scene: StudioScene.ideas,
          eyebrow: 'FOLLOW YOUR CURIOSITY',
          title: 'What’s on your mind?',
          caption: 'Choose the subjects you want to be known for.',
        ),
        const SizedBox(height: 8),
        const Text(
          'Add the subjects you want to be known for. These guide the writer; the source coverage below decides where we look for articles.',
          style: T.small,
        ),
        const SizedBox(height: 20),
        if (_loading)
          const LinearProgressIndicator()
        else ...[
          MultiSelectField(
            label: 'Your interests',
            options: {for (final t in _topics) t: t},
            values: _topics,
            min: 1,
            max: 12,
            onChanged: _saving || !_loaded
                ? null
                : (v) => setState(() {
                    _topics = v;
                    _dirty = true;
                  }),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _input,
            enabled: !_saving && _loaded,
            maxLength: 80,
            onSubmitted: (_) => _add(),
            decoration: InputDecoration(
              labelText: 'Add your own topic',
              hintText: 'e.g. Sustainable product design',
              suffixIcon: IconButton(
                tooltip: 'Add topic',
                icon: const Icon(Icons.add),
                onPressed: _saving || !_loaded ? null : _add,
              ),
            ),
          ),
          FilledButton(
            onPressed: _loaded && _dirty && !_saving && _topics.isNotEmpty
                ? _save
                : null,
            child: Text(
              _saving
                  ? 'Saving…'
                  : _dirty
                  ? 'Save interests'
                  : 'Interests saved',
            ),
          ),
        ],
        if (_error != null) ...[
          Text(_error!, style: T.small.copyWith(color: C.flare)),
          TextButton(onPressed: _load, child: const Text('Reload interests')),
        ],
      ],
    ),
  );
}
