import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();

const items = [
  { id: 'item-001', sku: 'SKU-001', name: 'Battery Pack AA', category: 'Electronics', unit_price: 4.99 },
  { id: 'item-002', sku: 'SKU-002', name: 'Water Bottle 1L', category: 'Hydration', unit_price: 19.99 },
  { id: 'item-003', sku: 'SKU-003', name: 'USB Cable Type-C', category: 'Cables', unit_price: 9.99 },
];

router.get('/', (req: Request, res: Response) => res.json({ items }));
router.get('/:id', (req: Request, res: Response) => {
  const item = items.find((i) => i.id === req.params.id);
  res.json(item || { error: 'Not found' });
});
router.post('/', (req: Request, res: Response) => {
  const item = { id: `item-${Date.now()}`, ...req.body };
  items.push(item);
  res.status(201).json(item);
});
router.put('/:id', (req: Request, res: Response) => {
  const item = items.find((i) => i.id === req.params.id);
  if (item) Object.assign(item, req.body);
  res.json(item);
});
router.delete('/:id', (req: Request, res: Response) => {
  const index = items.findIndex((i) => i.id === req.params.id);
  if (index > -1) items.splice(index, 1);
  res.json({ success: true });
});

export default router;
