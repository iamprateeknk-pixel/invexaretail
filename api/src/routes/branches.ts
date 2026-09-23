// Week 8: Branch management, migrated from the unmounted routes/foundation.ts
// (dead code with no live equivalent - see docs/route-ownership-matrix.md).
// Thin route -> lib/branch-service.ts, per this week's architecture.
import { type Request, type Response, Router } from 'express';
import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import {
  createBranch,
  updateBranch,
  archiveBranch,
  BranchNotFoundError,
  BranchCodeConflictError,
  BranchHasActiveWorkError,
} from '../lib/branch-service.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

const ADMIN_ROLES = ['ADMIN', 'ADMIN_USER'];
function requireAdmin(req: Request, res: Response): boolean {
  if (!ADMIN_ROLES.includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

router.get('/branches', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' }, include: { locations: true } });
  return res.json({ branches });
});

router.post('/branches', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!code || !name) return res.status(400).json({ message: 'Branch code and name are required.' });

  try {
    const branch = await createBranch({
      code, name, type: req.body.type, address: req.body.address, phone: req.body.phone,
      email: req.body.email, managerId: req.body.managerId, workingHours: req.body.workingHours,
    });
    return res.status(201).json({ branch });
  } catch (error) {
    if (error instanceof BranchCodeConflictError) return res.status(409).json({ message: error.message });
    throw error;
  }
});

router.patch('/branches/:id', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { code: _ignoredCode, ...rest } = req.body;
    const branch = await updateBranch(firstParam(req.params.id), rest);
    return res.json({ branch });
  } catch (error) {
    if (error instanceof BranchNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
});

router.post('/branches/:id/archive', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const branch = await archiveBranch(firstParam(req.params.id));
    return res.json({ branch });
  } catch (error) {
    if (error instanceof BranchNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof BranchHasActiveWorkError) return res.status(409).json({ message: error.message, blockers: error.blockers });
    throw error;
  }
});

export default router;
