import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/client.dart';
import '../state/app_state.dart';

class GeminiScreen extends StatelessWidget {
  const GeminiScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Your Gemini connection')),
    body: const SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: GeminiConnectionForm(),
      ),
    ),
  );
}

/// Keys are submitted once over HTTPS and never saved in device preferences.
class GeminiConnectionForm extends StatefulWidget {
  const GeminiConnectionForm({super.key, this.initial, this.onConnected});
  final Map<String, dynamic>? initial;
  final ValueChanged<Map<String, dynamic>>? onConnected;
  @override
  State<GeminiConnectionForm> createState() => _GeminiConnectionFormState();
}

class _GeminiConnectionFormState extends State<GeminiConnectionForm> {
  final _key = TextEditingController();
  Map<String, dynamic>? _data;
  String? _model;
  String _policy = 'free';
  String? _error;
  bool _accepted = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _loadData(widget.initial!);
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fetch());
    }
  }

  void _loadData(Map<String, dynamic> data) {
    _data = data;
    final models = List<String>.from(data['models'] as List? ?? []);
    _model = models.contains(data['model'])
        ? data['model'] as String
        : models.firstOrNull;
    _policy = data['dataPolicy'] == 'paid' ? 'paid' : 'free';
  }

  Future<void> _fetch() async {
    try {
      final data = await context.read<AppState>().api.get('/api/ai');
      if (mounted) {
        setState(() => _loadData(Map<String, dynamic>.from(data as Map)));
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = Map<String, dynamic>.from(
        await context.read<AppState>().api.post('/api/ai', {
              'apiKey': _key.text.trim(),
              'model': _model,
              'dataPolicy': _policy,
              'acceptedTerms': _accepted,
            }, kWriterTimeout)
            as Map,
      );
      _key.clear();
      if (!mounted) return;
      context.read<AppState>().updateAiConnection(data);
      setState(() {
        _loadData(data);
        _accepted = false;
      });
      widget.onConnected?.call(data);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    final remove = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove Gemini connection?'),
        content: const Text(
          'New AI drafts will stop until you connect a key again. Your existing drafts and LinkedIn connection stay available. This does not revoke the key at Google.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep connection'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (remove != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await context.read<AppState>().api.delete('/api/ai');
      _key.clear();
      if (mounted) {
        context.read<AppState>().updateAiConnection(
          Map<String, dynamic>.from(data as Map),
        );
        setState(() => _loadData(Map<String, dynamic>.from(data)));
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_data == null) {
      return Column(
        children: [
          if (_error == null)
            const CircularProgressIndicator()
          else ...[
            Text(_error!),
            TextButton(onPressed: _fetch, child: const Text('Try again')),
          ],
        ],
      );
    }
    final connected = _data!['connected'] == true;
    final models = List<String>.from(_data!['models'] as List? ?? []);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Connect your AI',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 12),
        const Text(
          'Use a Gemini key from your own Google project. ByLine uses your project’s allowance for samples, drafts and rewrites. Any Google charges belong to that project.',
        ),
        TextButton(
          onPressed: () => launchUrl(
            Uri.parse('https://aistudio.google.com/api-keys'),
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('Create a key in Google AI Studio'),
        ),
        const Text(
          'Choose your own project and create a new key restricted to Gemini. If you want free usage, check that project’s billing and available free quota in AI Studio. ByLine cannot verify your billing plan from a key.',
        ),
        if (connected) ...[
          const SizedBox(height: 16),
          Text(
            'Connected · key ending ${_data!['keyHint']} · ${_data!['model']}',
          ),
          if (_data!['message'] != null)
            Text(
              _data!['message'] as String,
              style: const TextStyle(color: Colors.deepOrange),
            ),
          if (widget.onConnected != null)
            FilledButton(
              onPressed: _busy ? null : () => widget.onConnected!(_data!),
              child: const Text('Continue'),
            ),
        ],
        const SizedBox(height: 20),
        TextField(
          controller: _key,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          enabled: !_busy,
          maxLength: 2048,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: connected ? 'Replacement Gemini key' : 'Gemini API key',
            helperText: 'Stored encrypted on the ByLine server.',
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _model,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Text model'),
          items: models
              .map((m) => DropdownMenuItem(value: m, child: Text(m)))
              .toList(),
          onChanged: _busy ? null : (v) => setState(() => _model = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _policy,
          decoration: const InputDecoration(labelText: 'My Google project'),
          items: const [
            DropdownMenuItem(value: 'free', child: Text('Unpaid / free tier')),
            DropdownMenuItem(value: 'paid', child: Text('Billing enabled')),
          ],
          onChanged: _busy
              ? null
              : (v) => setState(() {
                  _policy = v!;
                  _accepted = false;
                }),
        ),
        const SizedBox(height: 12),
        Text(
          _policy == 'free'
              ? 'Google may use unpaid inputs and outputs to improve its products. Do not submit personal, sensitive or confidential information, including in writing samples. Google requires Paid Services for users in the EEA, UK and Switzerland.'
              : 'Google’s paid-service data terms apply. Your Google project may be billed for generation; check your billing and quota settings.',
        ),
        TextButton(
          onPressed: () => launchUrl(
            Uri.parse('https://ai.google.dev/gemini-api/terms'),
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('Read Google’s data-use terms'),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _accepted,
          onChanged: _busy
              ? null
              : (v) => setState(() => _accepted = v ?? false),
          title: const Text(
            'I own or am authorized to use this key and understand the data-use and billing terms. Testing makes one small Gemini request.',
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              _error!,
              style: const TextStyle(color: Colors.deepOrange),
            ),
          ),
        FilledButton(
          onPressed:
              _busy || !_accepted || _key.text.trim().isEmpty || _model == null
              ? null
              : _save,
          child: Text(
            _busy ? 'Testing connection…' : 'Test and save connection',
          ),
        ),
        if (connected && widget.onConnected == null)
          TextButton(
            onPressed: _busy ? null : _remove,
            child: const Text('Remove connection'),
          ),
      ],
    );
  }
}
