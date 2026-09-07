import 'package:flutter/material.dart';

/// Keeps staged settings from disappearing when the user goes back.
class UnsavedChangesGuard extends StatefulWidget {
  const UnsavedChangesGuard({
    super.key,
    required this.dirty,
    required this.child,
  });
  final bool dirty;
  final Widget child;

  @override
  State<UnsavedChangesGuard> createState() => _UnsavedChangesGuardState();
}

class _UnsavedChangesGuardState extends State<UnsavedChangesGuard> {
  bool _allowLeave = false, _asking = false;

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !widget.dirty || _allowLeave,
    onPopInvokedWithResult: (didPop, result) async {
      if (didPop || _asking) return;
      _asking = true;
      final leave = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Leave without saving?'),
          content: const Text(
            'Your unsaved changes on this page will be lost.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep editing'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Discard changes'),
            ),
          ],
        ),
      );
      _asking = false;
      if (!mounted || leave != true) return;
      setState(() => _allowLeave = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop(result);
      });
    },
    child: widget.child,
  );
}
