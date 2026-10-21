// Identity & organisation routes for core (Phase 4): permissions,
// users, locations, industries, workspace profile and company
// profile. Extracted verbatim from core.ts; the composer mounts
// this router at the cluster's original registration position.
import { type Request, type Response, Router } from 'express';
import { requireAuth } from './enterprise-auth.js';
import * as enterpriseRepo from '../lib/enterprise-repository.js';
import { hashPassword, validatePassword } from '../lib/otp-auth.js';
import { isKnownDefaultPassword } from '../lib/production-guard.js';
import { revokeAllSessionsForUser } from '../lib/session-store.js';
import { DEFAULT_COMPANY_ID, registerLocationCompany } from '../lib/saas/tenant-scope.js';
import { hiddenNavigationForCompany } from '../lib/saas/entitlements.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import { canAccessLocation, type Role } from '../lib/inventory.js';
import { canManageCountWork, isCountWorkerRole } from '../lib/count-lifecycle.js';
import { findUserById, listUsers, locations, saveCompanyProfile, users, type LocationRecord, type UserRecord } from '../lib/repository.js';
import { databaseEnabled, persistCompanyProfile, persistLocationCreate, persistLocationDelete, persistLocationUpdate, persistUserCreate, persistUserDelete, persistUserUpdate } from '../lib/persistence.js';
import { applyIndustryPack, getActiveWorkflow, getIndustryPack, listIndustryCatalog, resolveIndustryKey, toWorkspacePackView } from '../lib/industry-packs.js';
import { prisma } from '../lib/db.js';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '../lib/access-control.js';
import { listLocationsForCompany } from '../lib/repositories/location-repository.js';
import { accessContext, tenantContext, firstParam, VALID_ROLES, EMAIL_PATTERN, requireAdmin, companyProfileFor } from './core-shared.js';

const router = Router();

router.get('/permissions/catalog', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can view the permission catalog.' });
  return res.json({ modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS });
});

router.get('/users/:userId/permissions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can view user permissions.' });
  if (!databaseEnabled) return res.json({ permissions: [] });
  const userId = firstParam(req.params.userId);
  // Another company's user looks exactly like a missing one.
  const subject = await prisma.user.findFirst({ where: { id: userId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true } });
  if (!subject) return res.status(404).json({ message: 'User not found.' });
  const permissions = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: { select: { module: true, action: true, description: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return res.json({ permissions });
});

router.put('/users/:userId/permissions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can change user permissions.' });
  const userId = firstParam(req.params.userId);
  if (userId === req.user!.id) return res.status(400).json({ message: 'Main Admin permissions cannot be restricted.' });
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!target) return res.status(404).json({ message: 'User not found.' });
  if (target.role === 'ADMIN') return res.status(400).json({ message: 'Another Main Admin cannot be restricted here.' });
  const entries = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  if (entries.length > 200) return res.status(400).json({ message: 'Too many permission entries.' });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });
      for (const entry of entries) {
        const module = String(entry.module ?? '').toUpperCase();
        const action = String(entry.action ?? '').toUpperCase();
        if (!PERMISSION_MODULES.includes(module as any) || !PERMISSION_ACTIONS.includes(action as any)) throw new Error(`Invalid permission ${module} ${action}.`);
        const permission = await tx.permission.upsert({
          where: { module_action: { module, action: action as any } },
          create: { module, action: action as any, description: `${module} ${action}` },
          update: {},
        });
        await tx.userPermission.create({ data: {
          userId, permissionId: permission.id,
          allowed: Boolean(entry.allowed) && !Boolean(entry.denied),
          denied: Boolean(entry.denied),
          scopeId: typeof entry.scopeId === 'string' && entry.scopeId ? entry.scopeId : null,
          scopeType: entry.scopeId ? 'LOCATION' : null,
          reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 191) : null,
        } });
      }
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'USER_PERMISSIONS_REPLACED',
        entityType: 'User', entityId: userId, metadata: { entryCount: entries.length },
      } });
    });
    return res.json({ success: true, userId, permissionCount: entries.length });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save permissions.' });
  }
});

