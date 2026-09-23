-- ============================================
-- InvexaRetail - MySQL Database Schema
--
-- NOT USED BY THE RUNNING API. Kept for reference only.
--
-- This builds lowercase tables (users, companies, branches, ...) for an
-- earlier design. The API runs on Prisma and queries `User`, `Location`,
-- `Item`, ... — MySQL on Linux is case-sensitive, so importing this file
-- makes every login fail with 401.
--
-- Import invexaretail-database.sql in the repository root instead.
-- ============================================

-- Create Database
CREATE DATABASE IF NOT EXISTS invexaretail;
USE invexaretail;

-- ============================================
-- 1. COMPANIES TABLE
-- ============================================
CREATE TABLE companies (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  industry VARCHAR(100),
  logoUrl VARCHAR(500),
  active BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (active),
  INDEX idx_createdAt (createdAt)
);

-- ============================================
-- 2. BRANCHES TABLE
-- ============================================
CREATE TABLE branches (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('store', 'warehouse', 'office') DEFAULT 'store',
  address VARCHAR(500),
  city VARCHAR(100),
  state VARCHAR(100),
  zipCode VARCHAR(20),
  phone VARCHAR(20),
  managerName VARCHAR(255),
  managerEmail VARCHAR(255),
  active BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_companyId (companyId),
  INDEX idx_active (active),
  UNIQUE KEY unique_company_branch (companyId, name)
);

-- ============================================
-- 3. LOCATIONS TABLE
-- ============================================
CREATE TABLE locations (
  id VARCHAR(50) PRIMARY KEY,
  branchId VARCHAR(50) NOT NULL,
  companyId VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  aisle VARCHAR(50),
  shelf VARCHAR(50),
  bin VARCHAR(50),
  active BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_branchId (branchId),
  INDEX idx_companyId (companyId),
  INDEX idx_active (active),
  UNIQUE KEY unique_branch_location (branchId, name)
);

-- ============================================
-- 4. USERS TABLE
-- ============================================
CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  passwordHash VARCHAR(255),
  role ENUM('COMPANY_ADMIN', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR') DEFAULT 'STORE_USER',
  assignedBranchId VARCHAR(50),
  assignedLocations JSON,
  active BOOLEAN DEFAULT TRUE,
  lastLogin TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (assignedBranchId) REFERENCES branches(id) ON DELETE SET NULL,
  INDEX idx_companyId (companyId),
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_active (active),
  UNIQUE KEY unique_company_email (companyId, email)
);

-- ============================================
-- 5. OTP SESSIONS TABLE
-- ============================================
CREATE TABLE otp_sessions (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otpCode VARCHAR(6) NOT NULL,
  otpHash VARCHAR(255) NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  attempts INT DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_expiresAt (expiresAt)
);

-- ============================================
-- 6. BIOMETRIC CREDENTIALS TABLE
-- ============================================
CREATE TABLE biometric_credentials (
  id VARCHAR(50) PRIMARY KEY,
  userId VARCHAR(50) NOT NULL,
  companyId VARCHAR(50) NOT NULL,
  type ENUM('pin', 'face', 'fingerprint') NOT NULL,
  dataHash VARCHAR(500) NOT NULL,
  verified BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_userId (userId),
  INDEX idx_companyId (companyId),
  INDEX idx_type (type),
  UNIQUE KEY unique_user_type (userId, type)
);

-- ============================================
-- 7. ITEMS TABLE
-- ============================================
CREATE TABLE items (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  unit VARCHAR(50),
  reorderLevel INT DEFAULT 10,
  reorderQuantity INT DEFAULT 50,
  price DECIMAL(10, 2),
  costPrice DECIMAL(10, 2),
  barcode VARCHAR(100),
  imageUrl VARCHAR(500),
  active BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_companyId (companyId),
  INDEX idx_sku (sku),
  INDEX idx_barcode (barcode),
  INDEX idx_active (active),
  UNIQUE KEY unique_company_sku (companyId, sku)
);

-- ============================================
-- 8. STOCK LEDGER TABLE
-- ============================================
CREATE TABLE stock_ledger (
  id VARCHAR(50) PRIMARY KEY,
  itemId VARCHAR(50) NOT NULL,
  locationId VARCHAR(50) NOT NULL,
  companyId VARCHAR(50) NOT NULL,
  onHand INT DEFAULT 0,
  booked INT DEFAULT 0,
  available INT DEFAULT 0,
  lastCountedAt TIMESTAMP NULL,
  lastCountedBy VARCHAR(50),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (locationId) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_itemId (itemId),
  INDEX idx_locationId (locationId),
  INDEX idx_companyId (companyId),
  UNIQUE KEY unique_item_location (itemId, locationId)
);

