"use strict";
// Enterprise-grade repository with multi-organization support, OTP, biometrics, and audit logging
Object.defineProperty(exports, "__esModule", { value: true });
exports.rolePermissions = exports.auditLogs = exports.stockLedger = exports.transferAssignments = exports.transfers = exports.countAssignments = exports.counts = exports.items = exports.locations = exports.biometricCredentials = exports.enhancedUsers = exports.branches = exports.companies = void 0;
exports.seedEnhancedUsersForMemoryMode = seedEnhancedUsersForMemoryMode;
exports.createCompany = createCompany;
exports.findCompanyById = findCompanyById;
exports.listCompanies = listCompanies;
exports.createBranch = createBranch;
exports.findBranchById = findBranchById;
exports.listBranchesByCompany = listBranchesByCompany;
exports.createEnhancedUser = createEnhancedUser;
exports.findUserById = findUserById;
exports.findUserByEmail = findUserByEmail;
exports.listUsersByCompany = listUsersByCompany;
exports.updateUserLastLogin = updateUserLastLogin;
exports.createBiometricCredential = createBiometricCredential;
exports.findBiometricByUserId = findBiometricByUserId;
exports.createLocation = createLocation;
exports.listLocationsByBranch = listLocationsByBranch;
exports.listItemsByCompany = listItemsByCompany;
exports.listItems = listItems;
exports.createCountRecord = createCountRecord;
exports.findCountById = findCountById;
exports.listCountsByBranch = listCountsByBranch;
exports.listCountsByAssignee = listCountsByAssignee;
exports.updateCountStatus = updateCountStatus;
exports.approveCount = approveCount;
exports.createTransferRecord = createTransferRecord;
exports.findTransferById = findTransferById;
exports.listTransfersByBranch = listTransfersByBranch;
exports.updateTransferStatus = updateTransferStatus;
exports.logAuditAction = logAuditAction;
exports.listAuditLogsByCompany = listAuditLogsByCompany;
exports.findLocationsByCompanyId = findLocationsByCompanyId;
exports.findItemsByCompanyId = findItemsByCompanyId;
exports.findCountsByCompanyId = findCountsByCompanyId;
exports.findTransfersByCompanyId = findTransfersByCompanyId;
exports.canTransitionTransfer = canTransitionTransfer;
exports.updateTransferStatusSafe = updateTransferStatusSafe;
exports.getPermissionsForRole = getPermissionsForRole;
exports.userHasPermission = userHasPermission;
exports.getPendingCountsForApproval = getPendingCountsForApproval;
exports.rejectCount = rejectCount;
// ============================================
// IN-MEMORY DATA STORES
// ============================================
exports.companies = [];
exports.branches = [];
exports.enhancedUsers = [];
// In database mode, enhancedUsers is populated from the User table at
// startup (index.ts's hydrateRepository). Off the database, nothing else
// ever puts a row in it - self-registration is gone and there is no other
// seeding step - so login would have no account to find at all. This gives
// it the same four seed accounts repository.ts's `users` already carries,
// hashing SEED_PASSWORD once since enterprise-auth's login always checks a
// real password hash, never a plaintext shortcut.
function seedEnhancedUsersForMemoryMode(seedUsers, passwordHash) {
    if (exports.enhancedUsers.length > 0)
        return;
    for (const user of seedUsers) {
        exports.enhancedUsers.push({
            id: user.id,
            companyId: 'default-company',
            email: user.email,
            name: user.name,
            role: user.role,
            branchIds: [],
            locationIds: [...user.assignedLocationIds],
            passwordHash,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }
    if (!exports.enhancedUsers.some((user) => user.email === 'admin@jaipur.local')) {
        exports.enhancedUsers.push({
            id: 'user-jaipur-admin',
            companyId: 'company-jaipur',
            email: 'admin@jaipur.local',
            name: 'Jaipur Admin',
            role: 'ADMIN',
            branchIds: [],
            locationIds: ['loc-jaipur-1'],
            passwordHash,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }
}
exports.biometricCredentials = [];
exports.locations = [];
exports.items = [];
exports.counts = [];
exports.countAssignments = [];
exports.transfers = [];
exports.transferAssignments = [];
exports.stockLedger = [];
exports.auditLogs = [];
// ============================================
// COMPANY MANAGEMENT
// ============================================
function createCompany(input) {
    const company = {
        id: `company-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.companies.push(company);
    return { ...company };
}
function findCompanyById(companyId) {
    return exports.companies.find((c) => c.id === companyId);
}
function listCompanies() {
    return exports.companies.map((c) => ({ ...c }));
}
// ============================================
// BRANCH MANAGEMENT
// ============================================
function createBranch(input) {
    const branch = {
        id: `branch-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.branches.push(branch);
    return { ...branch };
}
function findBranchById(branchId) {
    return exports.branches.find((b) => b.id === branchId);
}
function listBranchesByCompany(companyId) {
    return exports.branches
        .filter((b) => b.companyId === companyId)
        .map((b) => ({ ...b }));
}
// ============================================
// ENHANCED USER MANAGEMENT
// ============================================
function createEnhancedUser(input) {
    const { id, ...rest } = input;
    const user = {
        id: id ?? `user-${Math.random().toString(36).slice(2, 9)}`,
        ...rest,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.enhancedUsers.push(user);
    return { ...user };
}
function findUserById(userId) {
    return exports.enhancedUsers.find((u) => u.id === userId);
}
function findUserByEmail(email) {
    const normalized = email.trim().toLowerCase();
    return exports.enhancedUsers.find((u) => u.email.toLowerCase() === normalized);
}
function listUsersByCompany(companyId) {
    return exports.enhancedUsers
        .filter((u) => u.companyId === companyId)
        .map((u) => ({ ...u }));
}
function updateUserLastLogin(userId) {
    const user = exports.enhancedUsers.find((u) => u.id === userId);
    if (!user)
        throw new Error('User not found');
    user.lastLogin = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    return { ...user };
}
// ============================================
// BIOMETRIC MANAGEMENT
// ============================================
function createBiometricCredential(input) {
    const credential = {
        id: `biometric-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.biometricCredentials.push(credential);
    return { ...credential };
}
function findBiometricByUserId(userId) {
    return exports.biometricCredentials.find((b) => b.userId === userId);
}
// ============================================
// LOCATION MANAGEMENT
// ============================================
function createLocation(input) {
    const location = {
        id: `loc-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.locations.push(location);
    return { ...location };
}
function listLocationsByBranch(branchId) {
    return exports.locations
        .filter((l) => l.branchId === branchId)
        .map((l) => ({ ...l }));
}
// ============================================
// ITEM MANAGEMENT
// ============================================
function listItemsByCompany(companyId) {
    return exports.items
        .filter((i) => i.companyId === companyId)
        .map((i) => ({ ...i }));
}
function listItems() {
    return exports.items.map((i) => ({ ...i }));
}
// ============================================
// COUNT MANAGEMENT
// ============================================
function createCountRecord(input) {
    const record = {
        id: `count-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        variancePercentage: input.bookQty > 0 ? (input.variance / input.bookQty) * 100 : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.counts.push(record);
    return { ...record };
}
function findCountById(countId) {
    return exports.counts.find((c) => c.id === countId);
}
function listCountsByBranch(branchId, status) {
    return exports.counts
        .filter((c) => c.branchId === branchId && (!status || c.status === status))
        .map((c) => ({ ...c }));
}
function listCountsByAssignee(userId) {
    return exports.countAssignments
        .filter((c) => c.assignedToId === userId && c.status === 'ASSIGNED')
        .map((c) => ({ ...c }));
}
function updateCountStatus(countId, status, updates) {
    const count = exports.counts.find((c) => c.id === countId);
    if (!count)
        throw new Error('Count not found');
    count.status = status;
    if (updates) {
        Object.assign(count, updates);
    }
    count.updatedAt = new Date().toISOString();
    return { ...count };
}
function approveCount(countId, reviewedBy, notes) {
    const count = updateCountStatus(countId, 'APPROVED', {
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes,
    });
    // Adjust stock ledger
    const ledgerEntry = exports.stockLedger.find((l) => l.itemId === count.itemId && l.lotId === count.lotId && l.locationId === count.locationId);
    if (ledgerEntry) {
        ledgerEntry.onHand += count.variance;
        ledgerEntry.version += 1;
        ledgerEntry.lastMovedAt = new Date().toISOString();
    }
    else {
        exports.stockLedger.push({
            itemId: count.itemId,
            lotId: count.lotId,
            locationId: count.locationId,
            onHand: count.variance,
            version: 1,
            lastMovedAt: new Date().toISOString(),
        });
    }
    return count;
}
// ============================================
// TRANSFER MANAGEMENT
// ============================================
function createTransferRecord(input) {
    const transfer = {
        id: `transfer-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    exports.transfers.push(transfer);
    return { ...transfer };
}
function findTransferById(transferId) {
    return exports.transfers.find((t) => t.id === transferId);
}
function listTransfersByBranch(branchId) {
    const branchLocations = exports.locations.filter((l) => l.branchId === branchId).map((l) => l.id);
    return exports.transfers
        .filter((t) => branchLocations.includes(t.sourceLocationId) || branchLocations.includes(t.destinationLocationId))
        .map((t) => ({ ...t }));
}
function updateTransferStatus(transferId, status, updates) {
    const transfer = exports.transfers.find((t) => t.id === transferId);
    if (!transfer)
        throw new Error('Transfer not found');
    transfer.status = status;
    if (updates) {
        Object.assign(transfer, updates);
    }
    transfer.updatedAt = new Date().toISOString();
    return { ...transfer };
}
// ============================================
// AUDIT LOGGING
// ============================================
function logAuditAction(input) {
    const log = {
        id: `audit-${Math.random().toString(36).slice(2, 9)}`,
        ...input,
        createdAt: new Date().toISOString(),
    };
    exports.auditLogs.push(log);
    return { ...log };
}
function listAuditLogsByCompany(companyId, limit = 100) {
    return exports.auditLogs
        .filter((l) => l.companyId === companyId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map((l) => ({ ...l }));
}
// ============================================
// COMPANY DATA QUERIES (for frontend)
// ============================================
function findLocationsByCompanyId(companyId) {
    const companyBranches = exports.branches.filter((b) => b.companyId === companyId);
    return exports.locations.filter((l) => companyBranches.some((b) => b.id === l.branchId));
}
function findItemsByCompanyId(companyId) {
    return exports.items.filter((i) => i.companyId === companyId);
}
function findCountsByCompanyId(companyId) {
    const companyBranches = exports.branches.filter((b) => b.companyId === companyId);
    const branchLocations = exports.locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
    return exports.counts.filter((c) => branchLocations.includes(c.locationId));
}
function findTransfersByCompanyId(companyId) {
    const companyBranches = exports.branches.filter((b) => b.companyId === companyId);
    const branchLocations = exports.locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
    return exports.transfers.filter((t) => branchLocations.includes(t.sourceLocationId) || branchLocations.includes(t.destinationLocationId));
}
const validTransitions = [
    { from: 'PENDING', to: 'IN_TRANSIT' },
    { from: 'PENDING', to: 'CANCELLED' },
    { from: 'IN_TRANSIT', to: 'RECEIVED' },
    { from: 'IN_TRANSIT', to: 'CANCELLED' },
    { from: 'RECEIVED', to: 'RECEIVED' }, // terminal state
];
function canTransitionTransfer(from, to) {
    return validTransitions.some((t) => t.from === from && t.to === to);
}
function updateTransferStatusSafe(transferId, newStatus) {
    const transfer = exports.transfers.find((t) => t.id === transferId);
    if (!transfer) {
        throw new Error('Transfer not found');
    }
    if (!canTransitionTransfer(transfer.status, newStatus)) {
        throw new Error(`Invalid status transition: ${transfer.status} → ${newStatus}`);
    }
    transfer.status = newStatus;
    transfer.updatedAt = new Date().toISOString();
    return { ...transfer };
}
// ============================================
// PERMISSION & ROLE HELPERS
// ============================================
exports.rolePermissions = {
    'ADMIN': [
        'create_location',
        'manage_users',
        'view_reports',
        'approve_counts',
        'manage_transfers',
        'assign_stock',
        'view_inventory',
    ],
    'ADMIN_USER': [
        'create_location', 'manage_users', 'view_reports', 'approve_counts', 'manage_transfers', 'assign_stock', 'view_inventory',
    ],
    'BRANCH_MANAGER': [
        'manage_inventory',
        'assign_stock',
        'approve_counts',
        'view_reports',
        'create_transfers',
        'view_inventory',
    ],
    'STOCK_KEEPER': [
        'update_stock',
        'view_inventory',
        'create_counts',
    ],
    'STORE_USER': [
        'view_inventory',
    ],
    'WAREHOUSE_PICKER': [
        'update_stock',
        'view_inventory',
    ],
    'AUDITOR': [
        'view_reports',
        'view_inventory',
    ],
};
function getPermissionsForRole(role) {
    return exports.rolePermissions[role] || [];
}
function userHasPermission(userId, permission) {
    const user = exports.enhancedUsers.find((u) => u.id === userId);
    if (!user)
        return false;
    const permissions = getPermissionsForRole(user.role);
    return permissions.includes(permission);
}
// Refresh-token session families now live in lib/session-store.ts (ADR-003):
// persisted, hashed, rotating, with reuse detection - not an in-process Map
// keyed by the raw token value.
// ============================================
// COUNT APPROVAL WORKFLOW
// ============================================
function getPendingCountsForApproval(companyId) {
    const companyBranches = exports.branches.filter((b) => b.companyId === companyId);
    const branchLocations = exports.locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
    return exports.counts.filter((c) => branchLocations.includes(c.locationId) && c.status === 'PENDING');
}
function rejectCount(countId, rejectedBy, reason) {
    const count = exports.counts.find((c) => c.id === countId);
    if (!count)
        throw new Error('Count not found');
    count.status = 'REJECTED';
    count.rejectedBy = rejectedBy;
    count.rejectedReason = reason;
    count.updatedAt = new Date().toISOString();
    return { ...count };
}
