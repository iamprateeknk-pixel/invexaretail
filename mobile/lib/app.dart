import 'package:flutter/material.dart';

import 'config/theme.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'state/session_controller.dart';

class InvexaRetailApp extends StatefulWidget {
  const InvexaRetailApp({super.key, required this.controller});

  final SessionController controller;

  @override
  State<InvexaRetailApp> createState() => _InvexaRetailAppState();
}

class _InvexaRetailAppState extends State<InvexaRetailApp> with WidgetsBindingObserver {
  SessionController get controller => widget.controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      controller.resumeLive();
    } else if (state == AppLifecycleState.paused) {
      controller.pauseLive();
    }
  }

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
