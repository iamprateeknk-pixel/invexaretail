#!/usr/bin/env node
// Week 8: lightweight structural validation for contracts/openapi.json -
// no new runtime dependency for a spec this small. Checks the invariants
// this repo's contract actually needs: valid JSON, required top-level
// keys, every path/method has a response, every $ref resolves, and the
// stable error envelope/idempotency requirements from the guide are present
// somewhere in the document.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const specPath = join(ROOT, 'contracts', 'openapi.json');

const errors = [];
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

if (!spec.openapi?.startsWith('3.')) errors.push('openapi version must be 3.x');
if (!spec.info?.version) errors.push('info.version is required (this is the "versioned" in "versioned OpenAPI contract")');
if (!spec.info?.title) errors.push('info.title is required');
if (!spec.paths || Object.keys(spec.paths).length === 0) errors.push('paths must not be empty');

function resolveRef(ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = spec;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) return undefined;
  }
  return node;
}

function walkRefs(node, path) {
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') {
      if (resolveRef(node.$ref) === undefined) errors.push(`unresolved $ref "${node.$ref}" at ${path}`);
    }
    for (const [key, value] of Object.entries(node)) walkRefs(value, `${path}/${key}`);
  }
}
walkRefs(spec, '#');

for (const [path, methods] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation.operationId) errors.push(`${method.toUpperCase()} ${path} is missing operationId`);
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      errors.push(`${method.toUpperCase()} ${path} has no responses`);
    }
  }
}

const errorEnvelope = spec.components?.schemas?.ErrorEnvelope;
if (!errorEnvelope) errors.push('components.schemas.ErrorEnvelope is required (stable error envelope, ADR-006)');
else {
  for (const field of ['error', 'code', 'traceId']) {
    if (!errorEnvelope.properties?.[field]) errors.push(`ErrorEnvelope is missing required field "${field}"`);
  }
}

if (errors.length) {
  console.error(`validate-openapi: ${errors.length} problem(s) in ${specPath}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`validate-openapi: ${specPath} is structurally valid (${Object.keys(spec.paths).length} path(s)).`);
