// Phase 6: gzip/deflate for API responses. JSON stock and item lists are large
// and highly repetitive, and the API is reached directly (not only through a
// CDN). Server-sent events must never be compressed: the encoder buffers, so
// events would arrive in bursts instead of live (routes/events.ts also sends
// `Cache-Control: no-transform`, this filter is the explicit second guard).
import compression from 'compression';
import type { Request, Response } from 'express';

export const COMPRESSION_THRESHOLD_BYTES = 1024;

export function shouldCompress(req: Request, res: Response): boolean {
  if (req.headers['x-no-compression']) return false;
  if (String(res.getHeader('Content-Type') ?? '').toLowerCase().startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
}

export const responseCompression = compression({ threshold: COMPRESSION_THRESHOLD_BYTES, filter: shouldCompress });
