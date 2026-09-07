import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'editorial.dart';

class ProfileCard extends StatelessWidget {
  const ProfileCard({super.key, this.onEdit});
  final VoidCallback? onEdit;
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final name =
        state.status?.account.memberName ?? state.agent?.name ?? 'Your profile';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 104,
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 18),
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppSurfaces.cover,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Stack(
              children: [
                const Positioned(
                  right: -20,
                  bottom: -13,
                  child: StudioArt(height: 115),
                ),
                Positioned(
                  left: 16,
                  top: 16,
                  child: Text(
                    'YOUR\nWRITING\nSPACE',
                    style: T.small.copyWith(
                      fontSize: 12,
                      letterSpacing: 1.8,
                      height: 1.6,
                      color: const Color(0xFF244969),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: C.filamentWash,
                child: Text(
                  name.isEmpty ? 'B' : name.characters.first.toUpperCase(),
                  style: T.title.copyWith(color: C.filament),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(name, style: T.bodyStrong)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(
                state.status?.account.usable == true
                    ? Icons.check_circle
                    : Icons.link_off,
                size: 16,
                color: state.status?.account.usable == true
                    ? C.daylight
                    : C.paperDim,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  state.status?.account.usable == true
                      ? 'LinkedIn connected'
                      : 'Check your connection',
                  style: T.small,
                ),
              ),
            ],
          ),
          if (onEdit != null)
            TextButton(
              onPressed: onEdit,
              child: const Text('Manage preferences'),
            ),
        ],
      ),
    );
  }
}

class FormSection extends StatelessWidget {
  const FormSection({
    super.key,
    required this.title,
    required this.child,
    this.description,
  });
  final String title;
  final String? description;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: T.bodyStrong),
        if (description != null) ...[
          const SizedBox(height: 8),
          Text(description!, style: T.small),
        ],
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}
