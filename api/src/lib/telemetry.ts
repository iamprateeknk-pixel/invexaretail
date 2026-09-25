// Week 19: OpenTelemetry tracing, opt-in. With OTEL_EXPORTER_OTLP_ENDPOINT unset
// (local dev, tests, the default deploy) nothing is loaded and there is zero
// runtime cost. With it set, HTTP and Express spans are exported over OTLP so
// a request can be followed from the edge through the API. Must be imported
// before express/http are first required (see the first import in index.ts and
// worker.ts). Never puts request bodies, tokens or user data on a span.

type Sdk = { start(): void; shutdown(): Promise<void> };

let sdk: Sdk | null = null;

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) && env.OTEL_SDK_DISABLED !== 'true';
}

export function startTelemetry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (sdk || !telemetryEnabled(env)) return sdk !== null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const started: Sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME || 'invexa-api',
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
    });
    started.start();
    sdk = started;
    return true;
  } catch (error) {
    // Observability must never take the API down.
    console.warn('[telemetry] disabled: failed to start OpenTelemetry', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function stopTelemetry(): Promise<void> {
  const active = sdk;
  sdk = null;
  if (active) await active.shutdown().catch(() => undefined);
}
