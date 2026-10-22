// Enterprise-grade repository with multi-organization support, OTP, biometrics, and audit logging

// ADMIN, not COMPANY_ADMIN: the Prisma enum, lib/inventory.ts and the web app
// all name the admin role this way, and a second spelling silently produced
// users with no permissions.
export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';

// ============================================
// COMPANY & BRANCH MANAGEMENT
// ============================================

export type CompanyRecord = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  industry?: string;
  plan: 'free' | 'pro' | 'enterprise';
  logo?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
};

export type BranchRecord = {
  id: string;
  companyId: string;
  name: string;
  type: 'store' | 'warehouse';
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  manager?: string;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// ENHANCED USER WITH OTP & BIOMETRICS
// ============================================

export type EnhancedUserRecord = {
  id: string;
  companyId: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  branchIds: string[]; // branches user can access
  locationIds: string[]; // specific locations within branches
  passwordHash?: string;
  otpSecret?: string;
  lastLogin?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
};

export type BiometricCredentialRecord = {
  id: string;
  userId: string;
  pin4Digit?: string; // hashed 4-digit PIN
  faceDataHash?: string; // hashed face data
  fingerprintHash?: string; // hashed fingerprint data
  enabledMethods: ('pin' | 'face' | 'fingerprint')[];
  lastUsed?: string;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// ENHANCED INVENTORY RECORDS
// ============================================

export type LocationRecord = {
  id: string;
  companyId: string;
  branchId: string;
  name: string;
  type: 'store' | 'warehouse' | 'section';
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type ItemRecord = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  unitPrice?: number;
  reorderLevel?: number;
  lots: LotRecord[];
  createdAt: string;
  updatedAt: string;
};

export type LotRecord = {
  id: string;
  itemId: string;
  lotNo: string;
  expiryDate?: string | null;
  manufacturingDate?: string;
  batchNo?: string;
  supplier?: string;
  attributes?: Record<string, unknown>;
};

// ============================================
// ENHANCED COUNTS WITH TIMESTAMPS
// ============================================

export type CountRecord = {
  id: string;
  companyId: string;
  branchId: string;
  itemId: string;
  lotId: string;
  locationId: string;
  physicalQuantity: number;
  bookQty: number;
  variance: number;
  variancePercentage?: number;
  mode: 'scan' | 'manual';
  submittedBy: string;
  role: Role;
  submittedAt: string;
  assignedAt?: string;
  assignedBy?: string;
  dueDate?: string;
  completedAt?: string;
  status: 'ASSIGNED' | 'SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PENDING';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedReason?: string;
  attachments?: string[]; // photo/document URLs
  createdAt: string;
  updatedAt: string;
};

export type CountAssignmentRecord = {
  id: string;
  companyId: string;
  branchId: string;
  locationId: string;
  itemId: string;
  assignedToId: string;
  assignedBy: string;
  countDate: string;
  dueDate?: string;
  instructions?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'ASSIGNED' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';
  countId?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// ENHANCED TRANSFERS WITH TRACKING
// ============================================

export type TransferRecord = {
  id: string;
  companyId: string;
  sourceLocationId: string;
  sourceLocationName?: string;
  destinationLocationId: string;
  destinationLocationName?: string;
  requestedBy: string;
  role: Role;
  status: 'SUBMITTED' | 'REQUESTED' | 'PICKING' | 'PICKED' | 'IN_TRANSIT' | 'DISPATCHED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'REJECTED';
  lines: Array<{ itemId: string; lotId: string; quantity: number; itemName?: string }>;
  cartonCount?: number;
  photos?: string[];
  notes?: string;
  dueDate?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  receivedQty?: number;
  damagedQty?: number;
  shortageQty?: number;
  receiveNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TransferAssignmentRecord = {
  id: string;
  transferId: string;
  assignedToId: string;
  assignedBy: string;
  assignedAt: string;
  dueDate?: string;
  completedAt?: string;
  status: 'ASSIGNED' | 'ACCEPTED' | 'COMPLETED' | 'REJECTED';
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// AUDIT & LOGGING
// ============================================

export type AuditLogRecord = {
  id: string;
  companyId: string;
  userId: string;
  userName: string;
  action: string; // CREATED, UPDATED, DELETED, APPROVED, REJECTED, ASSIGNED, COMPLETED
  entityType: string; // COUNT, TRANSFER, USER, BRANCH, etc.
  entityId: string;
  entityDescription?: string;
  changes?: Record<string, { oldValue: unknown; newValue: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
};

// ============================================
// IN-MEMORY DATA STORES
// ============================================

export const companies: CompanyRecord[] = [];
export const branches: BranchRecord[] = [];
export const enhancedUsers: EnhancedUserRecord[] = [];

// In database mode, enhancedUsers is populated from the User table at
// startup (index.ts's hydrateRepository). Off the database, nothing else
// ever puts a row in it - self-registration is gone and there is no other
// seeding step - so login would have no account to find at all. This gives
// it the same four seed accounts repository.ts's `users` already carries,
// hashing SEED_PASSWORD once since enterprise-auth's login always checks a
// real password hash, never a plaintext shortcut.
export function seedEnhancedUsersForMemoryMode(
  seedUsers: ReadonlyArray<{ id: string; email: string; name: string; role: Role; assignedLocationIds: readonly string[] }>,
  passwordHash: string,
): void {
  if (enhancedUsers.length > 0) return;
  for (const user of seedUsers) {
    enhancedUsers.push({
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
  if (!enhancedUsers.some((user) => user.email === 'admin@jaipur.local')) {
    enhancedUsers.push({
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
export const biometricCredentials: BiometricCredentialRecord[] = [];
export const locations: LocationRecord[] = [];
export const items: ItemRecord[] = [];
export const counts: CountRecord[] = [];
export const countAssignments: CountAssignmentRecord[] = [];
export const transfers: TransferRecord[] = [];
export const transferAssignments: TransferAssignmentRecord[] = [];
export const auditLogs: AuditLogRecord[] = [];

// ============================================
// COMPANY MANAGEMENT
// ============================================

export function createCompany(input: Omit<CompanyRecord, 'id' | 'createdAt' | 'updatedAt'>): CompanyRecord {
  const company: CompanyRecord = {
    id: `company-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  companies.push(company);
  return { ...company };
}

export function findCompanyById(companyId: string): CompanyRecord | undefined {
  return companies.find((c) => c.id === companyId);
}

export function listCompanies(): CompanyRecord[] {
  return companies.map((c) => ({ ...c }));
}

// ============================================
// BRANCH MANAGEMENT
// ============================================

export function createBranch(input: Omit<BranchRecord, 'id' | 'createdAt' | 'updatedAt'>): BranchRecord {
  const branch: BranchRecord = {
    id: `branch-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  branches.push(branch);
  return { ...branch };
}

export function findBranchById(branchId: string): BranchRecord | undefined {
  return branches.find((b) => b.id === branchId);
}

export function listBranchesByCompany(companyId: string): BranchRecord[] {
  return branches
    .filter((b) => b.companyId === companyId)
    .map((b) => ({ ...b }));
}

// ============================================
// ENHANCED USER MANAGEMENT
// ============================================

export function createEnhancedUser(
  input: Omit<EnhancedUserRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): EnhancedUserRecord {
  const { id, ...rest } = input;
  const user: EnhancedUserRecord = {
    id: id ?? `user-${Math.random().toString(36).slice(2, 9)}`,
    ...rest,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  enhancedUsers.push(user);
  return { ...user };
}

export function findUserById(userId: string): EnhancedUserRecord | undefined {
  return enhancedUsers.find((u) => u.id === userId);
}

export function findUserByEmail(email: string): EnhancedUserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return enhancedUsers.find((u) => u.email.toLowerCase() === normalized);
}

export function listUsersByCompany(companyId: string): EnhancedUserRecord[] {
  return enhancedUsers
    .filter((u) => u.companyId === companyId)
    .map((u) => ({ ...u }));
}

export function updateUserLastLogin(userId: string): EnhancedUserRecord {
  const user = enhancedUsers.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');
  user.lastLogin = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  return { ...user };
}

// ============================================
// BIOMETRIC MANAGEMENT
// ============================================

export function createBiometricCredential(input: Omit<BiometricCredentialRecord, 'id' | 'createdAt' | 'updatedAt'>): BiometricCredentialRecord {
  const credential: BiometricCredentialRecord = {
    id: `biometric-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  biometricCredentials.push(credential);
  return { ...credential };
}

export function findBiometricByUserId(userId: string): BiometricCredentialRecord | undefined {
  return biometricCredentials.find((b) => b.userId === userId);
}

// ============================================
// LOCATION MANAGEMENT
// ============================================

export function createLocation(input: Omit<LocationRecord, 'id' | 'createdAt' | 'updatedAt'>): LocationRecord {
  const location: LocationRecord = {
    id: `loc-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  locations.push(location);
  return { ...location };
}

export function listLocationsByBranch(branchId: string): LocationRecord[] {
  return locations
    .filter((l) => l.branchId === branchId)
    .map((l) => ({ ...l }));
}

// ============================================
// ITEM MANAGEMENT
// ============================================

export function listItemsByCompany(companyId: string): ItemRecord[] {
  return items
    .filter((i) => i.companyId === companyId)
    .map((i) => ({ ...i }));
}

export function listItems(): ItemRecord[] {
  return items.map((i) => ({ ...i }));
}

// ============================================
// COUNT MANAGEMENT
// ============================================

export function createCountRecord(input: Omit<CountRecord, 'id' | 'createdAt' | 'updatedAt'>): CountRecord {
  const record: CountRecord = {
    id: `count-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    variancePercentage: input.bookQty > 0 ? (input.variance / input.bookQty) * 100 : 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  counts.push(record);
  return { ...record };
}

export function findCountById(countId: string): CountRecord | undefined {
  return counts.find((c) => c.id === countId);
}

export function listCountsByBranch(branchId: string, status?: CountRecord['status']): CountRecord[] {
  return counts
    .filter((c) => c.branchId === branchId && (!status || c.status === status))
    .map((c) => ({ ...c }));
}

export function listCountsByAssignee(userId: string): CountAssignmentRecord[] {
  return countAssignments
    .filter((c) => c.assignedToId === userId && c.status === 'ASSIGNED')
    .map((c) => ({ ...c }));
}

export function updateCountStatus(countId: string, status: CountRecord['status'], updates?: Partial<CountRecord>): CountRecord {
  const count = counts.find((c) => c.id === countId);
  if (!count) throw new Error('Count not found');
  count.status = status;
  if (updates) {
    Object.assign(count, updates);
  }
  count.updatedAt = new Date().toISOString();
  return { ...count };
}

export function approveCount(countId: string, reviewedBy: string, notes?: string): CountRecord {
  // Phase 5 step 13: approving a count here no longer "adjusts" a private
  // stockLedger array this module kept — that array was write-only (nothing
  // read it; it was a shadow stock truth of exactly the kind R1 retires).
  // Real variance posting lives in the count review flow
  // (inventory-posting-service); this legacy surface only records the review.
  return updateCountStatus(countId, 'APPROVED', {
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes,
  });
}

// ============================================
// TRANSFER MANAGEMENT
// ============================================

export function createTransferRecord(input: Omit<TransferRecord, 'id' | 'createdAt' | 'updatedAt'>): TransferRecord {
  const transfer: TransferRecord = {
    id: `transfer-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  transfers.push(transfer);
  return { ...transfer };
}

export function findTransferById(transferId: string): TransferRecord | undefined {
  return transfers.find((t) => t.id === transferId);
}

export function listTransfersByBranch(branchId: string): TransferRecord[] {
  const branchLocations = locations.filter((l) => l.branchId === branchId).map((l) => l.id);
  return transfers
    .filter((t) => branchLocations.includes(t.sourceLocationId) || branchLocations.includes(t.destinationLocationId))
    .map((t) => ({ ...t }));
}

export function updateTransferStatus(transferId: string, status: TransferRecord['status'], updates?: Partial<TransferRecord>): TransferRecord {
  const transfer = transfers.find((t) => t.id === transferId);
  if (!transfer) throw new Error('Transfer not found');
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

export function logAuditAction(input: Omit<AuditLogRecord, 'id' | 'createdAt'>): AuditLogRecord {
  const log: AuditLogRecord = {
    id: `audit-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  auditLogs.push(log);
  return { ...log };
}

export function listAuditLogsByCompany(companyId: string, limit: number = 100): AuditLogRecord[] {
  return auditLogs
    .filter((l) => l.companyId === companyId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((l) => ({ ...l }));
}

// ============================================
// COMPANY DATA QUERIES (for frontend)
// ============================================

export function findLocationsByCompanyId(companyId: string): LocationRecord[] {
  const companyBranches = branches.filter((b) => b.companyId === companyId);
  return locations.filter((l) => companyBranches.some((b) => b.id === l.branchId));
}

export function findItemsByCompanyId(companyId: string): ItemRecord[] {
  return items.filter((i) => i.companyId === companyId);
}

export function findCountsByCompanyId(companyId: string): CountRecord[] {
  const companyBranches = branches.filter((b) => b.companyId === companyId);
  const branchLocations = locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
  return counts.filter((c) => branchLocations.includes(c.locationId));
}

export function findTransfersByCompanyId(companyId: string): TransferRecord[] {
  const companyBranches = branches.filter((b) => b.companyId === companyId);
  const branchLocations = locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
  return transfers.filter((t) => branchLocations.includes(t.sourceLocationId) || branchLocations.includes(t.destinationLocationId));
}

// ============================================
// TRANSFER STATE MACHINE VALIDATION
// ============================================

interface StateTransition {
  from: string;
  to: string;
}

const validTransitions: StateTransition[] = [
  { from: 'PENDING', to: 'IN_TRANSIT' },
  { from: 'PENDING', to: 'CANCELLED' },
  { from: 'IN_TRANSIT', to: 'RECEIVED' },
  { from: 'IN_TRANSIT', to: 'CANCELLED' },
  { from: 'RECEIVED', to: 'RECEIVED' }, // terminal state
];

export function canTransitionTransfer(from: string, to: string): boolean {
  return validTransitions.some((t) => t.from === from && t.to === to);
}

export function updateTransferStatusSafe(transferId: string, newStatus: string): TransferRecord {
  const transfer = transfers.find((t) => t.id === transferId);
  if (!transfer) {
    throw new Error('Transfer not found');
  }

  if (!canTransitionTransfer(transfer.status, newStatus)) {
    throw new Error(`Invalid status transition: ${transfer.status} → ${newStatus}`);
  }

  transfer.status = newStatus as any;
  transfer.updatedAt = new Date().toISOString();
  return { ...transfer };
}

// ============================================
// PERMISSION & ROLE HELPERS
// ============================================

export const rolePermissions: Record<string, string[]> = {
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

export function getPermissionsForRole(role: string): string[] {
  return rolePermissions[role] || [];
}

export function userHasPermission(userId: string, permission: string): boolean {
  const user = enhancedUsers.find((u) => u.id === userId);
  if (!user) return false;
  const permissions = getPermissionsForRole(user.role);
  return permissions.includes(permission);
}

// Refresh-token session families now live in lib/session-store.ts (ADR-003):
// persisted, hashed, rotating, with reuse detection - not an in-process Map
// keyed by the raw token value.

// ============================================
// COUNT APPROVAL WORKFLOW
// ============================================

export function getPendingCountsForApproval(companyId: string): CountRecord[] {
  const companyBranches = branches.filter((b) => b.companyId === companyId);
  const branchLocations = locations.filter((l) => companyBranches.some((b) => b.id === l.branchId)).map((l) => l.id);
  return counts.filter((c) => branchLocations.includes(c.locationId) && c.status === 'PENDING');
}

export function rejectCount(countId: string, rejectedBy: string, reason: string): CountRecord {
  const count = counts.find((c) => c.id === countId);
  if (!count) throw new Error('Count not found');

  count.status = 'REJECTED';
  count.rejectedBy = rejectedBy;
  count.rejectedReason = reason;
  count.updatedAt = new Date().toISOString();

  return { ...count };
}
