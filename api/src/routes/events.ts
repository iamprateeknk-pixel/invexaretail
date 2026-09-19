import { Router, type NextFunction, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import {
  SERVER_EPOCH,
  eventsSince,
  latestEventId,
  publishEvent,
  subscribe,
  subscriberCount,
  type DomainEvent,
} from '../lib/event-bus.js';
import { locationIdsForMutation, topicsForMutation } from '../lib/event-topics.js';

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS_TOTAL = 2000;

const streamsByUser = new Map<string, number>();

function visibleLocationIds(user: NonNullable<Request['user']>): string[] | null {
  if (user.role === 'ADMIN' || user.role === 'ADMIN_USER') return null;
  return user.locationIds ?? [];
}

function frame(event: DomainEvent): string {
  const { id, topic, ...data } = event;
  return `id: ${id}\nevent: ${topic}\ndata: ${JSON.stringify({ id, topic, ...data })}\n\n`;
}

// Runs for every /api/v1 request: once a mutation has actually succeeded
// (2xx), publish a payload-free invalidation event. Events never carry
// business data - clients refetch through the normal role/location-scoped
// endpoints - so a stream can never leak more than "something changed".
export function publishMutationEvents(req: Request, res: Response, next: NextFunction): void {
  const topics = topicsForMutation(req.method, req.path);
  if (!topics.length) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const companyId = req.companyId;
    if (!companyId) return;
    const locationIds = locationIdsForMutation(req.path, req.body);
    for (const topic of topics) {
      publishEvent({
        topic,
        companyId,
        ...(locationIds ? { locationIds } : {}),
        actorId: req.userId ?? req.user?.id,
        requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
      });
    }
  });
  next();
}

const router = Router();

router.get('/events', extractToken, requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const companyId = req.companyId ?? user.companyId;

  if (subscriberCount() >= MAX_STREAMS_TOTAL) {
    res.status(503).json({ message: 'Live updates are at capacity. Retry shortly.' });
    return;
  }
  if ((streamsByUser.get(user.id) ?? 0) >= MAX_STREAMS_PER_USER) {
    res.status(429).json({ message: 'Too many live connections for this user.' });
    return;
  }
  streamsByUser.set(user.id, (streamsByUser.get(user.id) ?? 0) + 1);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx-style proxies (Hostinger, Render) from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const locationIds = visibleLocationIds(user);
  const write = (chunk: string) => { res.write(chunk); };

  write('retry: 3000\n\n');
  write(`event: hello\ndata: ${JSON.stringify({ epoch: SERVER_EPOCH, latestEventId: latestEventId(), serverTime: new Date().toISOString() })}\n\n`);

  const lastHeader = req.header('last-event-id') ?? (typeof req.query.cursor === 'string' ? req.query.cursor : '');
  const clientEpoch = typeof req.query.epoch === 'string' ? req.query.epoch : undefined;
  if (lastHeader !== '' && Number.isFinite(Number(lastHeader))) {
    const replay = eventsSince(Number(lastHeader), { companyId, locationIds }, clientEpoch);
    if (replay.kind === 'reset') {
      write(`event: reset\ndata: ${JSON.stringify({ epoch: SERVER_EPOCH, latestEventId: latestEventId() })}\n\n`);
    } else {
      replay.events.forEach((event) => write(frame(event)));
    }
  }

  const subscription = subscribe({ companyId, userId: user.id, locationIds, send: (event) => write(frame(event)) });
  const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscription.unsubscribe();
    const remaining = (streamsByUser.get(user.id) ?? 1) - 1;
    if (remaining <= 0) streamsByUser.delete(user.id);
    else streamsByUser.set(user.id, remaining);
  };
  // res (not req) 'close': on modern Node, IncomingMessage 'close' fires when
  // the request body is consumed, which for a bodyless GET is immediately.
  res.on('close', cleanup);
  res.on('error', cleanup);
});

export default router;
