"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Side-effect import: keep this the FIRST import of every entrypoint so the
// instrumentations patch http/express before they are loaded.
const telemetry_js_1 = require("./telemetry.js");
(0, telemetry_js_1.startTelemetry)();
