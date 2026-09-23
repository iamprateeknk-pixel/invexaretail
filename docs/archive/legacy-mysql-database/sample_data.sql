-- ============================================
-- Sample Data for Testing
-- Run AFTER schema.sql to populate test data
-- ============================================

USE invexaretail;

-- ============================================
-- SAMPLE COMPANIES
-- ============================================

INSERT INTO companies (id, name, email, phone, industry) VALUES
('comp-acme', 'Acme Retail Corp', 'admin@acmecorp.com', '+1-555-0100', 'Retail'),
('comp-fresh', 'Fresh Foods Inc', 'info@freshfoods.com', '+1-555-0200', 'Grocery'),
('comp-tech', 'Tech Store Ltd', 'hello@techstore.com', '+1-555-0300', 'Electronics')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE BRANCHES
-- ============================================

INSERT INTO branches (id, companyId, name, type, address, city, state, phone, managerName, managerEmail) VALUES
-- Acme Retail
('branch-acme-1', 'comp-acme', 'Downtown Store', 'store', '123 Main St', 'New York', 'NY', '+1-555-1001', 'John Smith', 'john@acmecorp.com'),
('branch-acme-2', 'comp-acme', 'Uptown Warehouse', 'warehouse', '456 North Ave', 'New York', 'NY', '+1-555-1002', 'Sarah Lee', 'sarah@acmecorp.com'),
-- Fresh Foods
('branch-fresh-1', 'comp-fresh', 'Central Market', 'store', '789 Market St', 'Los Angeles', 'CA', '+1-555-2001', 'Mike Johnson', 'mike@freshfoods.com'),
('branch-fresh-2', 'comp-fresh', 'Distribution Hub', 'warehouse', '321 Logistics Ln', 'Los Angeles', 'CA', '+1-555-2002', 'Lisa Chen', 'lisa@freshfoods.com'),
-- Tech Store
('branch-tech-1', 'comp-tech', 'Tech Plaza', 'store', '555 Silicon Ave', 'San Francisco', 'CA', '+1-555-3001', 'David Kumar', 'david@techstore.com')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE LOCATIONS
-- ============================================

INSERT INTO locations (id, branchId, companyId, name, description, aisle, shelf, bin) VALUES
-- Acme Retail Downtown
('loc-acme-1-1', 'branch-acme-1', 'comp-acme', 'Main Storage', 'Primary storage area', 'A', '1', 'A1-1'),
('loc-acme-1-2', 'branch-acme-1', 'comp-acme', 'Checkout Area', 'Front of store checkout', 'F', '1', 'F1-1'),
-- Acme Warehouse
('loc-acme-2-1', 'branch-acme-2', 'comp-acme', 'Warehouse A', 'Large items storage', 'A', '1', 'W-A1'),
('loc-acme-2-2', 'branch-acme-2', 'comp-acme', 'Warehouse B', 'Small items storage', 'B', '1', 'W-B1'),
-- Fresh Foods Market
('loc-fresh-1-1', 'branch-fresh-1', 'comp-fresh', 'Produce Section', 'Fresh fruits and vegetables', 'P', '1', 'P1-1'),
('loc-fresh-1-2', 'branch-fresh-1', 'comp-fresh', 'Dairy Section', 'Milk, cheese, yogurt', 'D', '1', 'D1-1'),
('loc-fresh-1-3', 'branch-fresh-1', 'comp-fresh', 'Frozen Foods', 'Frozen items', 'F', '1', 'F1-1'),
-- Fresh Foods Hub
('loc-fresh-2-1', 'branch-fresh-2', 'comp-fresh', 'Cold Storage', 'Temperature controlled', 'C', '1', 'C1-1'),
-- Tech Store
('loc-tech-1-1', 'branch-tech-1', 'comp-tech', 'Electronics Section', 'Phones, computers, accessories', 'E', '1', 'E1-1'),
('loc-tech-1-2', 'branch-tech-1', 'comp-tech', 'Demo Area', 'Display units', 'D', '1', 'D1-1')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE USERS
-- ============================================

