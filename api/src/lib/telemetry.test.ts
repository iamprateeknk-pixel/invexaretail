import test from 'node:test';
import assert from 'node:assert/strict';
import { startTelemetry, stopTelemetry, telemetryEnabled } from './telemetry.js';

test('telemetry is off unless an OTLP endpoint is configured', () => {
  assert.equal(telemetryEnabled({}), false);
  assert.equal(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }), false);
  assert.equal(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' }), true);
  assert.equal(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'true' }), false);
  assert.equal(startTelemetry({}), false);
});

test('starting and stopping the SDK with an endpoint neither throws nor blocks shutdown', async () => {
  // Nothing listens on this port; export failures are swallowed by the SDK.
  assert.equal(startTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', OTEL_SERVICE_NAME: 'invexa-test' }), true);
  await stopTelemetry();
});