-- ============================================
-- 9. STOCK COUNTS TABLE
-- ============================================
CREATE TABLE stock_counts (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  itemId VARCHAR(50) NOT NULL,
  locationId VARCHAR(50) NOT NULL,
  assignedToId VARCHAR(50),
  assignedById VARCHAR(50),
  bookQuantity INT,
  physicalQuantity INT,
  variance INT,
  variancePercent DECIMAL(5, 2),
  countMode ENUM('scan', 'manual') DEFAULT 'manual',
  notes TEXT,
  status ENUM('ASSIGNED', 'SUBMITTED', 'APPROVED', 'REJECTED') DEFAULT 'ASSIGNED',
  assignedAt TIMESTAMP NOT NULL,
  dueDate TIMESTAMP NOT NULL,
  submittedAt TIMESTAMP NULL,
  submittedBy VARCHAR(50),
  approvedAt TIMESTAMP NULL,
  approvedBy VARCHAR(50),
  rejectionReason TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (locationId) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (assignedToId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assignedById) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (submittedBy) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_companyId (companyId),
  INDEX idx_status (status),
  INDEX idx_assignedAt (assignedAt),
  INDEX idx_dueDate (dueDate),
  INDEX idx_assignedToId (assignedToId),
  INDEX idx_itemId (itemId)
);

