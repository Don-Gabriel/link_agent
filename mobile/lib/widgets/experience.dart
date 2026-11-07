import 'package:flutter/material.dart';
import '../theme.dart';
export 'timezone_picker.dart' show ZoneField;

/// Keeps forms readable on a monitor without restricting phone layouts.
class ReadingWidth extends StatelessWidget {
  const ReadingWidth({super.key, required this.child, this.width = 820});
  final Widget child;
  final double width;
  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: width),
      child: child,
    ),
  );
}

/// A continuous, bounded workspace. Forms stay anchored on wide displays;
/// phones use the full available width without nested floating cards.
class PageSurface extends StatelessWidget {
  const PageSurface({super.key, required this.child, this.width = 820});
  final Widget child;
  final double width;
  @override
  Widget build(BuildContext context) => ReadingWidth(
    width: width,
    child: Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        border: Border(
          left: BorderSide(color: C.rule),
          right: BorderSide(color: C.rule),
        ),
      ),
      child: Material(color: C.ink2, child: child),
    ),
  );
}

class ByLineMark extends StatelessWidget {
  const ByLineMark({super.key});
  @override
  Widget build(BuildContext context) => FittedBox(
    fit: BoxFit.scaleDown,
    alignment: Alignment.centerLeft,
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.asset(
            'assets/branding/byline-logo.png',
            width: 40,
            height: 40,
            excludeFromSemantics: true,
          ),
        ),
        const SizedBox(width: 12),
        const Text('ByLine', style: T.title),
      ],
    ),
  );
}

class TimeChoice extends StatelessWidget {
  const TimeChoice({super.key, required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String>? onChanged;
  @override
  Widget build(BuildContext context) {
    final parts = value.split(':');
    final time = TimeOfDay(
      hour: int.tryParse(parts.first) ?? 9,
      minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(R.sm),
          onTap: onChanged == null
              ? null
              : () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: time,
                    helpText: 'Choose your delivery time',
                    initialEntryMode: TimePickerEntryMode.input,
                  );
                  if (picked != null) {
                    onChanged!(
                      '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
                    );
                  }
                },
          child: InputDecorator(
            decoration: const InputDecoration(
              labelText: 'Delivery time',
              suffixIcon: Icon(Icons.keyboard_arrow_down),
            ),
            child: Text(time.format(context), style: T.bodyStrong),
          ),
        ),
        const SizedBox(height: 12),
        const Text('Tap to enter any hour and minute.', style: T.small),
      ],
    );
  }
}

class SetupFrame extends StatelessWidget {
  const SetupFrame({super.key, required this.step, required this.child});
  final int step;
  final Widget child;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final form = Card(
        margin: EdgeInsets.all(constraints.maxWidth < 600 ? 12 : 24),
        child: child,
      );
      if (constraints.maxWidth < 900) {
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 660),
            child: form,
          ),
        );
      }
      const labels = [
        'Connect your profile',
        'Choose your interests',
        'Find your voice',
        'Review a sample',
        'Set your delivery',
        'Stay in the loop',
      ];
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1060),
          child: Row(
            children: [
              SizedBox(
                width: 300,
                child: ListView(
                  padding: const EdgeInsets.all(24),
                  children: [
                    const Text('A routine that fits you.', style: T.display),
                    const SizedBox(height: 16),
                    const Text(
                      'A few choices now. A thoughtful post every day.',
                      style: T.body,
                    ),
                    const SizedBox(height: 32),
                    for (var i = 0; i < labels.length; i++)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          radius: 14,
                          backgroundColor: i <= step ? C.filament : C.rule,
                          child: i < step
                              ? const Icon(
                                  Icons.check,
                                  size: 16,
                                  color: C.onFilament,
                                )
                              : Text(
                                  '${i + 1}',
                                  style: T.small.copyWith(
                                    color: i <= step ? C.onFilament : C.paper,
                                  ),
                                ),
                        ),
                        title: Text(
                          labels[i],
                          style: i == step ? T.bodyStrong : T.small,
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(child: form),
            ],
          ),
        ),
      );
    },
  );
}
