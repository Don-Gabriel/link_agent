/// Sign in, and say where the server is.
///
/// The address field is not a power-user setting — it is the first thing that
/// goes wrong. The Android emulator cannot reach the host on `localhost` (that
/// resolves to the emulated device), so this screen states the working value
/// rather than leaving it to be discovered.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

class GateScreen extends StatefulWidget {
  const GateScreen({super.key});

  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  late final TextEditingController _url;
  final _password = TextEditingController();
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: context.read<AppState>().baseUrl);
  }

  @override
  void dispose() {
    _url.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final state = context.read<AppState>();
    await state.setBaseUrl(_url.text);
    final signedIn = await state.signIn(_password.text);
    if (signedIn && mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(S.x5),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('THE DESK', style: T.slug.copyWith(color: C.filament)),
                  const SizedBox(height: S.x2),
                  const Text('LinkdIn', style: T.display),
                  const SizedBox(height: S.x2),
                  Text(
                    'Your posting agent reads overnight and waits for an editor.',
                    style: T.small,
                  ),
                  const SizedBox(height: S.x7),

                  Field(
                    label: 'Server address',
                    child: TextField(
                      controller: _url,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      enabled: !state.loading,
                      decoration: const InputDecoration(
                        hintText: ApiClient.defaultBaseUrl,
                      ),
                    ),
                  ),
                  Field(
                    label: 'Password',
                    child: TextField(
                      controller: _password,
                      obscureText: _obscure,
                      enabled: !state.loading,
                      onSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        hintText: 'APP_PASSWORD',
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscure ? Icons.visibility_off : Icons.visibility,
                            size: 19,
                          ),
                          color: C.paperFaint,
                          tooltip: _obscure ? 'Show password' : 'Hide password',
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                    ),
                  ),
                  FilledButton(
                    onPressed: state.loading ? null : _submit,
                    child: state.loading
                        ? const SizedBox(
                            height: 17,
                            width: 17,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: C.onFilament,
                            ),
                          )
                        : const Text('Sign in'),
                  ),
                  if (state.error != null) ErrorNote(state.error!),

                  const SizedBox(height: S.x6),
                  Container(
                    padding: const EdgeInsets.all(S.x3),
                    decoration: BoxDecoration(
                      color: C.ink2,
                      borderRadius: BorderRadius.circular(R.sm),
                      border: Border.all(color: C.rule),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('RUNNING THE BACKEND LOCALLY?', style: T.slug),
                        const SizedBox(height: S.x2),
                        Text(
                          'Use 10.0.2.2 instead of localhost — inside the emulator, '
                          'localhost is the emulator itself, not your machine.',
                          style: T.micro,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