INSERT INTO users (id, companyId, email, name, phone, role, assignedBranchId, active) VALUES
-- Acme Retail Users
('user-acme-1', 'comp-acme', 'john.smith@acmecorp.com', 'John Smith', '+1-555-1001', 'COMPANY_ADMIN', 'branch-acme-1', TRUE),
('user-acme-2', 'comp-acme', 'sarah.lee@acmecorp.com', 'Sarah Lee', '+1-555-1002', 'BRANCH_MANAGER', 'branch-acme-2', TRUE),
('user-acme-3', 'comp-acme', 'store.user@acmecorp.com', 'Tom Brown', '+1-555-1003', 'STORE_USER', 'branch-acme-1', TRUE),
('user-acme-4', 'comp-acme', 'picker@acmecorp.com', 'Alex Miller', '+1-555-1004', 'WAREHOUSE_PICKER', 'branch-acme-2', TRUE),
('user-acme-5', 'comp-acme', 'auditor@acmecorp.com', 'Emma Wilson', '+1-555-1005', 'AUDITOR', NULL, TRUE),
-- Fresh Foods Users
('user-fresh-1', 'comp-fresh', 'mike.johnson@freshfoods.com', 'Mike Johnson', '+1-555-2001', 'COMPANY_ADMIN', 'branch-fresh-1', TRUE),
('user-fresh-2', 'comp-fresh', 'lisa.chen@freshfoods.com', 'Lisa Chen', '+1-555-2002', 'BRANCH_MANAGER', 'branch-fresh-2', TRUE),
('user-fresh-3', 'comp-fresh', 'store.mgr@freshfoods.com', 'Rachel Green', '+1-555-2003', 'STORE_USER', 'branch-fresh-1', TRUE),
-- Tech Store Users
('user-tech-1', 'comp-tech', 'david.kumar@techstore.com', 'David Kumar', '+1-555-3001', 'COMPANY_ADMIN', 'branch-tech-1', TRUE),
('user-tech-2', 'comp-tech', 'tech.user@techstore.com', 'Chris Yang', '+1-555-3002', 'STORE_USER', 'branch-tech-1', TRUE)
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE ITEMS
-- ============================================

INSERT INTO items (id, companyId, sku, name, description, category, unit, reorderLevel, price, costPrice, barcode) VALUES
-- Acme Retail Items
('item-acme-1', 'comp-acme', 'SKU-A001', 'Premium Rice 5kg', 'High quality basmati rice', 'Groceries', 'bag', 20, 25.99, 15.00, '1234567890001'),
('item-acme-2', 'comp-acme', 'SKU-A002', 'Organic Tea 250g', 'Loose leaf organic tea', 'Beverages', 'box', 15, 12.99, 7.50, '1234567890002'),
('item-acme-3', 'comp-acme', 'SKU-A003', 'Cooking Oil 2L', 'Pure vegetable cooking oil', 'Oils', 'bottle', 10, 8.99, 5.00, '1234567890003'),
('item-acme-4', 'comp-acme', 'SKU-A004', 'Sugar 1kg', 'Refined white sugar', 'Staples', 'bag', 25, 3.99, 2.50, '1234567890004'),
('item-acme-5', 'comp-acme', 'SKU-A005', 'Flour 2kg', 'All-purpose wheat flour', 'Staples', 'bag', 20, 4.99, 3.00, '1234567890005'),
-- Fresh Foods Items
('item-fresh-1', 'comp-fresh', 'SKU-F001', 'Fresh Apples', 'Red delicious apples per kg', 'Produce', 'kg', 50, 1.99, 1.00, '1234567890101'),
('item-fresh-2', 'comp-fresh', 'SKU-F002', 'Whole Milk 1L', 'Fresh pasteurized whole milk', 'Dairy', 'liter', 30, 2.49, 1.50, '1234567890102'),
('item-fresh-3', 'comp-fresh', 'SKU-F003', 'Cheese 500g', 'Cheddar cheese block', 'Dairy', 'block', 15, 8.99, 5.50, '1234567890103'),
('item-fresh-4', 'comp-fresh', 'SKU-F004', 'Frozen Pizza', 'Frozen pepperoni pizza', 'Frozen', 'box', 20, 6.99, 4.00, '1234567890104'),
-- Tech Store Items
('item-tech-1', 'comp-tech', 'SKU-T001', 'USB Cable 2m', 'High speed USB-C cable', 'Accessories', 'piece', 50, 9.99, 4.00, '1234567890201'),
('item-tech-2', 'comp-tech', 'SKU-T002', 'Phone Case', 'Universal smartphone case', 'Accessories', 'piece', 100, 14.99, 6.00, '1234567890202'),
('item-tech-3', 'comp-tech', 'SKU-T003', 'Wireless Mouse', 'Bluetooth wireless mouse', 'Peripherals', 'piece', 25, 29.99, 15.00, '1234567890203'),
('item-tech-4', 'comp-tech', 'SKU-T004', 'Screen Protector', 'Tempered glass protector', 'Accessories', 'pack', 75, 4.99, 2.00, '1234567890204')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE STOCK
-- ============================================

