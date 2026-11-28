import 'dart:async';

import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../config/web_surfaces.dart';
import '../models/models.dart';
import '../state/session_controller.dart';
import 'desktop_web_screen.dart';

/// The Control Panel tab (Windows, ADMIN only). The panel is platform administration, so a company
/// ADMIN is never signed in to it on its role alone. Instead the person links their platform account
/// once - by typing its email and password here, which the server checks together with this app
/// session - and from then on the tab opens already signed in. Unlinking puts the normal platform
/// sign-in back. The server re-checks on every open that this user is still an active ADMIN.
class ControlPanelTab extends StatefulWidget {
  const ControlPanelTab({super.key, required this.controller, required this.sessionKey});

  final SessionController controller;
  final String sessionKey;

  @override
  State<ControlPanelTab> createState() => _ControlPanelTabState();
}

class _ControlPanelTabState extends State<ControlPanelTab> {
  bool? _linked;
  // A new value rebuilds the web view, so linking or unlinking takes effect at once.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_checkLink());
  }

  Future<void> _checkLink() async {
    bool linked;
    try {
      linked = await widget.controller.api.controlPanelLinked();
    } on ApiException {
      linked = false;
    }
    if (mounted) setState(() => _linked = linked);
  }

  Future<void> _link() async {
    final linked = await showDialog<bool>(
      context: context,
      builder: (_) => _LinkDialog(controller: widget.controller),
    );
    if (linked == true && mounted) {
      setState(() {
        _linked = true;
        _generation++;
      });
    }
  }

  Future<void> _unlink() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Unlink the Control Panel?'),
        content: const Text('The Control Panel will ask for the platform email and password again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Unlink')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.controller.api.unlinkControlPanel();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(err.message)));
      return;
    }
    if (mounted) {
      setState(() {
        _linked = false;
        _generation++;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final linked = _linked;
    if (linked == null) return const Center(child: CircularProgressIndicator());
    final api = widget.controller.api;
    return Column(children: [
      Material(
        color: linked ? invexaEmerald.withValues(alpha: 0.10) : invexaSurface,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(children: [
            Icon(linked ? Icons.link : Icons.link_off, color: linked ? invexaEmerald : invexaMuted, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                linked
                    ? 'Opens signed in through your linked platform account.'
                    : 'Link your platform account once and the Control Panel opens directly from now on.',
              ),
            ),
            if (linked)
              TextButton(key: const ValueKey('control-unlink'), onPressed: _unlink, child: const Text('Unlink'))
            else
              FilledButton.tonal(key: const ValueKey('control-link'), onPressed: _link, child: const Text('Link account')),
          ]),
        ),
      ),
      Expanded(
        child: DesktopWebView(
          key: ValueKey('control-${widget.sessionKey}-$_generation'),
          sessionKey: widget.sessionKey,
          trustedHosts: controlPanelHosts,
          resolveTarget: () async => linked ? controlPanelUri(api.controlPanelHandoffCode) : Uri.parse(controlPanelOrigin),
        ),
      ),
    ]);
  }
}

class _LinkDialog extends StatefulWidget {
  const _LinkDialog({required this.controller});

  final SessionController controller;

  @override
  State<_LinkDialog> createState() => _LinkDialogState();
}

class _LinkDialogState extends State<_LinkDialog> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (email.isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter the platform email and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.api.linkControlPanel(email, _password.text);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = err.message;
        });
      }
    } finally {
      _password.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Link the Control Panel'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Sign in once with the platform administrator account. It is linked to you only, '
              'and works only while you are an ADMIN.'),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('control-link-email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            decoration: const InputDecoration(labelText: 'Platform email'),
          ),
          TextField(
            key: const ValueKey('control-link-password'),
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Platform password'),
            onSubmitted: (_) => _busy ? null : _submit(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: invexaRose)),
          ],
        ]),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(key: const ValueKey('control-link-submit'), onPressed: _busy ? null : _submit, child: const Text('Link')),
      ],
    );
  }
}
