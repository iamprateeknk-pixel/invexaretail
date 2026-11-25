import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'config/env.dart';
import 'config/theme.dart';
import 'services/api_client.dart';
import 'services/drift_store.dart';
import 'services/secure_store.dart';
import 'state/session_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: invexaSurface,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));

  late final String apiBase;
  try {
    apiBase = apiBaseFromEnvironment();
    workspaceFromEnvironment();
  } on StateError catch (error) {
    runApp(MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('Invexa Retail')),
        body: Center(child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('This build cannot connect. ${error.message}', textAlign: TextAlign.center),
        )),
      ),
    ));
    return;
  }

  final controller = SessionController(
    api: InvexaApi(baseUrl: apiBase),
    store: await _openStore(apiBase),
  );
  await controller.restore();
  runApp(InvexaRetailApp(controller: controller));
}

Future<SecureLocalStore> _openStore(String apiBase) async {
  final scope = localStorageScope(environmentFromDefines(), apiBase);
  return SecureLocalStore(await DriftStore.open(scope: scope), PlatformSessionVault(scope: scope));
}
