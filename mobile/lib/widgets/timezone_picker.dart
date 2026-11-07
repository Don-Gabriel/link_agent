import 'package:flutter/material.dart';
import '../theme.dart';
import '../timezones.dart';

Future<String?> showTimezonePicker(
  BuildContext context, {
  required String value,
}) => showDialog<String>(
  context: context,
  builder: (_) => _TimezoneDialog(value: value),
);

/// A selection control: the keyboard only edits the picker's search query.
class ZoneField extends StatelessWidget {
  const ZoneField({
    super.key,
    required this.controller,
    this.enabled = true,
    this.onChanged,
  });
  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(
    BuildContext context,
  ) => ValueListenableBuilder<TextEditingValue>(
    valueListenable: controller,
    builder: (context, value, _) => Semantics(
      button: true,
      enabled: enabled,
      child: InkWell(
        borderRadius: BorderRadius.circular(R.sm),
        onTap: !enabled
            ? null
            : () async {
                final picked = await showTimezonePicker(
                  context,
                  value: value.text,
                );
                if (!context.mounted || picked == null) return;
                controller.text = picked;
                onChanged?.call(picked);
              },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: 'Timezone',
            enabled: enabled,
            helperText:
                'Choose a city or region. Daylight saving adjusts automatically.',
            helperMaxLines: 3,
            suffixIcon: const Icon(Icons.keyboard_arrow_down),
          ),
          child: Text(
            '${Timezones.label(value.text)}\n${Timezones.offset(value.text)}',
            style: T.body,
          ),
        ),
      ),
    ),
  );
}

class _TimezoneDialog extends StatefulWidget {
  const _TimezoneDialog({required this.value});
  final String value;
  @override
  State<_TimezoneDialog> createState() => _TimezoneDialogState();
}

class _TimezoneDialogState extends State<_TimezoneDialog> {
  final _search = TextEditingController();
  late String _selected = widget.value;
  late final _options = {
    ...Timezones.all,
    if (widget.value.isNotEmpty) widget.value,
  }.toList()..sort();
  late final _offsets = {for (final id in _options) id: Timezones.offset(id)};
  String? _device;
  bool _detecting = true;

  @override
  void initState() {
    super.initState();
    Timezones.device().then((value) {
      if (mounted) {
        setState(() {
          _device = value;
          _detecting = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final terms = _search.text
        .toLowerCase()
        .replaceAll('_', ' ')
        .trim()
        .split(RegExp(r'\s+'));
    final matches = _options.where((id) {
      final text =
          '${id.replaceAll('_', ' ')} ${Timezones.label(id)} ${_offsets[id]}'
              .toLowerCase();
      return terms.every(text.contains);
    }).toList();
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: SizedBox(
        width: 540,
        height: MediaQuery.sizeOf(context).height * .85,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Choose timezone', style: T.title),
              const SizedBox(height: 12),
              TextField(
                controller: _search,
                autofocus: MediaQuery.sizeOf(context).width > 700,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Search timezones',
                  hintText: 'City, region or UTC offset',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(_search.clear),
                        ),
                ),
              ),
              if (MediaQuery.viewInsetsOf(context).bottom == 0) ...[
                if (_device != null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.my_location_outlined),
                    title: const Text('Use device timezone'),
                    subtitle: Text(
                      '${Timezones.label(_device!)} · ${_offsets[_device]}',
                    ),
                    onTap: () => setState(() => _selected = _device!),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      _detecting
                          ? 'Checking device timezone…'
                          : 'Device timezone unavailable. Choose from the list.',
                      style: T.small,
                    ),
                  ),
                Text(
                  'Selected: ${Timezones.label(_selected)}',
                  style: T.small,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
              ],
              Semantics(
                liveRegion: true,
                child: Text(
                  '${matches.length} timezones · current UTC offsets',
                  style: T.micro,
                ),
              ),
              const Divider(),
              Expanded(
                child: matches.isEmpty
                    ? const Center(
                        child: Text(
                          'No matching timezones. Try a city such as Kolkata or London.',
                        ),
                      )
                    : ListView.builder(
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        itemCount: matches.length,
                        itemBuilder: (context, index) {
                          final id = matches[index];
                          return ListTile(
                            key: ValueKey('timezone:$id'),
                            selected: id == _selected,
                            title: Text(Timezones.label(id)),
                            subtitle: Text('${_offsets[id]} · $id'),
                            trailing: id == _selected
                                ? const Icon(Icons.check)
                                : null,
                            onTap: () => setState(() => _selected = id),
                          );
                        },
                      ),
              ),
              const Divider(),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _selected.isEmpty
                        ? null
                        : () => Navigator.pop(context, _selected),
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