-- ============================================
-- 10. TRANSFERS TABLE
-- ============================================
CREATE TABLE transfers (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  itemId VARCHAR(50) NOT NULL,
  fromLocationId VARCHAR(50) NOT NULL,
  toLocationId VARCHAR(50) NOT NULL,
  quantity INT NOT NULL,
  cartonCount INT,
  status ENUM('PENDING', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') DEFAULT 'PENDING',
  initiatedById VARCHAR(50),
  initiatedAt TIMESTAMP NOT NULL,
  expectedDeliveryDate TIMESTAMP,
  actualDeliveryDate TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (fromLocationId) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (toLocationId) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (initiatedById) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_companyId (companyId),
  INDEX idx_status (status),
  INDEX idx_initiatedAt (initiatedAt)
);

-- ============================================
-- 11. TRANSFER RECEIPTS TABLE
-- ============================================
CREATE TABLE transfer_receipts (
  id VARCHAR(50) PRIMARY KEY,
  transferId VARCHAR(50) NOT NULL,
  companyId VARCHAR(50) NOT NULL,
  receivedQuantity INT DEFAULT 0,
  damagedQuantity INT DEFAULT 0,
  shortageQuantity INT DEFAULT 0,
  receivedById VARCHAR(50),
  receivedAt TIMESTAMP NOT NULL,
  notes TEXT,
  photoUrls JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (transferId) REFERENCES transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (receivedById) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_transferId (transferId),
  INDEX idx_companyId (companyId)
);

-- ============================================
-- 12. AUDIT LOGS TABLE
-- ============================================
CREATE TABLE audit_logs (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  userId VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  resourceType VARCHAR(50),
  resourceId VARCHAR(50),
  oldValues JSON,
  newValues JSON,
  description TEXT,
  ipAddress VARCHAR(50),
  userAgent VARCHAR(500),
  status ENUM('success', 'failure') DEFAULT 'success',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_companyId (companyId),
  INDEX idx_userId (userId),
  INDEX idx_action (action),
  INDEX idx_createdAt (createdAt),
  INDEX idx_resourceType (resourceType)
);

-- ============================================
-- 13. STOCK VARIANCE TABLE
-- ============================================
CREATE TABLE stock_variance (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  itemId VARCHAR(50) NOT NULL,
  locationId VARCHAR(50) NOT NULL,
  bookQuantity INT,
  physicalQuantity INT,
  variance INT,
  variancePercent DECIMAL(5, 2),
  varianceValue DECIMAL(10, 2),
  reason VARCHAR(255),
  approvedById VARCHAR(50),
  approvedAt TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (locationId) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (approvedById) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_companyId (companyId),
  INDEX idx_createdAt (createdAt)
);

-- ============================================
-- 14. EXPIRY TRACKING TABLE
-- ============================================
CREATE TABLE expiry_tracking (
  id VARCHAR(50) PRIMARY KEY,
  companyId VARCHAR(50) NOT NULL,
  itemId VARCHAR(50) NOT NULL,
  locationId VARCHAR(50) NOT NULL,
  batchNumber VARCHAR(100),
  expiryDate DATE NOT NULL,
  quantity INT,
  status ENUM('ACTIVE', 'EXPIRING_SOON', 'EXPIRED') DEFAULT 'ACTIVE',
  alertSentAt TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (locationId) REFERENCES locations(id) ON DELETE CASCADE,
  INDEX idx_companyId (companyId),
  INDEX idx_expiryDate (expiryDate),
  INDEX idx_status (status)
);

-- ============================================
-- SAMPLE DATA (Optional)
-- ============================================

-- Sample Company
INSERT INTO companies (id, name, email, phone, industry)
VALUES ('company-1', 'Acme Retail Corp', 'admin@acmecorp.com', '+1-555-0100', 'Retail')
ON DUPLICATE KEY UPDATE id=id;

-- Sample Branch
INSERT INTO branches (id, companyId, name, type, city, state, managerName, managerEmail)
VALUES ('branch-1', 'company-1', 'Downtown Store', 'store', 'New York', 'NY', 'John Manager', 'john@acmecorp.com')
ON DUPLICATE KEY UPDATE id=id;

-- Sample Location
INSERT INTO locations (id, branchId, companyId, name, aisle, shelf)
VALUES ('loc-1', 'branch-1', 'company-1', 'Main Storage', 'A', '1')
ON DUPLICATE KEY UPDATE id=id;

-- Sample Item
INSERT INTO items (id, companyId, sku, name, category, unit, price, costPrice)
VALUES ('item-1', 'company-1', 'SKU-001', 'Premium Rice 5kg', 'Groceries', 'bag', 25.99, 15.00)
ON DUPLICATE KEY UPDATE id=id;

-- Sample Stock
INSERT INTO stock_ledger (id, itemId, locationId, companyId, onHand, booked, available)
VALUES ('stock-1', 'item-1', 'loc-1', 'company-1', 100, 20, 80)
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Additional performance indexes
ALTER TABLE users ADD INDEX idx_email_company (email, companyId);
ALTER TABLE stock_counts ADD INDEX idx_company_status (companyId, status);
ALTER TABLE transfers ADD INDEX idx_company_status (companyId, status);
ALTER TABLE audit_logs ADD INDEX idx_company_action_date (companyId, action, createdAt);

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- View: Pending Counts with Item Details
CREATE OR REPLACE VIEW v_pending_counts AS
SELECT
  c.id as countId,
  c.companyId,
  c.status,
  i.name as itemName,
  i.sku,
  l.name as locationName,
  c.bookQuantity,
  c.assignedToId,
  u.name as assignedToName,
  c.assignedAt,
  c.dueDate,
  c.createdAt,
  TIMESTAMPDIFF(HOUR, c.dueDate, NOW()) as hoursOverdue
FROM stock_counts c
JOIN items i ON c.itemId = i.id
JOIN locations l ON c.locationId = l.id
LEFT JOIN users u ON c.assignedToId = u.id
WHERE c.status = 'ASSIGNED'
ORDER BY c.dueDate ASC;

-- View: Stock Summary
CREATE OR REPLACE VIEW v_stock_summary AS
SELECT
  s.companyId,
  COUNT(*) as totalItems,
  SUM(s.onHand) as totalOnHand,
  SUM(s.booked) as totalBooked,
  SUM(s.available) as totalAvailable,
  COUNT(CASE WHEN s.available < i.reorderLevel THEN 1 END) as itemsNeedingReorder
FROM stock_ledger s
JOIN items i ON s.itemId = i.id
GROUP BY s.companyId;

-- View: Dashboard Metrics
CREATE OR REPLACE VIEW v_dashboard_metrics AS
SELECT
  c.id as companyId,
  c.name as companyName,
  COUNT(DISTINCT i.id) as totalItems,
  COALESCE((SELECT COUNT(*) FROM stock_counts WHERE companyId = c.id AND status = 'ASSIGNED'), 0) as pendingTasksCount,
  COALESCE((SELECT COUNT(*) FROM transfers WHERE companyId = c.id AND status IN ('PENDING', 'IN_TRANSIT')), 0) as inTransitTransfersCount,
  COALESCE((SELECT COUNT(*) FROM stock_counts WHERE companyId = c.id AND status = 'SUBMITTED'), 0) as submittedCountsCount,
  COALESCE((SELECT COUNT(*) FROM stock_counts WHERE companyId = c.id AND status = 'APPROVED'), 0) as approvedCountsCount
FROM companies c
LEFT JOIN items i ON c.id = i.companyId
GROUP BY c.id, c.name;

-- ============================================
-- DONE! Database is ready
-- ============================================
