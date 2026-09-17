// Enterprise management routes for companies, branches, users
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import * as repo from '../lib/enterprise-repository.js';
import { hashPassword } from '../lib/otp-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';

const router = Router();

// Apply middleware to all routes
router.use(extractToken);
router.use(requireAuth);
router.use(enforcePermissionOverrides);

// ============================================
// COMPANY MANAGEMENT
// ============================================

// Get current company details
router.get('/companies/:companyId', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    // Verify user belongs to this company
    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const company = repo.findCompanyById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ success: true, company });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// Update company details
router.put('/companies/:companyId', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { name, phone, industry, logo, addressLine1, addressLine2, city, state, postalCode, country } = req.body;

    // Verify user belongs to this company and is admin
    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can update company details' });
    }

    const company = repo.findCompanyById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Update fields
    if (name) company.name = name;
    if (phone) company.phone = phone;
    if (industry) company.industry = industry;
    if (logo) company.logo = logo;
    if (addressLine1) company.addressLine1 = addressLine1;
    if (addressLine2) company.addressLine2 = addressLine2;
    if (city) company.city = city;
    if (state) company.state = state;
    if (postalCode) company.postalCode = postalCode;
    if (country) company.country = country;
    company.updatedAt = new Date().toISOString();

    // Log audit
    repo.logAuditAction({
      companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'UPDATED',
      entityType: 'COMPANY',
      entityId: companyId,
      entityDescription: company.name,
    });

    res.json({ success: true, company });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// ============================================
// BRANCH MANAGEMENT
// ============================================

// List branches
router.get('/companies/:companyId/branches', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const branches = repo.listBranchesByCompany(companyId);
    res.json({ success: true, branches });
  } catch (error) {
    console.error('List branches error:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// Create branch
router.post('/companies/:companyId/branches', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { name, type, address, city, state, postalCode, country, phone, manager } = req.body;

    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can create branches' });
    }

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    if (!['store', 'warehouse'].includes(type)) {
      return res.status(400).json({ error: 'Type must be store or warehouse' });
    }

    const branch = repo.createBranch({
      companyId,
      name,
      type: type as 'store' | 'warehouse',
      address,
      city,
      state,
      postalCode,
      country,
      phone,
      manager,
    });

    // Log audit
    repo.logAuditAction({
      companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'CREATED',
      entityType: 'BRANCH',
      entityId: branch.id,
      entityDescription: branch.name,
    });

    res.status(201).json({ success: true, branch });
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

// Update branch
router.put('/branches/:branchId', (req: Request, res: Response) => {
  try {
    const branchId = Array.isArray(req.params.branchId) ? req.params.branchId[0] : req.params.branchId;
    const { name, type, address, city, state, postalCode, country, phone, manager } = req.body;

    const branch = repo.findBranchById(branchId);
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    if (req.companyId !== branch.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'BRANCH_MANAGER') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Update fields
    if (name) branch.name = name;
    if (type) branch.type = type;
    if (address) branch.address = address;
    if (city) branch.city = city;
    if (state) branch.state = state;
    if (postalCode) branch.postalCode = postalCode;
    if (country) branch.country = country;
    if (phone) branch.phone = phone;
    if (manager) branch.manager = manager;
    branch.updatedAt = new Date().toISOString();

    // Log audit
    repo.logAuditAction({
      companyId: branch.companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'UPDATED',
      entityType: 'BRANCH',
      entityId: branchId,
      entityDescription: branch.name,
    });

    res.json({ success: true, branch });
  } catch (error) {
    console.error('Update branch error:', error);
    res.status(500).json({ error: 'Failed to update branch' });
  }
});

// ============================================
// USER MANAGEMENT
// ============================================

// List users in company
router.get('/companies/:companyId/users', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can list users' });
    }

    const users = repo.listUsersByCompany(companyId).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      branchIds: u.branchIds,
      locationIds: u.locationIds,
      status: u.status,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    }));

    res.json({ success: true, users });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user
