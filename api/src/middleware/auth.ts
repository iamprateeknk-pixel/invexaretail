import type { NextFunction, Request, Response } from 'express';

import { verifyToken } from '../lib/auth.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authorization token is required.' });
    return;
  }

  try {
    const token = header.replace('Bearer ', '');
    const payload = verifyToken(token);

    req.userId = payload.sub;
    req.companyId = payload.companyId;

    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
