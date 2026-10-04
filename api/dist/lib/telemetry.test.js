"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const telemetry_js_1 = require("./telemetry.js");
(0, node_test_1.default)('telemetry is off unless an OTLP endpoint is configured', () => {
    strict_1.default.equal((0, telemetry_js_1.telemetryEnabled)({}), false);
    strict_1.default.equal((0, telemetry_js_1.telemetryEnabled)({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }), false);
    strict_1.default.equal((0, telemetry_js_1.telemetryEnabled)({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' }), true);
    strict_1.default.equal((0, telemetry_js_1.telemetryEnabled)({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'true' }), false);
    strict_1.default.equal((0, telemetry_js_1.startTelemetry)({}), false);
});
(0, node_test_1.default)('starting and stopping the SDK with an endpoint neither throws nor blocks shutdown', async () => {
    // Nothing listens on this port; export failures are swallowed by the SDK.
    strict_1.default.equal((0, telemetry_js_1.startTelemetry)({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', OTEL_SERVICE_NAME: 'invexa-test' }), true);
    await (0, telemetry_js_1.stopTelemetry)();
});
