import 'package:flutter/material.dart';
import '../api/models.dart';
import 'form_select.dart';

/// The same controls are available during setup and in the saved voice editor.
class WritingPreferences extends StatelessWidget {
  const WritingPreferences({
    super.key,
    required this.value,
    required this.onChanged,
  });
  final StyleConfig value;
  final ValueChanged<StyleConfig>? onChanged;

  @override
  Widget build(BuildContext context) {
    Widget choice(
      String label,
      String selected,
      Map<String, String> options,
      StyleConfig Function(String) update,
    ) => Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: FormSelect<String>(
        label: label,
        value: selected,
        options: options,
        onChanged: onChanged == null ? null : (v) => onChanged!(update(v)),
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        choice('Structure', value.structure, const {
          'prose': 'Paragraphs',
          'bullets': 'Bullets',
          'short-lines': 'Short lines',
          'mixed': 'Lead + bullets',
        }, (v) => value.copyWith(structure: v)),
        choice('Written for', value.register, const {
          'practitioner': 'Specialists',
          'peer': 'Professionals',
          'accessible': 'A broad audience',
        }, (v) => value.copyWith(register: v)),
        choice('Opening line', value.hook, const {
          'plain': 'Calm and clear',
          'sharp': 'Specific and direct',
          'bold': 'Bold and evidence based',
        }, (v) => value.copyWith(hook: v)),
        choice('Closing', value.cta, const {
          'none': 'End on the main point',
          'soft': 'A thoughtful question',
          'direct': 'A clear invitation',
        }, (v) => value.copyWith(cta: v)),
        choice('Emoji', value.emoji, const {
          'none': 'None',
          'sparing': 'Occasional',
          'expressive': 'Expressive',
        }, (v) => value.copyWith(emoji: v)),
        Text('Post length: ${value.minWords}–${value.maxWords} words'),
        RangeSlider(
          values: RangeValues(
            value.minWords.toDouble(),
            value.maxWords.toDouble(),
          ),
          min: 40,
          max: 500,
          divisions: 46,
          labels: RangeLabels(
            '${value.minWords} words',
            '${value.maxWords} words',
          ),
          semanticFormatterCallback: (v) => '${v.round()} words',
          onChanged: onChanged == null
              ? null
              : (v) {
                  final low = v.start.round().clamp(40, 400);
                  final high = v.end.round().clamp(low + 20, 500);
                  onChanged!(value.copyWith(minWords: low, maxWords: high));
                },
        ),
        const SizedBox(height: 12),
        FormSelect<int>(
          label: 'Hashtags',
          value: value.hashtagCount,
          options: {for (var i = 0; i <= 15; i++) i: i == 0 ? 'None' : '$i'},
          onChanged: onChanged == null
              ? null
              : (v) => onChanged!(value.copyWith(hashtagCount: v)),
        ),
        const SizedBox(height: 20),
      ],
    );
  }
}
