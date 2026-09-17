import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();
const tasks: any[] = [];

router.get('/tasks', (req: Request, res: Response) => res.json({ tasks }));
router.post('/tasks', (req: Request, res: Response) => {
  const task = { id: `task-${Date.now()}`, status: 'pending', ...req.body };
  tasks.push(task);
  res.status(201).json(task);
});
router.post('/:id/complete', (req: Request, res: Response) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (task) {
    task.status = 'completed';
    task.picked_qty = req.body.picked_qty;
  }
  res.json(task);
});

export default router;
