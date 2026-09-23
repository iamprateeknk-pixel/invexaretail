import { Request, Response, NextFunction } from 'express';

export const auditLog = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.json;

  res.json = function (data) {
    // Log to audit system
    console.log(`[AUDIT] ${req.method} ${req.path} - User: ${(req as any).user?.id} - Status: ${res.statusCode}`);

    return originalSend.call(this, data);
  };

  next();
};
