import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();
const transfers: any[] = [];

router.get('/', (req: Request, res: Response) => res.json({ transfers }));
router.get('/:id', (req: Request, res: Response) => {
  const transfer = transfers.find((t) => t.id === req.params.id);
  res.json(transfer || { error: 'Not found' });
});
router.post('/', (req: Request, res: Response) => {
  const transfer = {
    id: `tr-${Date.now()}`,
    status: 'created',
    ...req.body,
    created_at: new Date()
  };
  transfers.push(transfer);
  res.status(201).json(transfer);
});
router.put('/:id/status', (req: Request, res: Response) => {
  const transfer = transfers.find((t) => t.id === req.params.id);
  if (transfer) transfer.status = req.body.status;
  res.json(transfer);
});

export default router;