// Gives a user the exact same function-level access as another user in one action (e.g. a
// warehouse picker who should work like a specific store user, or the other way round) instead of
// replaying the same checkbox grid by hand. Copies the SOURCE user's current UserPermission rows
// onto the TARGET verbatim; it does not touch either user's base role - an admin still changes that
// separately via PUT /users/:userId if the roles themselves should also match.
router.post('/users/:userId/permissions/copy-from/:sourceUserId', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can change user permissions.' });
  if (!databaseEnabled) return res.status(501).json({ message: 'Permission overrides require a connected database.' });
  const userId = firstParam(req.params.userId);
  const sourceUserId = firstParam(req.params.sourceUserId);
  if (userId === req.user!.id) return res.status(400).json({ message: 'Main Admin permissions cannot be restricted.' });
  if (userId === sourceUserId) return res.status(400).json({ message: 'Choose a different user to copy from.' });
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const [target, source] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, companyId } }),
    prisma.user.findFirst({ where: { id: sourceUserId, companyId } }),
  ]);
  if (!target || !source) return res.status(404).json({ message: 'User not found.' });
  if (target.role === 'ADMIN') return res.status(400).json({ message: 'Another Main Admin cannot be restricted here.' });
  try {
    const sourcePermissions = await prisma.userPermission.findMany({ where: { userId: sourceUserId } });
    await prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });
      for (const row of sourcePermissions) {
        await tx.userPermission.create({ data: {
          userId, permissionId: row.permissionId, allowed: row.allowed, denied: row.denied,
          scopeId: row.scopeId, scopeType: row.scopeType, reason: row.reason,
        } });
      }
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'USER_PERMISSIONS_COPIED',
        entityType: 'User', entityId: userId, metadata: { sourceUserId, permissionCount: sourcePermissions.length },
      } });
    });
    return res.json({ success: true, userId, permissionCount: sourcePermissions.length });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to copy permissions.' });
  }
});

// ============================================
// USERS & LOCATIONS
// ============================================

router.get('/users', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can list users.' });
  }
  const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
  const context = accessContext(req.user!);
  const filtered = listUsers().filter((user) => {
    if (req.companyId) {
      const tenantUser = enterpriseRepo.findUserById(user.id);
      if ((tenantUser?.companyId ?? DEFAULT_COMPANY_ID) !== req.companyId) return false;
    }
    if (roleFilter && user.role !== roleFilter) return false;
    if (context.role !== 'BRANCH_MANAGER') return true;
    return isCountWorkerRole(user.role)
      && user.assignedLocationIds.some((locationId) => canAccessLocation(context, locationId));
  });
  return res.json({
    users: filtered.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      assignedLocationIds: user.assignedLocationIds,
    })),
  });
});

// Database-first slice 1: read through the scoped location repository (Postgres in database mode).
router.get('/locations', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const visible = (await listLocationsForCompany(tenantContext(req))).filter((location) => canAccessLocation(context, location.id));

  return res.json({ locations: visible, activeLocationId: visible[0]?.id ?? null });
});

// ============================================
// ADMIN PORTAL: company profile, locations, users
// ============================================

router.get('/industries', (_req: Request, res: Response) => {
  return res.json({
    industries: listIndustryCatalog().map((pack) => ({
      key: pack.key,
      label: pack.label,
      description: pack.description,
      allocationStrategy: pack.allocationStrategy,
      expiryBlocking: pack.expiryBlocking,
      hide: pack.hide,
      dashboardKpis: pack.dashboardKpis,
    })),
  });
});

router.get('/workspace/profile', (req: Request, res: Response) => {
  const companyId = req.companyId || DEFAULT_COMPANY_ID;
  const company = companyProfileFor(companyId);
  const pack = getIndustryPack(company.industryKey ?? company.industry);
  const view = toWorkspacePackView(pack);
  return res.json({
    name: company.name,
    industry: company.industry ?? pack.label,
    industryKey: pack.key,
    pack: {
      ...view,
      hide: [...new Set([...view.hide, ...hiddenNavigationForCompany(companyId)])],
    },
    workflow: getActiveWorkflow(companyId),
  });
});

router.get('/runtime/config', (req: Request, res: Response) => {
  const companyId = req.companyId || DEFAULT_COMPANY_ID;
  const role = req.user?.role ?? 'ADMIN';
  return res.json({ success: true, runtime: controlPlane.runtimeConfig(companyId, role) });
});

router.get('/company', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const company = companyProfileFor(req.companyId ?? DEFAULT_COMPANY_ID);
  const pack = getIndustryPack(company.industryKey ?? company.industry);
  return res.json({ company: { ...company, industryKey: pack.key, industry: company.industry ?? pack.label } });
});

