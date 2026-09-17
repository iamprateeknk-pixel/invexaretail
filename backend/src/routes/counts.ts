import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();
const counts: any[] = [];

router.get('/', (req: Request, res: Response) => res.json({ counts }));
router.post('/', (req: Request, res: Response) => {
  const count = { id: `cnt-${Date.now()}`, status: 'pending', ...req.body, created_at: new Date() };
  counts.push(count);
  res.status(201).json(count);
});
router.put('/:id', (req: Request, res: Response) => {
  const count = counts.find((c) => c.id === req.params.id);
  if (count) Object.assign(count, req.body);
  res.json(count);
});
router.post('/:id/approve', (req: Request, res: Response) => {
  const count = counts.find((c) => c.id === req.params.id);
  if (count) count.status = 'approved';
  res.json(count);
});

export default router;
