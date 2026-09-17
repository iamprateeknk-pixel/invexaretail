# MySQL Database Setup Guide

> **Do not import `database/schema.sql`.** It builds a lowercase `users` table
> for a different design. The API runs on Prisma, which queries `User`, and
> MySQL on Linux is case-sensitive — so importing it leaves every login
> failing with a 401 that looks like a wrong password.
>
> Import `invexaretail-database.sql` in the repository root instead. It is
> generated from `api/prisma/schema.prisma`, so it cannot drift from the code.
> `database/schema.sql` and `backend/src/database/schema.sql` are kept only
> for reference and are not used by the running API.

## 🚀 Quick Setup (2 Steps)

### Step 1: Create Database and Tables

```bash
mysql -u <user> -p <database> < invexaretail-database.sql
```

Or in phpMyAdmin: select the database, open the **Import** tab, choose
`invexaretail-database.sql`, and press Go.

This drops and recreates the tables, so take a backup first if the database
holds anything worth keeping.

Alternatively, let Prisma build the schema and seed it:

```bash
cd api
npm run db:migrate
npm run db:seed
```

To confirm the database matches what the API expects:

```bash
cd api && node scripts/diagnose.cjs
```

### Step 2: Update API Configuration

Edit `api/.env`:

```env
DATABASE_URL=mysql://root:password@localhost:3306/invexaretail
```

**That's it!** 🎉 Database is ready!

---

## 📋 What Gets Created

### Tables (14 total)

1. **companies** - Multi-tenant support
2. **branches** - Store/Warehouse/Office locations
3. **locations** - Specific storage locations (aisle/shelf/bin)
4. **users** - Team members with roles
5. **items** - Products in inventory
6. **stock_ledger** - Current stock levels
7. **stock_counts** - Physical counts (ASSIGNED → SUBMITTED → APPROVED)
8. **transfers** - Stock movements between locations
9. **transfer_receipts** - Receiving details with damage/shortage tracking
10. **otp_sessions** - OTP verification records
11. **biometric_credentials** - Fingerprint/Face/PIN data (hashed)
12. **audit_logs** - Complete action history
13. **stock_variance** - Variance analysis
14. **expiry_tracking** - Expiry date monitoring

### Views (3 total)

1. **v_pending_counts** - Pending tasks with timestamps
2. **v_stock_summary** - Stock overview by company
3. **v_dashboard_metrics** - Dashboard KPIs

### Sample Data Included

- 1 Sample Company (Acme Retail Corp)
- 1 Sample Branch (Downtown Store)
- 1 Sample Location (Main Storage)
- 1 Sample Item (Premium Rice 5kg)
- 1 Sample Stock Entry

---

## 🔧 Database Configuration

### MySQL Connection String

```env
# .env file
DATABASE_URL=mysql://username:password@host:port/database
```

Examples:
```env
# Local development
DATABASE_URL=mysql://root:password@localhost:3306/invexaretail

# Localhost without password
DATABASE_URL=mysql://root@localhost:3306/invexaretail

# Production
DATABASE_URL=mysql://prod_user:secure_password@prod-db.example.com:3306/invexaretail
```

### Connection Pool Settings (Optional)

```env
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_CONNECT_TIMEOUT=5000
DB_IDLE_TIMEOUT=30000
```

---

## 🎯 Key Features in Schema

### Multi-Tenant Isolation
```sql
-- Every table has companyId
-- Data is completely isolated per company
SELECT * FROM stock_counts WHERE companyId = 'company-1';
```

### Role-Based Access
```
COMPANY_ADMIN     - Full company access
BRANCH_MANAGER    - Branch-level access
STORE_USER        - Store/inventory access
WAREHOUSE_PICKER  - Transfer picking only
AUDITOR           - Read-only reporting
```

### Timestamp Tracking
```sql
-- Every count has:
assignedAt        - When task was assigned
dueDate           - When it's due
submittedAt       - When user submitted
approvedAt        - When admin approved

-- Enables:
- "Assigned 2 hours ago"
- "Due in 45 minutes"
- "OVERDUE by 3 hours"
```

### Stock Variance Tracking
```sql
-- Automatic calculation:
variance = physicalQuantity - bookQuantity
variancePercent = (variance / bookQuantity) * 100

-- Enables:
- Variance reports
- Discrepancy analysis
- Automatic alerts
```

### Audit Trail
```sql
-- Every action logged:
- Who did it (userId)
- What they did (action)
- When (createdAt)
- What changed (oldValues → newValues)
- Where from (ipAddress, userAgent)

-- Example actions:
- 'COUNT_SUBMITTED'
- 'COUNT_APPROVED'
- 'TRANSFER_INITIATED'
- 'USER_CREATED'
- 'PASSWORD_CHANGED'
```

---

## 🔒 Security Features

### Password Hashing
```sql
-- Users table has passwordHash
-- Stores bcrypt-hashed passwords only
-- Plain passwords never stored
```

### Biometric Data Hashing
```sql
-- biometric_credentials table
-- All data is hashed (PIN, Face, Fingerprint)
-- Hashes are environment-specific
-- Data never exposed in logs or APIs
```

