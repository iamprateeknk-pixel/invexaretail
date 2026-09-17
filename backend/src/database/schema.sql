-- Retail Inventory Database Schema

CREATE DATABASE IF NOT EXISTS retail_inventory;
USE retail_inventory;

-- Users Table
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'store_user', 'warehouse_picker', 'auditor') NOT NULL DEFAULT 'store_user',
  status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (email),
  INDEX (role)
);

-- Locations Table
CREATE TABLE locations (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  type ENUM('warehouse', 'store', 'distribution') NOT NULL,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  zip_code VARCHAR(20),
  manager_id VARCHAR(36),
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id),
  INDEX (type),
  UNIQUE KEY unique_location_name (name)
);

-- Items Table
CREATE TABLE items (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  unit_price DECIMAL(10, 2),
  reorder_level INT DEFAULT 10,
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (sku),
  INDEX (category)
);

-- Stock Table (Inventory by location)
CREATE TABLE stock (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  location_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  quantity_physical INT DEFAULT 0,
  quantity_book INT DEFAULT 0,
  quantity_available INT DEFAULT 0,
  last_count_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  UNIQUE KEY unique_location_item (location_id, item_id),
  INDEX (location_id),
  INDEX (item_id)
);

-- Stock Lots Table
CREATE TABLE stock_lots (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  stock_id VARCHAR(36) NOT NULL,
  lot_number VARCHAR(100) NOT NULL,
  quantity INT DEFAULT 0,
  manufacture_date DATE,
  expiry_date DATE,
  received_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stock_id) REFERENCES stock(id),
  INDEX (lot_number),
  INDEX (stock_id)
);

-- Blind Counts Table
CREATE TABLE blind_counts (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  location_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  lot_number VARCHAR(100),
  physical_qty INT NOT NULL,
  counted_by_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  reviewed_by_id VARCHAR(36),
  reviewed_at TIMESTAMP,
  feedback TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (counted_by_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id),
  INDEX (status),
  INDEX (location_id),
  INDEX (created_at)
);

-- Transfers Table
CREATE TABLE transfers (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  source_location_id VARCHAR(36) NOT NULL,
  destination_location_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  lot_number VARCHAR(100),
  quantity INT NOT NULL,
  status ENUM('created', 'picked', 'dispatched', 'in_transit', 'received', 'completed', 'cancelled') DEFAULT 'created',
  created_by_id VARCHAR(36) NOT NULL,
  assigned_to_id VARCHAR(36),
  received_by_id VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (source_location_id) REFERENCES locations(id),
  FOREIGN KEY (destination_location_id) REFERENCES locations(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (created_by_id) REFERENCES users(id),
  FOREIGN KEY (assigned_to_id) REFERENCES users(id),
  FOREIGN KEY (received_by_id) REFERENCES users(id),
  INDEX (status),
  INDEX (source_location_id),
  INDEX (destination_location_id),
  INDEX (created_at)
);

-- Transfer Events Table
CREATE TABLE transfer_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  transfer_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  actor_id VARCHAR(36),
  event_data JSON,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transfer_id) REFERENCES transfers(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX (transfer_id),
  INDEX (created_at)
);

-- Picker Tasks Table
CREATE TABLE picker_tasks (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  transfer_id VARCHAR(36) NOT NULL,
  assigned_to_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
  picked_qty INT,
  damage_report TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (transfer_id) REFERENCES transfers(id),
  FOREIGN KEY (assigned_to_id) REFERENCES users(id),
  INDEX (status),
  INDEX (assigned_to_id),
  INDEX (created_at)
);

-- Upload Evidence Table
CREATE TABLE transfer_evidence (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  transfer_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  uploaded_by_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transfer_id) REFERENCES transfers(id),
  FOREIGN KEY (uploaded_by_id) REFERENCES users(id),
  INDEX (transfer_id)
);

-- Audit Logs Table
CREATE TABLE audit_logs (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id VARCHAR(36),
  changes JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX (user_id),
  INDEX (created_at),
  INDEX (entity_type)
);

-- Push Notification Tokens
CREATE TABLE device_tokens (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform ENUM('ios', 'android', 'web') NOT NULL,
  device_name VARCHAR(255),
  last_used TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX (user_id),
  INDEX (token)
);

-- Create indexes for performance
CREATE INDEX idx_blind_counts_date ON blind_counts(created_at);
CREATE INDEX idx_transfers_date ON transfers(created_at);
CREATE INDEX idx_stock_location ON stock(location_id);
CREATE INDEX idx_stock_item ON stock(item_id);

-- Sample Data
INSERT INTO users (id, email, password, name, role, status) VALUES
('admin-001', 'admin@retailinventory.com', '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8', 'Admin User', 'admin', 'active'),
('user-001', 'store@retailinventory.com', '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8', 'Store User', 'store_user', 'active'),
('picker-001', 'picker@retailinventory.com', '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8', 'Picker User', 'warehouse_picker', 'active'),
('auditor-001', 'auditor@retailinventory.com', '$2a$10$jkHsN7zQ9pL8mK3xN9vP9e8xQ9yR0sT1uV2wX3yZ4aB5cD6eF7gH8', 'Auditor User', 'auditor', 'active');

INSERT INTO locations (id, name, type, address, city, state, zip_code, manager_id, status) VALUES
('loc-001', 'Main Warehouse', 'warehouse', '123 Warehouse St', 'New York', 'NY', '10001', 'admin-001', 'active'),
('loc-002', 'Store #42', 'store', '456 Store Ave', 'Los Angeles', 'CA', '90001', 'user-001', 'active'),
('loc-003', 'Distribution Center', 'distribution', '789 DC Blvd', 'Chicago', 'IL', '60601', 'admin-001', 'active');

INSERT INTO items (id, sku, name, description, category, unit_price, reorder_level, status) VALUES
('item-001', 'SKU-001', 'Battery Pack AA', 'Alkaline AA Batteries Pack of 4', 'Electronics', 4.99, 50, 'active'),
('item-002', 'SKU-002', 'Water Bottle 1L', 'Stainless Steel Water Bottle', 'Hydration', 19.99, 20, 'active'),
('item-003', 'SKU-003', 'USB Cable Type-C', 'High Quality USB-C Cable 2m', 'Cables', 9.99, 100, 'active');

INSERT INTO stock (id, location_id, item_id, quantity_physical, quantity_book, quantity_available) VALUES
('stock-001', 'loc-001', 'item-001', 240, 250, 240),
('stock-002', 'loc-001', 'item-002', 45, 50, 45),
('stock-003', 'loc-002', 'item-001', 120, 100, 120);
