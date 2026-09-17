import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'config/theme.dart';
import 'services/api_client.dart';
import 'services/drift_store.dart';
import 'state/session_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: invexaSurface,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));

  final controller = SessionController(
    api: InvexaApi(),
    store: await DriftStore.open(),
  );
  await controller.restore();
  runApp(InvexaRetailApp(controller: controller));
}
