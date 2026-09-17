import express, { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router: Router = express.Router();

// Demo users for testing
const demoUsers: any = {
  'admin@retailinventory.com': {
    id: 'admin-001',
    password: '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8',
    name: 'Admin User',
    role: 'admin',
  },
  'store@retailinventory.com': {
    id: 'user-001',
    password: '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8',
    name: 'Store User',
    role: 'store_user',
  },
  'picker@retailinventory.com': {
    id: 'picker-001',
    password: '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8',
    name: 'Picker User',
    role: 'warehouse_picker',
  },
  'auditor@retailinventory.com': {
    id: 'auditor-001',
    password: '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8',
    name: 'Auditor User',
    role: 'auditor',
  },
};

// Login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = demoUsers[email];

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // For demo, accept the default password
  if (password !== 'TestPassword123!') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, email, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email,
      name: user.name,
      role: user.role,
    },
  });
});

// Get demo accounts
router.get('/demo-accounts', (req: Request, res: Response) => {
  const accounts = Object.entries(demoUsers).map(([email, user]: [string, any]) => ({
    email,
    password: 'TestPassword123!',
    name: user.name,
    role: user.role,
  }));

  res.json({ accounts });
});

// Verify token
router.post('/verify', (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    res.json({ valid: true, decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