router.put('/company', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, email, phone, industry, industryKey, address } = req.body as {
    name?: string; email?: string; phone?: string; industry?: string; industryKey?: string; address?: string;
  };
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Company name must be at least 2 characters.' });
  }
  const profileCompanyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const current = companyProfileFor(profileCompanyId);
  const nextKey = resolveIndustryKey(industryKey ?? current.industryKey ?? industry ?? current.industry);
  const pack = getIndustryPack(nextKey);
  const profile = saveCompanyProfile(profileCompanyId, {
    name: name.trim(),
    email: email?.trim() || undefined,
    phone: phone?.trim() || undefined,
    industry: pack.label,
    industryKey: nextKey,
    address: address?.trim() || undefined,
  });

  try {
    await persistCompanyProfile(profile, profileCompanyId);
    const applied = await applyIndustryPack(nextKey, profileCompanyId);
    return res.json({
      company: profile,
      pack: toWorkspacePackView(pack),
      applied,
    });
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to save company profile.' });
  }
});

router.post('/locations', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, type } = req.body as { name?: string; type?: string };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Location name must be at least 2 characters.' });
  }
  if (type !== 'store' && type !== 'warehouse') {
    return res.status(400).json({ message: 'Type must be "store" or "warehouse".' });
  }

  const record: LocationRecord = {
    id: `loc-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim(),
    type,
  };
  // Prisma's Location.code is unique and has no other consumer in this app,
  // so it is derived here rather than collected from the admin.
  const code = `${type.toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  try {
    await persistLocationCreate(record, code, req.companyId ?? DEFAULT_COMPANY_ID);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save location.' });
  }

  registerLocationCompany(record.id, req.companyId ?? DEFAULT_COMPANY_ID);
  locations.push(record);
  return res.status(201).json({ location: record });
});

router.put('/locations/:locationId', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const locationId = firstParam(req.params.locationId);
  const record = locations.find((location) => location.id === locationId);
  if (!record) {
    return res.status(404).json({ message: 'Location not found.' });
  }

  const { name, type } = req.body as { name?: string; type?: string };
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ message: 'Location name must be at least 2 characters.' });
    }
    record.name = name.trim();
  }
  if (type !== undefined) {
    if (type !== 'store' && type !== 'warehouse') {
      return res.status(400).json({ message: 'Type must be "store" or "warehouse".' });
    }
    record.type = type;
  }

  try {
    await persistLocationUpdate(record);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update location.' });
  }

  return res.json({ location: record });
});

router.delete('/locations/:locationId', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can permanently delete locations.' });
  const locationId = firstParam(req.params.locationId);
  const index = locations.findIndex((location) => location.id === locationId);
  if (index === -1) {
    return res.status(404).json({ message: 'Location not found.' });
  }

  try {
    await persistLocationDelete(locationId);
  } catch (error) {
    // A foreign-key violation means stock, counts, or transfers still
    // reference this location - the message says so rather than surfacing
    // the raw Prisma error.
    return res.status(400).json({ message: 'This location has stock, counts, or transfers on record and cannot be deleted.' });
  }

  locations.splice(index, 1);
  return res.json({ success: true });
});

// A user created here must work everywhere a user can appear: logging in
// (enhancedUsers, read by enterprise-auth's requireAuth), being listed or
// picked for an assignment (repository.ts's users, read by GET /users and
// findUserById), and surviving a restart (the User table both of those
// hydrate from at startup). Writing to only one of the three is exactly how
// an admin-created Store User would fail to show up in the Assign Count
// dialog, or fail to log in, depending on which was skipped.
router.post('/users', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, email, password, role, assignedLocationIds } = req.body as {
    name?: string; email?: string; password?: string; role?: string; assignedLocationIds?: string[];
  };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters.' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'A valid email is required.' });
  }
  const passwordProblem = typeof password === 'string' ? validatePassword(password) : { valid: false, message: 'Password is required.' };
  if (!passwordProblem.valid) return res.status(400).json({ message: passwordProblem.message ?? 'Password does not meet the policy.' });
  if (isKnownDefaultPassword(password as string)) return res.status(400).json({ message: 'That password is publicly known. Choose a different one.' });
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
  }
  if (req.user!.role === 'ADMIN_USER' && ['ADMIN', 'ADMIN_USER'].includes(role)) {
    return res.status(403).json({ message: 'Admin User can create only lower-level users.' });
  }
  const locationIds = Array.isArray(assignedLocationIds) ? assignedLocationIds.filter((id) => typeof id === 'string') : [];
  for (const id of locationIds) {
    if (!locations.some((location) => location.id === id)) {
      return res.status(400).json({ message: `Unknown location: ${id}` });
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (users.some((user) => user.email.toLowerCase() === normalizedEmail) || enterpriseRepo.findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'A user with this email already exists.' });
  }

  const id = `user-${Math.random().toString(36).slice(2, 9)}`;
  const passwordHash = hashPassword(password);
  const record: UserRecord = { id, email: normalizedEmail, name: name.trim(), role: role as Role, assignedLocationIds: locationIds };

  try {
    await persistUserCreate(record, passwordHash, req.companyId ?? DEFAULT_COMPANY_ID);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save user.' });
  }

  users.push(record);
  enterpriseRepo.createEnhancedUser({
    id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    email: normalizedEmail,
    name: record.name,
    role: role as enterpriseRepo.Role,
    branchIds: [],
    locationIds,
    passwordHash,
    status: 'active',
  });

  return res.status(201).json({ user: { id, name: record.name, email: normalizedEmail, role: record.role, assignedLocationIds: locationIds } });
});

