import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/experience.dart';

class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});
  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _confirmation = TextEditingController();
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    if (_busy || _confirmation.text.trim() != 'DELETE') return;
    final state = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await state.api.post('/api/account/delete', {'confirmation': 'DELETE'});
      await state.signOut();
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Delete ByLine account')),
    body: PageSurface(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text('Remove your ByLine setup', style: T.title),
          const SizedBox(height: 16),
          const Text(
            'This permanently removes your ByLine profile, timetable, drafts, writing samples, preferences, history and saved LinkedIn credentials from the active service. It signs out all your ByLine sessions and stops future automation.',
            style: T.body,
          ),
          const SizedBox(height: 16),
          const Text(
            'Posts already published on LinkedIn remain there. Remove those directly on LinkedIn if you want to. Previously created operator backups may retain data until they are removed under the operator’s retention policy.',
            style: T.small,
          ),
          const SizedBox(height: 16),
          const Text(
            'Also remove ByLine from LinkedIn’s permitted services to withdraw the permission recorded by LinkedIn.',
            style: T.body,
          ),
          TextButton.icon(
            onPressed: _busy
                ? null
                : () => launchUrl(
                    Uri.parse(
                      'https://www.linkedin.com/psettings/permitted-services',
                    ),
                    mode: LaunchMode.externalApplication,
                  ),
            icon: const Icon(Icons.open_in_new),
            label: const Text('Open LinkedIn permitted services'),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _confirmation,
            enabled: !_busy,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Type DELETE to confirm',
              helperText: 'This cannot be undone.',
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy || _confirmation.text.trim() != 'DELETE'
                ? null
                : _delete,
            style: FilledButton.styleFrom(backgroundColor: C.flare),
            child: Text(_busy ? 'Deleting…' : 'Delete ByLine account'),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, style: T.small.copyWith(color: C.flare)),
            ),
        ],
      ),
    ),
  );
}
