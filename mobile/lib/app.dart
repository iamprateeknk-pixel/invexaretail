import 'package:flutter/material.dart';

import 'config/theme.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'state/session_controller.dart';

class InvexaRetailApp extends StatelessWidget {
  const InvexaRetailApp({super.key, required this.controller});

  final SessionController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return MaterialApp(
          title: 'Invexa Retail',
          debugShowCheckedModeBanner: false,
          theme: InvexaTheme.light(),
          home: controller.restoring
              ? const _LaunchScreen()
              : controller.isSignedIn
                  ? HomeShell(controller: controller)
                  : LoginScreen(controller: controller),
        );
      },
    );
  }
}

class _LaunchScreen extends StatelessWidget {
  const _LaunchScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: CircularProgressIndicator(color: invexaEmerald),
      ),
    );
  }
}