INSERT INTO stock_ledger (id, itemId, locationId, companyId, onHand, booked, available, lastCountedBy) VALUES
-- Acme Downtown Stock
('stock-acme-1-1', 'item-acme-1', 'loc-acme-1-1', 'comp-acme', 150, 30, 120, 'user-acme-3'),
('stock-acme-1-2', 'item-acme-2', 'loc-acme-1-1', 'comp-acme', 80, 10, 70, 'user-acme-3'),
('stock-acme-1-3', 'item-acme-3', 'loc-acme-1-1', 'comp-acme', 200, 50, 150, 'user-acme-3'),
-- Acme Warehouse Stock
('stock-acme-2-1', 'item-acme-1', 'loc-acme-2-1', 'comp-acme', 500, 100, 400, 'user-acme-4'),
('stock-acme-2-2', 'item-acme-4', 'loc-acme-2-2', 'comp-acme', 300, 50, 250, 'user-acme-4'),
-- Fresh Foods Stock
('stock-fresh-1-1', 'item-fresh-1', 'loc-fresh-1-1', 'comp-fresh', 200, 20, 180, 'user-fresh-3'),
('stock-fresh-1-2', 'item-fresh-2', 'loc-fresh-1-2', 'comp-fresh', 100, 10, 90, 'user-fresh-3'),
('stock-fresh-1-3', 'item-fresh-4', 'loc-fresh-1-3', 'comp-fresh', 150, 30, 120, 'user-fresh-3'),
-- Tech Store Stock
('stock-tech-1-1', 'item-tech-1', 'loc-tech-1-1', 'comp-tech', 300, 50, 250, 'user-tech-2'),
('stock-tech-1-2', 'item-tech-3', 'loc-tech-1-1', 'comp-tech', 50, 10, 40, 'user-tech-2')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE STOCK COUNTS (Pending Tasks)
-- ============================================

