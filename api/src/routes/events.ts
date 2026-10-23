import { Router, type NextFunction, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { SERVER_EPOCH, durableEventsSince, durableLatestEventId, eventsSince, latestEventId, publishEvent, subscribe, subscriberCount, type DomainEvent } from '../lib/event-bus.js';
import { locationIdsForMutation, topicsForMutation } from '../lib/event-topics.js';
import { databaseEnabled } from '../lib/persistence.js';

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS_TOTAL = 2000;
const streamsByUser = new Map<string, number>();
let activeStreams = 0;
function visibleLocationIds(user: NonNullable<Request['user']>): string[] | null { return user.role === 'ADMIN' || user.role === 'ADMIN_USER' ? null : user.locationIds ?? []; }
function frame(event: DomainEvent): string { const { id, topic, ...data } = event; return `id: ${id}\nevent: ${topic}\ndata: ${JSON.stringify({ id, topic, ...data })}\n\n`; }

export function publishMutationEvents(req: Request, res: Response, next: NextFunction): void {
  const topics = topicsForMutation(req.method, req.path);
  if (!topics.length) return next();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.companyId) return;
    const locationIds = locationIdsForMutation(req.path, req.body);
    for (const topic of topics) publishEvent({ topic, companyId: req.companyId, ...(locationIds ? { locationIds } : {}), actorId: req.userId ?? req.user?.id, requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined });
  });
  next();
}

const router = Router();
router.get('/events', extractToken, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const companyId = req.companyId ?? user.companyId;
  // Durable mode has no in-memory subscribers, so subscriberCount() alone would never reach the cap.
  if (Math.max(subscriberCount(), activeStreams) >= MAX_STREAMS_TOTAL) return res.status(503).json({ message: 'Live updates are at capacity. Retry shortly.' });
  if ((streamsByUser.get(user.id) ?? 0) >= MAX_STREAMS_PER_USER) return res.status(429).json({ message: 'Too many live connections for this user.' });
  streamsByUser.set(user.id, (streamsByUser.get(user.id) ?? 0) + 1);
  activeStreams += 1;
  // Registered before the first await: a client that disconnects while the replay queries run must
  // still release its slot and timers, otherwise the per-user cap leaks until the user is locked out.
  let closed = false;
  let heartbeat: NodeJS.Timeout | undefined;
  let durablePoll: NodeJS.Timeout | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  const cleanup = () => {
    if (closed) return; closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (durablePoll) clearInterval(durablePoll);
    subscription?.unsubscribe();
    activeStreams = Math.max(0, activeStreams - 1);
    const remaining = (streamsByUser.get(user.id) ?? 1) - 1;
    if (remaining <= 0) streamsByUser.delete(user.id); else streamsByUser.set(user.id, remaining);
  };
  res.on('close', cleanup); res.on('error', cleanup);
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const locationIds = visibleLocationIds(user);
  const write = (chunk: string) => { if (!closed) res.write(chunk); };
  const durable = databaseEnabled;
  let cursor = 0;
  try {
    write('retry: 3000\n\n');
    const latest = durable ? await durableLatestEventId() : latestEventId();
    write(`event: hello\ndata: ${JSON.stringify({ epoch: SERVER_EPOCH, latestEventId: latest, serverTime: new Date().toISOString() })}\n\n`);
    const lastHeader = req.header('last-event-id') ?? (typeof req.query.cursor === 'string' ? req.query.cursor : '');
    const clientEpoch = typeof req.query.epoch === 'string' ? req.query.epoch : undefined;
    if (lastHeader !== '' && Number.isFinite(Number(lastHeader))) {
      cursor = Number(lastHeader);
      if (durable) {
        // A cursor ahead of the table (database restored/reset) can never be replayed: tell the client to refetch.
        if (cursor > latest) { cursor = latest; write(`event: reset\ndata: ${JSON.stringify({ epoch: SERVER_EPOCH, latestEventId: latest })}\n\n`); }
        else {
          const rows = await durableEventsSince(cursor, { companyId, locationIds });
          rows.forEach((event) => { cursor = event.id; write(frame(event)); });
        }
      } else {
        const replay = eventsSince(cursor, { companyId, locationIds }, clientEpoch);
        if (replay.kind === 'reset') write(`event: reset\ndata: ${JSON.stringify({ epoch: SERVER_EPOCH, latestEventId: latestEventId() })}\n\n`);
        else replay.events.forEach((event) => { cursor = event.id; write(frame(event)); });
      }
    }
  } catch (error) {
    console.error('[events] stream setup failed', error);
    cleanup();
    res.end();
    return;
  }
  if (closed) return;
  subscription = durable ? undefined : subscribe({ companyId, userId: user.id, locationIds, send: (event) => write(frame(event)) });
  let polling = false;
  if (durable) durablePoll = setInterval(() => void (async () => {
    if (polling || closed) return; polling = true;
    try { const rows = await durableEventsSince(cursor, { companyId, locationIds }); rows.forEach((event) => { cursor = event.id; write(frame(event)); }); }
    catch (error) { console.error('[events] durable poll failed', error); }
    finally { polling = false; }
  })(), 1000);
  heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
});
export default router;
