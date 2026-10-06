// Plan P0-SYNC-003 / "exactly-once replay contract": a client that creates a
// stable `X-Mutation-Id` once, at the moment the person acts, and reuses it on
// every retry (including after a crash or restart) can never cause the business
// side effect twice, whichever endpoint it hit.
//
// Per (company, user, mutation id) the first request is claimed atomically and
// runs; its successful (2xx) response is stored. A retry with the same id and
// the same request returns that stored response with `Idempotent-Replay: true`
// and does NOT run the handler again. A concurrent duplicate gets 409
// MUTATION_IN_PROGRESS with Retry-After. A reused id for a different request is
// 422 MUTATION_ID_REUSED. Failed (non-2xx) attempts release the claim so a retry
// runs normally. Business services keep their own idempotency (posting keys,
// requestId) as defence in depth; this is the uniform outer contract.
//
// Postgres in database mode (shared across replicas), memory otherwise.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

export const MUTATION_ID_HEADER = 'x-mutation-id';
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_STORED_BODY_BYTES = 64 * 1024;
export const STALE_IN_PROGRESS_MS = 5 * 60 * 1000;
export const RECEIPT_RETENTION_DAYS = 7;

type Receipt = { fingerprint: string; state: 'IN_PROGRESS' | 'DONE'; statusCode: number | null; responseBody: string | null; createdAt: number };
const memory = new Map<string, Receipt>();
const memoryKey = (companyId: string, userId: string, mutationId: string) => `${companyId}|${userId}|${mutationId}`;

export function fingerprintRequest(req: Pick<Request, 'method' | 'originalUrl' | 'body'>): string {
  const body = req.body && Object.keys(req.body as object).length ? JSON.stringify(req.body) : '';
  return crypto.createHash('sha256').update(`${req.method} ${req.originalUrl.split('?')[0]}\n${body}`).digest('hex');
}

async function claim(companyId: string, userId: string, mutationId: string, fingerprint: string, now: number): Promise<{ claimed: true } | { claimed: false; receipt: Receipt }> {
  if (databaseEnabled) {
    // skipDuplicates: losing the race is the normal retry path, so it must not raise (or log) a
    // unique-violation error; count 1 means this request owns the claim.
    const created = await prisma.mutationReceipt.createMany({ data: [{ companyId, userId, mutationId, fingerprint, state: 'IN_PROGRESS' }], skipDuplicates: true });
    if (created.count === 1) return { claimed: true };
    const row = await prisma.mutationReceipt.findUnique({ where: { companyId_userId_mutationId: { companyId, userId, mutationId } } });
    if (!row) return claim(companyId, userId, mutationId, fingerprint, now); // released between the two calls
    const receipt: Receipt = { fingerprint: row.fingerprint, state: row.state as Receipt['state'], statusCode: row.statusCode, responseBody: row.responseBody, createdAt: row.createdAt.getTime() };
    if (receipt.state === 'IN_PROGRESS' && now - receipt.createdAt > STALE_IN_PROGRESS_MS) {
      // A crashed process left it half-claimed: take it over, atomically.
      const taken = await prisma.mutationReceipt.updateMany({ where: { id: row.id, state: 'IN_PROGRESS', createdAt: row.createdAt }, data: { createdAt: new Date(now), fingerprint } });
      if (taken.count === 1) return { claimed: true };
    }
    return { claimed: false, receipt };
  }
  const key = memoryKey(companyId, userId, mutationId);
  const existing = memory.get(key);
  if (!existing) {
    memory.set(key, { fingerprint, state: 'IN_PROGRESS', statusCode: null, responseBody: null, createdAt: now });
    return { claimed: true };
  }
  if (existing.state === 'IN_PROGRESS' && now - existing.createdAt > STALE_IN_PROGRESS_MS) {
    memory.set(key, { fingerprint, state: 'IN_PROGRESS', statusCode: null, responseBody: null, createdAt: now });
    return { claimed: true };
  }
  return { claimed: false, receipt: existing };
}

