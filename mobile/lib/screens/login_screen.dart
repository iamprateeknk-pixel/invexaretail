import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/theme.dart';
import '../state/session_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  final _twoFactor = TextEditingController();
  bool _obscure = true;
  bool _useOtp = false;
  bool _otpSent = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _otp.dispose();
    _twoFactor.dispose();
    super.dispose();
  }

  Future<void> _submitPassword() async {
    final email = _email.text.trim();
    final password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      widget.controller.setError('Enter your work email and password.');
      return;
    }
    await widget.controller.login(email, password);
  }

  Future<void> _sendOtp() async {
    final email = _email.text.trim();
    if (email.isEmpty) {
      widget.controller.setError('Enter your work email to receive a code.');
      return;
    }
    final sent = await widget.controller.sendOtp(email);
    if (sent && mounted) {
      setState(() => _otpSent = true);
    }
  }

  Future<void> _verifyOtp() async {
    final email = _email.text.trim();
    final otpCode = _otp.text.trim();
    if (email.isEmpty || otpCode.length != 6) {
      widget.controller.setError('Enter the 6-digit code from your email.');
      return;
    }
    await widget.controller.loginWithOtp(email, otpCode);
  }

  Future<void> _submitTwoFactor() async {
    final code = _twoFactor.text.trim();
    if (code.isEmpty) {
      widget.controller.setError('Enter the code from your authenticator app, or a backup code.');
      return;
    }
    await widget.controller.completeTwoFactor(code);
  }

  Widget _twoFactorStep(SessionController controller) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            const Text('Two-factor check', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: invexaInk)),
            const SizedBox(height: 8),
            const Text(
              'Enter the 6-digit code from your authenticator app, or one of your backup codes.',
              style: TextStyle(fontSize: 15, color: invexaMuted, height: 1.4),
            ),
            const SizedBox(height: 24),
            TextField(
              key: const ValueKey('two-factor-code'),
              controller: _twoFactor,
              autofocus: true,
              autofillHints: const [AutofillHints.oneTimeCode],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submitTwoFactor(),
              decoration: const InputDecoration(labelText: 'Code', hintText: '123456'),
            ),
            if (controller.error != null && (controller.error ?? '').isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(controller.error!, style: const TextStyle(color: invexaRose)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              key: const ValueKey('two-factor-submit'),
              onPressed: controller.busy ? null : _submitTwoFactor,
              child: controller.busy
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Verify and sign in'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: controller.busy
                  ? null
                  : () {
                      _twoFactor.clear();
                      controller.cancelTwoFactor();
                    },
              child: const Text('Use a different account'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;
        if (controller.twoFactorChallenge != null) return _twoFactorStep(controller);
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
              children: [
                const Align(
                  alignment: Alignment.centerLeft,
                  child: CircleAvatar(
                    radius: 28,
                    backgroundColor: Color(0x14059669),
                    child: Icon(Icons.inventory_2_outlined, color: invexaEmerald, size: 28),
                  ),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Invexa Retail',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: invexaInk),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Sign in to count stock, review transfers, and keep the floor moving.',
                  style: TextStyle(fontSize: 15, color: invexaMuted, height: 1.4),
                ),
                const SizedBox(height: 28),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment<bool>(value: false, label: Text('Password')),
                    ButtonSegment<bool>(value: true, label: Text('One-time code')),
                  ],
                  selected: {_useOtp},
                  onSelectionChanged: (next) {
                    setState(() {
                      _useOtp = next.first;
                    });
                    controller.setError('');
                  },
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email, AutofillHints.username],
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'Work email',
                    hintText: 'you@company.com',
                  ),
                ),
                if (!_useOtp) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _password,
                    obscureText: _obscure,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submitPassword(),
                    decoration: InputDecoration(
                      labelText: 'Password',
                      suffixIcon: IconButton(
                        onPressed: () => setState(() => _obscure = !_obscure),
                        icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      ),
                    ),
                  ),
                ] else if (_otpSent) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _otp,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    textInputAction: TextInputAction.done,
                    maxLength: 6,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onSubmitted: (_) => _verifyOtp(),
                    decoration: const InputDecoration(
                      labelText: '6-digit code',
                      hintText: '000000',
                      counterText: '',
                    ),
                  ),
                ],
                if (controller.notice != null && _useOtp) ...[
                  const SizedBox(height: 16),
                  Text(controller.notice!, style: const TextStyle(color: invexaMuted)),
                ],
                if (controller.devOtpCode != null && _useOtp) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Development code: ${controller.devOtpCode}',
                    style: const TextStyle(color: invexaMuted, fontSize: 13),
                  ),
                ],
                if (controller.error != null && (controller.error ?? '').isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(controller.error!, style: const TextStyle(color: invexaRose)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: controller.busy
                      ? null
                      : _useOtp
                          ? (_otpSent ? _verifyOtp : _sendOtp)
                          : _submitPassword,
                  child: controller.busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(_useOtp ? (_otpSent ? 'Verify code' : 'Send code') : 'Sign in'),
                ),
                if (_useOtp && _otpSent) ...[
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: controller.busy ? null : _sendOtp,
                    child: const Text('Resend code'),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
