import 'package:flutter/material.dart';
import '../theme.dart';

class PreparationProgress extends StatelessWidget {
  const PreparationProgress({
    super.key,
    required this.progress,
    this.reconnecting = false,
  });
  final Map<String, dynamic> progress;
  final bool reconnecting;

  @override
  Widget build(BuildContext context) {
    final state = progress['state'];
    final ready = state == 'ready';
    final working = state == 'working';
    final completed = ((progress['completed'] as num?)?.toInt() ?? 0).clamp(
      0,
      4,
    );
    final stage = progress['stage'];
    final title = reconnecting
        ? 'Reconnecting to ByLine…'
        : switch (state) {
            'ready' => 'Your post is ready',
            'waiting' => 'Waiting for another attempt',
            'paused' => 'Preparation paused',
            _ => switch (stage) {
              'discovering' => 'Finding sources',
              'judging' => 'Reviewing articles',
              'writing' => 'Writing in your voice',
              'saving' => 'Saving your draft',
              _ => 'Starting your post…',
            },
          };
    final detail = reconnecting
        ? 'Showing the last known step. Progress will update when the connection returns.'
        : ready
        ? 'Read it below, then publish, edit or skip.'
        : !working && progress['message'] is String
        ? progress['message'] as String
        : 'Step ${completed + 1} of 4 · Progress follows completed steps, not time remaining.';
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: ready ? AppSurfaces.green : AppSurfaces.blue,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppSurfaces.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  ready
                      ? Icons.check_circle_outline
                      : working
                      ? Icons.auto_awesome
                      : Icons.schedule,
                  color: ready ? C.daylight : C.filament,
                  size: 22,
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(title, style: T.bodyStrong)),
              ],
            ),
            const SizedBox(height: 14),
            LinearProgressIndicator(
              value: stage == null && working && !reconnecting
                  ? null
                  : completed / 4,
              minHeight: 6,
              borderRadius: BorderRadius.circular(3),
              backgroundColor: Colors.white,
              color: ready ? C.daylight : C.filament,
              semanticsLabel: 'Preparation steps completed',
              semanticsValue: '${completed * 25}',
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: [
                for (var i = 0; i < 4; i++)
                  Text(
                    '${i < completed ? '✓' : '${i + 1}.'} ${const ['Sources', 'Review', 'Write', 'Save'][i]}',
                    style: T.small.copyWith(
                      color: i < completed ? C.daylight : C.paperDim,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text(detail, style: T.small.copyWith(color: C.paper)),
          ],
        ),
      ),
    );
  }
}