INSERT INTO stock_counts (id, companyId, itemId, locationId, assignedToId, assignedById, bookQuantity, countMode, status, assignedAt, dueDate, createdAt) VALUES
-- Acme Counts
('count-acme-1', 'comp-acme', 'item-acme-1', 'loc-acme-1-1', 'user-acme-3', 'user-acme-1', 150, 'scan', 'ASSIGNED', NOW() - INTERVAL 2 HOUR, NOW() + INTERVAL 1 HOUR, NOW() - INTERVAL 2 HOUR),
('count-acme-2', 'comp-acme', 'item-acme-2', 'loc-acme-1-1', 'user-acme-3', 'user-acme-1', 80, 'manual', 'ASSIGNED', NOW() - INTERVAL 5 HOUR, NOW() - INTERVAL 2 HOUR, NOW() - INTERVAL 5 HOUR),
('count-acme-3', 'comp-acme', 'item-acme-3', 'loc-acme-1-1', 'user-acme-3', 'user-acme-1', 200, 'scan', 'ASSIGNED', NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 6 HOUR, NOW() - INTERVAL 1 DAY),
-- Fresh Foods Counts
('count-fresh-1', 'comp-fresh', 'item-fresh-1', 'loc-fresh-1-1', 'user-fresh-3', 'user-fresh-1', 200, 'manual', 'ASSIGNED', NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 2 HOUR, NOW() - INTERVAL 1 HOUR),
('count-fresh-2', 'comp-fresh', 'item-fresh-2', 'loc-fresh-1-2', 'user-fresh-3', 'user-fresh-1', 100, 'scan', 'ASSIGNED', NOW() - INTERVAL 3 HOUR, NOW() + INTERVAL 30 MINUTE, NOW() - INTERVAL 3 HOUR)
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE TRANSFERS
-- ============================================

INSERT INTO transfers (id, companyId, itemId, fromLocationId, toLocationId, quantity, status, initiatedById, initiatedAt, expectedDeliveryDate) VALUES
('transfer-acme-1', 'comp-acme', 'item-acme-1', 'loc-acme-2-1', 'loc-acme-1-1', 100, 'IN_TRANSIT', 'user-acme-2', NOW() - INTERVAL 2 DAY, NOW() + INTERVAL 1 DAY),
('transfer-acme-2', 'comp-acme', 'item-acme-4', 'loc-acme-2-2', 'loc-acme-1-1', 50, 'PENDING', 'user-acme-2', NOW() - INTERVAL 4 HOUR, NOW() + INTERVAL 1 DAY),
('transfer-fresh-1', 'comp-fresh', 'item-fresh-1', 'loc-fresh-2-1', 'loc-fresh-1-1', 75, 'IN_TRANSIT', 'user-fresh-2', NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 4 HOUR)
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- SAMPLE AUDIT LOGS
-- ============================================

INSERT INTO audit_logs (id, companyId, userId, action, resourceType, resourceId, description, status) VALUES
('audit-1', 'comp-acme', 'user-acme-1', 'COMPANY_CREATED', 'company', 'comp-acme', 'Company created', 'success'),
('audit-2', 'comp-acme', 'user-acme-1', 'BRANCH_CREATED', 'branch', 'branch-acme-1', 'Branch created', 'success'),
('audit-3', 'comp-acme', 'user-acme-1', 'USER_CREATED', 'user', 'user-acme-3', 'Store user created', 'success'),
('audit-4', 'comp-acme', 'user-acme-3', 'COUNT_ASSIGNED', 'stock_count', 'count-acme-1', 'Stock count assigned', 'success'),
('audit-5', 'comp-fresh', 'user-fresh-1', 'TRANSFER_INITIATED', 'transfer', 'transfer-fresh-1', 'Transfer initiated', 'success')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check companies
SELECT 'Companies' as `Table`, COUNT(*) as Count FROM companies;

-- Check branches
SELECT 'Branches' as `Table`, COUNT(*) as Count FROM branches;

-- Check locations
SELECT 'Locations' as `Table`, COUNT(*) as Count FROM locations;

-- Check users
SELECT 'Users' as `Table`, COUNT(*) as Count FROM users;

-- Check items
SELECT 'Items' as `Table`, COUNT(*) as Count FROM items;

-- Check stock
SELECT 'Stock' as `Table`, COUNT(*) as Count FROM stock_ledger;

-- Check pending counts
SELECT 'Pending Counts' as `Table`, COUNT(*) as Count FROM stock_counts WHERE status = 'ASSIGNED';

-- Check transfers
SELECT 'Transfers' as `Table`, COUNT(*) as Count FROM transfers;

-- Check audit logs
SELECT 'Audit Logs' as `Table`, COUNT(*) as Count FROM audit_logs;

-- ============================================
-- DONE! Sample data loaded
-- ============================================
