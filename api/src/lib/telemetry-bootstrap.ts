// Side-effect import: keep this the FIRST import of every entrypoint so the
// instrumentations patch http/express before they are loaded.
import { startTelemetry } from './telemetry.js';

startTelemetry();