### Role-Based Queries
```sql
-- Company Admin sees all company data
-- Branch Manager sees only their branch
-- Store User sees only their assigned locations
-- Auditor sees read-only reports

-- Enabled by:
- companyId in every table
- branchId for location filtering
- assignedLocations JSON array per user
```

---

## 📊 Common Queries

### Get Pending Counts
```sql
SELECT * FROM v_pending_counts
WHERE companyId = 'company-1'
ORDER BY dueDate ASC;
```

### Get Stock Summary
```sql
SELECT * FROM v_stock_summary
WHERE companyId = 'company-1';
```

### Get Dashboard Metrics
```sql
SELECT * FROM v_dashboard_metrics
WHERE companyId = 'company-1';
```

### Get Audit Log
```sql
SELECT * FROM audit_logs
WHERE companyId = 'company-1'
AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
ORDER BY createdAt DESC;
```

### Get Stock for Location
```sql
SELECT
  i.sku,
  i.name,
  s.onHand,
  s.booked,
  s.available,
  s.lastCountedAt
FROM stock_ledger s
JOIN items i ON s.itemId = i.id
WHERE s.locationId = 'loc-1'
AND s.onHand > 0;
```

### Get Pending Counts Overdue
```sql
SELECT * FROM stock_counts
WHERE companyId = 'company-1'
AND status = 'ASSIGNED'
AND dueDate < NOW()
ORDER BY dueDate ASC;
```

---

## 🚨 Backup & Restore

### Backup Database
```bash
# Full database backup
mysqldump -u root -p invexaretail > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup specific table
mysqldump -u root -p invexaretail stock_counts > stock_counts_backup.sql
```

### Restore Database
```bash
# Restore from backup
mysql -u root -p invexaretail < backup_20240101_120000.sql

# Restore specific table
mysql -u root -p invexaretail < stock_counts_backup.sql
```

### Scheduled Backups (Linux/Mac)
```bash
# Add to crontab (run daily at 2 AM)
0 2 * * * mysqldump -u root -p'password' invexaretail > /backup/invexaretail_$(date +\%Y\%m\%d).sql
```

---

## 🐛 Troubleshooting

### Connection Error
```
Error: Can't connect to MySQL server
```
**Solution:**
- Verify MySQL is running: `sudo systemctl status mysql`
- Check username/password
- Check host and port in connection string

### Access Denied
```
Error: Access denied for user 'root'@'localhost'
```
**Solution:**
- Check password is correct
- Verify user has database privileges
- Grant privileges: `GRANT ALL ON invexaretail.* TO 'root'@'localhost';`

### Table Already Exists
```
Error: Table 'companies' already exists
```
**Solution:**
- Drop database: `DROP DATABASE invexaretail;`
- Run schema.sql again

### Foreign Key Constraint Error
```
Error: Cannot add or modify row because of foreign key constraint
```
**Solution:**
- Ensure parent records exist first
- Insert companies before branches
- Insert branches before locations
- Sample data included to prevent this

---

## 🔄 Switching from In-Memory to MySQL

The backend currently uses in-memory storage. To switch to MySQL:

### Step 1: Install MySQL Driver
```bash
cd api
npm install mysql2 sequelize
```

### Step 2: Update Configuration
Edit `api/src/index.ts`:
```typescript
// Replace enterprise-repository.ts (in-memory)
// With database models using sequelize

import { connectDatabase } from './lib/database.js';

await connectDatabase(process.env.DATABASE_URL);
```

### Step 3: Update Routes
Routes already use generic repository methods, so they'll work with database without changes.

**No API changes needed!** 🎉

---

## 📈 Performance Optimization

### Indexes Already Included
```sql
-- Automatically created for:
- company lookups (companyId)
- user authentication (email)
- role-based queries
- status filtering
- date range queries
```

### Query Optimization Tips
```sql
-- Good: Uses indexes
SELECT * FROM stock_counts 
WHERE companyId = '1' AND status = 'ASSIGNED';

-- Avoid: Full table scan
SELECT * FROM stock_counts 
WHERE DATE(createdAt) = '2024-01-01';
```

### Recommended Indexes for High Volume
```sql
-- If you have millions of records, add:
ALTER TABLE stock_counts ADD INDEX idx_company_item (companyId, itemId);
ALTER TABLE transfers ADD INDEX idx_company_date (companyId, initiatedAt);
ALTER TABLE audit_logs ADD INDEX idx_company_resource (companyId, resourceType, resourceId);
```

---

## 🎓 Learn More

- [MySQL Documentation](https://dev.mysql.com/doc/)
- [Database Normalization](https://en.wikipedia.org/wiki/Database_normalization)
- [SQL Indexes](https://use-the-index-luke.com/)

---

## ✅ Checklist After Setup

- [ ] Database created: `invexaretail`
- [ ] 14 tables created
- [ ] 3 views created
- [ ] Sample data inserted
- [ ] Indexes built
- [ ] `.env` updated with DATABASE_URL
- [ ] Backend can connect to database
- [ ] Backup scheduled (if production)
- [ ] Access verified (can query tables)
- [ ] Ready for use! 🚀