router.post('/companies/:companyId/users', (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { email, name, role, phone, branchIds, locationIds } = req.body;

    if (req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can create users' });
    }

    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name, and role are required' });
    }

    // Check if email already exists
    if (repo.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Validate role
    const validRoles = ['ADMIN', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Create temporary password
    const tempPassword = Math.random().toString(36).slice(-8);

    const user = repo.createEnhancedUser({
      companyId,
      email,
      name,
      role,
      phone,
      branchIds: branchIds || [],
      locationIds: locationIds || [],
      passwordHash: hashPassword(tempPassword),
      status: 'active',
    });

    // In production, send email with temporary password and OTP setup link
    console.log(`[USER CREATION] Email: ${email}, Temp Password: ${tempPassword}`);

    // Log audit
    repo.logAuditAction({
      companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'CREATED',
      entityType: 'USER',
      entityId: user.id,
      entityDescription: user.name,
    });

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchIds: user.branchIds,
        locationIds: user.locationIds,
      },
      tempPassword, // Should be sent via email in production
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.put('/users/:userId', (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const { name, phone, role, branchIds, locationIds, status } = req.body;

    const user = repo.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.companyId !== user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can update users' });
    }

    // Update fields
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (branchIds) user.branchIds = branchIds;
    if (locationIds) user.locationIds = locationIds;
    if (status) user.status = status;
    user.updatedAt = new Date().toISOString();

    // Log audit
    repo.logAuditAction({
      companyId: user.companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'UPDATED',
      entityType: 'USER',
      entityId: userId,
      entityDescription: user.name,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchIds: user.branchIds,
        locationIds: user.locationIds,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (deactivate)
router.delete('/users/:userId', (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    if (req.user?.id === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = repo.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.companyId !== user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can delete users' });
    }

    user.status = 'inactive';
    user.updatedAt = new Date().toISOString();

    // Log audit
    repo.logAuditAction({
      companyId: user.companyId,
      userId: req.userId!,
      userName: req.user?.name || 'Unknown',
      action: 'DELETED',
      entityType: 'USER',
      entityId: userId,
      entityDescription: user.name,
    });

    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Assign branches to user
router.post('/users/:userId/assign-branches', (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const { branchIds } = req.body;

    if (!Array.isArray(branchIds)) {
      return res.status(400).json({ error: 'branchIds must be an array' });
    }

    const user = repo.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.companyId !== user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only company admins can assign branches' });
    }

    // Verify all branches belong to company
    for (const branchId of branchIds) {
      const branch = repo.findBranchById(branchId);
      if (!branch || branch.companyId !== req.companyId) {
        return res.status(400).json({ error: `Invalid branch: ${branchId}` });
      }
    }

    user.branchIds = branchIds;
    user.updatedAt = new Date().toISOString();

    res.json({ success: true, user });
  } catch (error) {
    console.error('Assign branches error:', error);
    res.status(500).json({ error: 'Failed to assign branches' });
  }
});

// ============================================
// INVENTORY & DASHBOARD ENDPOINTS (for frontend)
// ============================================

// Get locations
router.get('/locations', (req: Request, res: Response) => {
  try {
    const company = repo.findCompanyById(req.companyId!);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const locations = repo.findLocationsByCompanyId(req.companyId!);
    res.json({ locations: locations || [] });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// Get items
router.get('/items', (req: Request, res: Response) => {
  try {
    const items = repo.findItemsByCompanyId(req.companyId!);
    res.json({ items: items || [] });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Get counts
router.get('/counts', (req: Request, res: Response) => {
  try {
    const counts = repo.findCountsByCompanyId(req.companyId!);
    res.json({ counts: counts || [] });
  } catch (error) {
    console.error('Get counts error:', error);
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

// Get transfers
router.get('/transfers/list', (req: Request, res: Response) => {
  try {
    const transfers = repo.findTransfersByCompanyId(req.companyId!);
    res.json({ transfers: transfers || [] });
  } catch (error) {
    console.error('Get transfers error:', error);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// Get dashboard summary
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const company = repo.findCompanyById(req.companyId!);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({
      company,
      summary: {
        totalLocations: 3,
        totalItems: 0,
        pendingCounts: 0,
        activeTransfers: 0,
      },
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// ============================================
// PHASE 2: TRANSFER STATE MACHINE
// ============================================

// Update transfer status with validation
router.post('/transfers/:id/status', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const status = String(req.body.status);

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const transfer = repo.updateTransferStatusSafe(id, status);
    res.json(transfer);
  } catch (error: any) {
    console.error('Update transfer status error:', error);
    res.status(400).json({ error: error.message || 'Failed to update transfer status' });
  }
});

// Get valid status transitions for a transfer
router.get('/transfers/:id/valid-transitions', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const transfer = repo.findTransferById(id);
    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const validStates: Record<string, string[]> = {
      'PENDING': ['IN_TRANSIT', 'CANCELLED'],
      'IN_TRANSIT': ['RECEIVED', 'CANCELLED'],
      'RECEIVED': [],
      'CANCELLED': []
    };

    res.json({
      currentStatus: transfer.status,
      validTransitions: validStates[transfer.status] || []
    });
  } catch (error) {
    console.error('Get valid transitions error:', error);
    res.status(500).json({ error: 'Failed to fetch valid transitions' });
  }
});

// ============================================
// PHASE 2: COUNT APPROVAL WORKFLOW
// ============================================

// Get pending counts for admin review
router.get('/counts/pending/review', (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can review counts' });
    }

    const pendingCounts = repo.getPendingCountsForApproval(req.companyId!);
    res.json({ counts: pendingCounts || [] });
  } catch (error) {
    console.error('Get pending counts error:', error);
    res.status(500).json({ error: 'Failed to fetch pending counts' });
  }
});

// Approve a stock count
router.post('/counts/:id/approve', (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can approve counts' });
    }

    const id = String(req.params.id);
    const count = repo.approveCount(id, req.userId!);
    res.json(count);
  } catch (error: any) {
    console.error('Approve count error:', error);
    res.status(400).json({ error: error.message || 'Failed to approve count' });
  }
});

// Reject a stock count
router.post('/counts/:id/reject', (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can reject counts' });
    }

    const id = String(req.params.id);
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const count = repo.rejectCount(id, req.userId!, reason);
    res.json(count);
  } catch (error: any) {
    console.error('Reject count error:', error);
    res.status(400).json({ error: error.message || 'Failed to reject count' });
  }
});

// ============================================
// PHASE 2: PERMISSION & ROLE SYSTEM
// ============================================

// Get current user permissions
router.get('/me/permissions', (req: Request, res: Response) => {
  try {
    const user = repo.findUserById(req.userId!);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const permissions = repo.getPermissionsForRole(user.role);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      permissions,
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Check if user has specific permission
router.post('/me/check-permission', (req: Request, res: Response) => {
  try {
    const { permission } = req.body;
    if (!permission) {
      return res.status(400).json({ error: 'Permission is required' });
    }

    const hasPermission = repo.userHasPermission(req.userId!, permission);
    res.json({ permission, granted: hasPermission });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

export default router;
