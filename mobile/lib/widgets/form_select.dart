import 'package:flutter/material.dart';
import '../theme.dart';

/// A labelled form selector, with native keyboard and menu semantics.
class FormSelect<V> extends StatelessWidget {
  const FormSelect({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.label,
    this.hint = 'Choose an option',
  });
  final V? value;
  final Map<V, String> options;
  final ValueChanged<V>? onChanged;
  final String? label;
  final String hint;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<V>(
    key: ValueKey(value),
    initialValue: options.containsKey(value) ? value : null,
    isExpanded: true,
    style: T.body,
    menuMaxHeight: 360,
    decoration: InputDecoration(labelText: label, hintText: hint),
    icon: const Icon(Icons.keyboard_arrow_down),
    items: options.entries
        .map(
          (e) => DropdownMenuItem(
            value: e.key,
            child: Text(e.value, overflow: TextOverflow.ellipsis),
          ),
        )
        .toList(),
    onChanged: onChanged == null
        ? null
        : (v) {
            if (v != null) onChanged!(v);
          },
  );
}

/// Summarized multi-selection opens a searchable checklist. Changes are staged
/// until Apply, so closing the picker never partially changes saved settings.
class MultiSelectField extends StatelessWidget {
  const MultiSelectField({
    super.key,
    required this.label,
    required this.options,
    required this.values,
    required this.onChanged,
    this.min = 1,
    this.max = 99,
  });
  final String label;
  final Map<String, String> options;
  final List<String> values;
  final ValueChanged<List<String>>? onChanged;
  final int min, max;
  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(R.sm),
    onTap: onChanged == null
        ? null
        : () async {
            final result = await showDialog<List<String>>(
              context: context,
              builder: (_) => _SelectionDialog(
                label: label,
                options: options,
                values: values,
                min: min,
                max: max,
              ),
            );
            if (result != null) onChanged?.call(result);
          },
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        enabled: onChanged != null,
        suffixIcon: const Icon(Icons.keyboard_arrow_down),
      ),
      child: Text(
        values.isEmpty
            ? 'Select $label'
            : values.map((v) => options[v] ?? v).join(', '),
        style: T.body,
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
    ),
  );
}

class _SelectionDialog extends StatefulWidget {
  const _SelectionDialog({
    required this.label,
    required this.options,
    required this.values,
    required this.min,
    required this.max,
  });
  final String label;
  final Map<String, String> options;
  final List<String> values;
  final int min, max;
  @override
  State<_SelectionDialog> createState() => _SelectionDialogState();
}

class _SelectionDialogState extends State<_SelectionDialog> {
  late final Set<String> _selected = widget.values.toSet();
  String _query = '';
  @override
  Widget build(BuildContext context) {
    final matches = widget.options.entries
        .where(
          (e) => _query
              .split(RegExp(r'\s+'))
              .every((word) => e.value.toLowerCase().contains(word)),
        )
        .toList();
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: SizedBox(
        width: 480,
        height: MediaQuery.sizeOf(context).height * .78,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.label, style: T.title),
              const SizedBox(height: 16),
              TextField(
                autofocus: MediaQuery.sizeOf(context).width > 700,
                decoration: const InputDecoration(
                  labelText: 'Search options',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (v) =>
                    setState(() => _query = v.toLowerCase().trim()),
              ),
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  '${_selected.length} selected · ${matches.length} results · up to ${widget.max}',
                  style: T.small,
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: matches.isEmpty
                    ? const Center(
                        child: Text('No matching options. Try another search.'),
                      )
                    : ListView.builder(
                        itemCount: matches.length,
                        itemBuilder: (context, index) {
                          final entry = matches[index];
                          final selected = _selected.contains(entry.key);
                          return CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: Text(entry.value, style: T.body),
                            value: selected,
                            onChanged:
                                widget.max != 1 &&
                                    _selected.length >= widget.max &&
                                    !selected
                                ? null
                                : (v) => setState(() {
                                    if (v == true) {
                                      if (widget.max == 1) _selected.clear();
                                      _selected.add(entry.key);
                                    } else {
                                      _selected.remove(entry.key);
                                    }
                                  }),
                          );
                        },
                      ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed:
                        _selected.length >= widget.min &&
                            _selected.length <= widget.max
                        ? () => Navigator.pop(context, _selected.toList())
                        : null,
                    child: const Text('Apply'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
