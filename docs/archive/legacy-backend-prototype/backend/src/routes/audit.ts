import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();
const logs: any[] = [];

router.get('/', (req: Request, res: Response) => {
  const filtered = logs.slice(0, 100);
  res.json({ logs: filtered, total: logs.length });
});

router.get('/user/:userId', (req: Request, res: Response) => {
  const userLogs = logs.filter((l) => l.user_id === req.params.userId);
  res.json({ logs: userLogs });
});

export const addAuditLog = (userId: string, action: string, entity: string, data: any) => {
  logs.push({
    id: `log-${Date.now()}`,
    user_id: userId,
    action,
    entity_type: entity,
    data,
    created_at: new Date(),
  });
};

export default router;