async function complete(companyId: string, userId: string, mutationId: string, statusCode: number, responseBody: string | null): Promise<void> {
  if (databaseEnabled) {
    await prisma.mutationReceipt.updateMany({ where: { companyId, userId, mutationId }, data: { state: 'DONE', statusCode, responseBody } });
    return;
  }
  const existing = memory.get(memoryKey(companyId, userId, mutationId));
  if (existing) Object.assign(existing, { state: 'DONE', statusCode, responseBody });
}

async function release(companyId: string, userId: string, mutationId: string): Promise<void> {
  if (databaseEnabled) {
    await prisma.mutationReceipt.deleteMany({ where: { companyId, userId, mutationId, state: 'IN_PROGRESS' } });
    return;
  }
  const key = memoryKey(companyId, userId, mutationId);
  if (memory.get(key)?.state === 'IN_PROGRESS') memory.delete(key);
}

/** Express middleware. Mount after authentication has set req.userId / req.companyId. */
export function mutationIdempotency(now: () => number = Date.now) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const raw = req.headers[MUTATION_ID_HEADER];
    if (raw === undefined) return next();
    const mutationId = Array.isArray(raw) ? raw[0] : raw;
    if (!ID_PATTERN.test(mutationId)) {
      return res.status(400).json({ message: 'X-Mutation-Id must be 8-128 characters of letters, digits and . _ : -', code: 'MUTATION_ID_INVALID' });
    }
    const userId = req.userId;
    const companyId = req.companyId;
    if (!userId || !companyId) return next(); // unauthenticated: the auth layer rejects it, nothing to remember

    try {
      const fingerprint = fingerprintRequest(req);
      const result = await claim(companyId, userId, mutationId, fingerprint, now());
      if (result.claimed === false) {
        const { receipt } = result;
        if (receipt.fingerprint !== fingerprint) {
          return res.status(422).json({ message: 'This mutation id was already used for a different request.', code: 'MUTATION_ID_REUSED' });
        }
        if (receipt.state === 'IN_PROGRESS') {
          res.setHeader('Retry-After', '2');
          return res.status(409).json({ message: 'This request is still being processed. Retry shortly.', code: 'MUTATION_IN_PROGRESS' });
        }
        res.setHeader('Idempotent-Replay', 'true');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(receipt.statusCode ?? 200);
        return res.send(receipt.responseBody ?? JSON.stringify({ duplicate: true, mutationId }));
      }

      // We own the claim: run the handler and remember a successful result.
      let captured: string | null = null;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        const task = res.statusCode >= 200 && res.statusCode < 300 ? complete(companyId, userId, mutationId, res.statusCode, captured) : release(companyId, userId, mutationId);
        task.catch((error) => console.error('mutation receipt update failed:', error instanceof Error ? error.message : error));
      };
      const originalJson = res.json.bind(res);
      res.json = ((body?: unknown) => {
        try {
          const text = JSON.stringify(body);
          captured = text !== undefined && Buffer.byteLength(text) <= MAX_STORED_BODY_BYTES ? text : null;
        } catch {
          captured = null;
        }
        const out = originalJson(body);
        // Settle here as well as on 'finish': if the client hung up first, 'finish' may never
        // fire even though the work was done, and the result must still be remembered.
        settle();
        return out;
      }) as Response['json'];
      res.on('finish', settle);
      return next();
    } catch (error) {
      console.error('mutation idempotency failed:', error instanceof Error ? error.message : error);
      return next(); // never block a business request because the receipt store hiccuped
    }
  };
}

export async function pruneMutationReceipts(olderThanDays = RECEIPT_RETENTION_DAYS, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - olderThanDays * 86_400_000);
  if (databaseEnabled) return (await prisma.mutationReceipt.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  let removed = 0;
  for (const [key, receipt] of memory) {
    if (receipt.createdAt < cutoff.getTime()) { memory.delete(key); removed += 1; }
  }
  return removed;
}

export function resetMutationReceiptsForTests(): void {
  memory.clear();
}
