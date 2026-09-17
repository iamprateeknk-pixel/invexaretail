import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();

// Mock data
const locations = [
  { id: 'loc-001', name: 'Main Warehouse', type: 'warehouse', city: 'New York', status: 'active' },
  { id: 'loc-002', name: 'Store #42', type: 'store', city: 'Los Angeles', status: 'active' },
  { id: 'loc-003', name: 'Distribution Center', type: 'distribution', city: 'Chicago', status: 'active' },
];

// Get all locations
router.get('/', (req: Request, res: Response) => {
  res.json({ locations });
});

// Get location by ID
router.get('/:id', (req: Request, res: Response) => {
  const location = locations.find((l) => l.id === req.params.id);
  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }
  res.json(location);
});

// Create location
router.post('/', (req: Request, res: Response) => {
  const { name, type, address, city } = req.body;
  const location = { id: `loc-${Date.now()}`, name, type, city, status: 'active' };
  locations.push(location);
  res.status(201).json(location);
});

// Update location
router.put('/:id', (req: Request, res: Response) => {
  const location = locations.find((l) => l.id === req.params.id);
  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }
  Object.assign(location, req.body);
  res.json(location);
});

// Delete location
router.delete('/:id', (req: Request, res: Response) => {
  const index = locations.findIndex((l) => l.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Location not found' });
  }
  locations.splice(index, 1);
  res.json({ success: true });
});

export default router;
