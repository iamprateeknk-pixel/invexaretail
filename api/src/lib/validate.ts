// [ULTRA] P3 (#186): the one `validate(schema)` middleware, plus the
// `parseBody` helper for the handlers whose shape check must run AFTER
// an entity/tenant/role guard (a middleware runs before the handler, so
// it cannot sit behind those guards — see the call sites).
//
// Rules, all chosen for validation parity (no accepted/rejected boundary
// moves — see lib/validation-schemas.ts):
// - A failure is always the single ADR-006 envelope with 400 and code
//   VALIDATION_FAILED: `{ error: 'Validation failed.', code,
//   traceId, details: [{ path, message }] }`. The per-field message is
//   the exact message the hand-rolled check used to send, so a client
//   that matched on text can match on `details[].message` instead.
// - On success the parsed data is MERGED into req.body
//   (`{ ...req.body, ...parsed }`), never replaced: fields the schema
//   does not model pass through untouched, exactly as today. Schemas
//   are deliberately not `.strict()` — an extra field the handler
//   ignores today is still ignored, not newly rejected.
// - Coercion mirrors each handler's own `Number(...)` calls: a field
//   the handler coerces uses `z.coerce.number()`; a field the handler
//   checks with `Number.isFinite` on the raw value uses `z.number()`.
//   Where the handler treats ''/null as invalid, the schema's
//   `requiredNumber` preprocess maps them to `undefined` first (plain
//   `z.coerce.number()` would turn ''/null into 0 and accept them).
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { sendError, type ValidationIssue } from './errors.js';

export function validationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(body)',
    message: issue.message,
  }));
}

/**
 * Validate `req.body` against a zod schema. On failure sends the 400
 * envelope and returns null (the caller returns immediately); on
 * success merges the parsed data into `req.body` and returns it.
 */
export function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  res: Response,
  schema: T,
): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    sendError(res, 400, 'VALIDATION_FAILED', 'Validation failed.', {
      details: validationIssues(result.error),
    });
    return null;
  }
  if (result.data !== null && typeof result.data === 'object') {
    req.body = { ...(req.body ?? {}), ...result.data };
  }
  return result.data;
}

/**
 * Express middleware form of `parseBody`: `router.post(path,
 * validate(schema), handler)`. Use it only where no entity/tenant/role
 * guard must run before the shape check — for those routes call
 * `parseBody` inside the handler at the exact point the hand-rolled
 * check used to run.
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (parseBody(req, res, schema) !== null) next();
  };
}