// A user belongs to exactly one company. These two routes look the user up in the process-wide user list by
// id, so without this check an admin of company A could rewrite the role or password of (or delete) a user of
// company B whose id they know. Another company's user must look exactly like a missing one (404, never 403).
function userBelongsToCaller(req: Request, userId: string): boolean {
  const owner = enterpriseRepo.findUserById(userId)?.companyId ?? DEFAULT_COMPANY_ID;
  return owner === (req.companyId ?? DEFAULT_COMPANY_ID);
}

router.put('/users/:userId', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const userId = firstParam(req.params.userId);
  const record = users.find((user) => user.id === userId);
  const enhanced = enterpriseRepo.findUserById(userId);
  if (!record || !enhanced || !userBelongsToCaller(req, userId)) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const { name, role, assignedLocationIds, password } = req.body as {
    name?: string; role?: string; assignedLocationIds?: string[]; password?: string;
  };

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters.' });
    }
    record.name = name.trim();
    enhanced.name = record.name;
  }
  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as Role)) {
      return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
    }
    if (req.user!.role === 'ADMIN_USER' && ['ADMIN', 'ADMIN_USER'].includes(role)) return res.status(403).json({ message: 'Admin User cannot promote users to an admin role.' });
    if (userId === req.user!.id && role !== 'ADMIN') {
      return res.status(400).json({ message: 'You cannot change your own role away from Admin.' });
    }
    record.role = role as Role;
    enhanced.role = role as enterpriseRepo.Role;
  }
  if (assignedLocationIds !== undefined) {
    if (!Array.isArray(assignedLocationIds) || assignedLocationIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ message: 'assignedLocationIds must be an array of location ids.' });
    }
    for (const id of assignedLocationIds) {
      if (!locations.some((location) => location.id === id)) {
        return res.status(400).json({ message: `Unknown location: ${id}` });
      }
    }
    record.assignedLocationIds = assignedLocationIds;
    enhanced.locationIds = assignedLocationIds;
  }
  let passwordHash: string | undefined;
  if (password !== undefined) {
    // The same policy as self-service passwords: an admin-set password is not allowed to be weaker.
    const check = typeof password === 'string' ? validatePassword(password) : { valid: false, message: 'Password must be text.' };
    if (!check.valid) return res.status(400).json({ message: check.message ?? 'Password does not meet the policy.' });
    if (isKnownDefaultPassword(password)) return res.status(400).json({ message: 'That password is publicly known. Choose a different one.' });
    passwordHash = hashPassword(password);
    enhanced.passwordHash = passwordHash;
  }

  try {
    await persistUserUpdate(record, passwordHash);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update user.' });
  }
  // A changed password means every existing session of that person must end (plan Area D WP4).
  if (passwordHash && userId !== req.user!.id) await revokeAllSessionsForUser(userId).catch((error) => console.error('session revoke failed:', error instanceof Error ? error.message : error));

  return res.json({ user: { id: record.id, name: record.name, email: record.email, role: record.role, assignedLocationIds: record.assignedLocationIds } });
});

router.delete('/users/:userId', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only Main Admin can permanently delete users.' });
  const userId = firstParam(req.params.userId);
  if (userId === req.user!.id) {
    return res.status(400).json({ message: 'You cannot delete your own account.' });
  }

  const index = users.findIndex((user) => user.id === userId);
  if (index === -1 || !userBelongsToCaller(req, userId)) {
    return res.status(404).json({ message: 'User not found.' });
  }

  try {
    await persistUserDelete(userId);
  } catch (error) {
    return res.status(400).json({ message: 'This user has records on file (counts, transfers, assignments) and cannot be deleted.' });
  }

  users.splice(index, 1);
  const enhancedIndex = enterpriseRepo.enhancedUsers.findIndex((user) => user.id === userId);
  if (enhancedIndex !== -1) {
    enterpriseRepo.enhancedUsers.splice(enhancedIndex, 1);
  }

  return res.json({ success: true });
});

export default router;
