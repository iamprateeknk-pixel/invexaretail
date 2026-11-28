import type { SchemaVersionResult } from './schema-version.js';

/** Keep background jobs from running against a schema this build cannot safely use. */
export function assertWorkerSchemaCurrent(result: SchemaVersionResult): void {
  if (result.ok === false) {
    throw new Error(`Worker refuses to start: ${result.reason}`);
  }
}
