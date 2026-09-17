import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();

const stock = [
  { id: 'stock-001', location_id: 'loc-001', item_id: 'item-001', quantity_physical: 240, quantity_book: 250, variance: -10 },
  { id: 'stock-002', location_id: 'loc-001', item_id: 'item-002', quantity_physical: 45, quantity_book: 50, variance: -5 },
  { id: 'stock-003', location_id: 'loc-002', item_id: 'item-001', quantity_physical: 120, quantity_book: 100, variance: 20 },
];

router.get('/', (req: Request, res: Response) => res.json({ stock }));
router.get('/location/:locationId', (req: Request, res: Response) => {
  const locationStock = stock.filter((s) => s.location_id === req.params.locationId);
  res.json({ stock: locationStock });
});
router.post('/', (req: Request, res: Response) => {
  const item = { id: `stock-${Date.now()}`, ...req.body };
  stock.push(item);
  res.status(201).json(item);
});

export default router;
