# Enterprise System Integration Guide

## 🎯 Overview

This guide describes the enterprise-grade features added to InvexaRetail, including:
- Multi-organization (company) support
- Email + OTP authentication
- Biometric login for mobile (Face, Fingerprint, PIN)
- Advanced user management with role hierarchy
- Comprehensive audit logging
- Enhanced dashboard with summary-only view
- Pending tasks tracking with timestamps
- Stock receiving with damage/shortage tracking

## 🔧 Backend Integration

### 1. Database Schema

New entities have been created in `api/src/lib/enterprise-repository.ts`:

```
Companies
├── name, email, phone, industry, plan
├── addressLine1, addressLine2, city, state, postalCode, country
└── Branches
    ├── name, type (store/warehouse)
    ├── address, city, state, phone
    └── Users (assigned to branch)
        ├── email, name, phone, role
        ├── branchIds, locationIds
        ├── passwordHash, otpSecret
        └── BiometricCredentials
            ├── pin4Digit (hashed)
            ├── faceDataHash (encrypted)
            └── fingerprintHash (encrypted)

Counts (Enhanced)
├── companyId, branchId
├── assignedAt, dueDate, completedAt (NEW TIMESTAMPS)
├── assignedBy, status (ASSIGNED, SUBMITTED, PENDING_REVIEW, APPROVED, REJECTED)
└── reviewedBy, reviewedAt, reviewNotes

Transfers (Enhanced)
├── companyId
├── dueDate, dispatchedAt, dispatchedBy
├── receivedAt, receivedBy
├── receivedQty, damagedQty, shortageQty (NEW RECEIVING FIELDS)
└── receiveNotes

AuditLog
├── companyId, userId, userName
├── action (CREATED, UPDATED, DELETED, APPROVED, etc.)
├── entityType, entityId, entityDescription
└── timestamp
```

### 2. API Routes to Add

Add to `api/src/index.ts`:

```typescript
import enterpriseAuthRouter from './routes/enterprise-auth.js';
import enterpriseManagementRouter from './routes/enterprise-management.js';
import enterpriseAnalyticsRouter from './routes/enterprise-analytics.js';

// Attach routes
app.use('/api/v1/auth', enterpriseAuthRouter);
app.use('/api/v1/admin', enterpriseManagementRouter);
app.use('/api/v1/analytics', enterpriseAnalyticsRouter);
```

### 3. Authentication Flow

**OTP-Based Login:**
1. `POST /api/v1/auth/send-otp` - Send OTP to email
2. `POST /api/v1/auth/verify-otp` - Verify OTP and get token

**Password Login (Backup):**
- `POST /api/v1/auth/login` - Email + password login

**Biometric (Mobile):**
- `POST /api/v1/auth/setup-biometric` - Setup face/fingerprint/PIN
- `POST /api/v1/auth/verify-biometric` - Login with biometric

**Token Management:**
- `POST /api/v1/auth/refresh-token` - Get new access token

### 4. Company & Branch Management

```
GET    /api/v1/admin/companies/:companyId
PUT    /api/v1/admin/companies/:companyId

GET    /api/v1/admin/companies/:companyId/branches
POST   /api/v1/admin/companies/:companyId/branches
PUT    /api/v1/admin/branches/:branchId
```

### 5. User Management

```
GET    /api/v1/admin/companies/:companyId/users
POST   /api/v1/admin/companies/:companyId/users
PUT    /api/v1/admin/users/:userId
DELETE /api/v1/admin/users/:userId
POST   /api/v1/admin/users/:userId/assign-branches
```

### 6. Analytics & Dashboard

```
GET    /api/v1/analytics/companies/:companyId/dashboard/summary
GET    /api/v1/analytics/companies/:companyId/analytics/pending-tasks
GET    /api/v1/analytics/companies/:companyId/analytics/today-tasks
GET    /api/v1/analytics/companies/:companyId/analytics/stock-receiving
GET    /api/v1/analytics/companies/:companyId/analytics/performance
GET    /api/v1/analytics/companies/:companyId/audit-logs
```

## 🎨 Frontend Architecture

### New Directory Structure

```
web/src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx (NEW)
│   │   ├── Header.jsx (NEW)
│   │   ├── MainLayout.jsx (NEW)
│   ├── auth/
│   │   ├── LoginForm.jsx (NEW - OTP flow)
│   │   ├── OtpVerification.jsx (NEW)
│   │   ├── CompanySetup.jsx (NEW)
│   ├── dashboard/
│   │   ├── Dashboard.jsx (REDESIGNED - summary only)
│   │   ├── QuickStats.jsx (NEW)
│   │   ├── PendingTasksList.jsx (NEW)
│   │   ├── TodayTasksList.jsx (NEW)
│   ├── inventory/
│   │   ├── StockView.jsx (NEW)
│   │   ├── ExpiryAlerts.jsx (NEW)
│   │   ├── StockReceiving.jsx (NEW)
│   ├── transfers/
│   │   ├── TransferList.jsx (NEW)
│   │   ├── TransferDetail.jsx (NEW)
│   ├── counts/
│   │   ├── CountsList.jsx (NEW)
│   │   ├── CountDetail.jsx (NEW - click to open with timestamps)
│   │   ├── CountReview.jsx (NEW)
│   ├── admin/
│   │   ├── CompanySetup.jsx (NEW)
│   │   ├── BranchManagement.jsx (NEW)
│   │   ├── UserManagement.jsx (NEW)
│   ├── common/
│   │   ├── Modal.jsx
│   │   ├── Toast.jsx
│   │   └── LoadingSpinner.jsx
├── context/
│   ├── AuthContext.jsx (NEW)
│   ├── CompanyContext.jsx (NEW)
├── hooks/
│   ├── useAuth.jsx (NEW)
│   ├── useApi.jsx (NEW)
│   ├── useOffline.jsx
├── utils/
│   ├── api.js (UPDATED)
│   ├── formatters.js (NEW)
│   ├── validators.js (NEW)
├── App.jsx (REDESIGNED)
└── main.jsx
```

### Key Improvements

**1. Dashboard - Summary Only**
```
┌─────────────────────────────────────────────┐
│ Dashboard - Quick Overview                  │
├─────────────────────────────────────────────┤
│ [Total Items: 45]  [Pending Tasks: 12]     │
│ [In Transit: 8]    [Variance %: 3.2%]      │
│                                             │
│ PENDING TASKS (click to open)              │
│ ├─ Item A (assigned 2h ago) - Due: 2h      │
│ ├─ Item B (assigned 5h ago) - Due: 1h      │
│ └─ Item C (assigned 1d ago) - OVERDUE!    │
│                                             │
│ TODAY'S TASKS                               │
│ ├─ Item D (assigned today)                 │
│ └─ Item E (assigned today)                 │
│                                             │
│ STOCK RECEIVING                             │
│ ├─ Transfer #1: 5/8 received (62%)         │
│ ├─ Transfer #2: 0/3 received (0%)          │
│ └─ Damage: 2 units, Shortage: 1 unit       │
└─────────────────────────────────────────────┘
```

**2. Sidebar Navigation**
```
├─ Dashboard
├─ Inventory
│  ├─ Stock View
│  ├─ Expiry Alerts
│  └─ Stock Receiving
├─ Transfers
│  ├─ Active Transfers
│  ├─ History
│  └─ Thermal Labels
├─ Counts
│  ├─ Pending Counts
│  ├─ Submitted
│  └─ Approved
├─ Reports & Analytics
│  ├─ Variance Report
│  ├─ Performance
│  └─ Audit Log
└─ Admin
   ├─ Company Settings
   ├─ Branches
   ├─ Users
   └─ Team Assignments
```

**3. Pending Counts - Click to Open**
When clicking a pending count, show:
- Item name, code, category
- Lot number, expiry date
- Location
- **Assigned At** (timestamp)
- **Due Date** (if set)
- **Assigned By** (who assigned)
- Submit form for physical quantity
- Photo capture option
- Notes field
- Submit button

**4. Advanced Features**

Variance Report:
```
Item          | Book Qty | Physical | Variance | % | Status
Premium Rice  | 45       | 41       | -4       | -8.9% | SHORTAGE
Organic Tea   | 120      | 128      | 8        | 6.7% | OVERAGE
Water Bottle  | 80       | 76       | -4       | -5.0% | SHORTAGE
```

Transfer Status Flow:
```
SUBMITTED → REQUESTED → PICKING → PICKED → IN_TRANSIT → DISPATCHED
                                                           ↓
                                            PARTIALLY_RECEIVED / RECEIVED → CLOSED
                                                           ↓ (Optional)
                                                       REJECTED
```

## 📱 Mobile App Enhancements

### Auth Flow

```
1. Login Screen
   ├─ Email input
   ├─ Password / OTP toggle
   └─ "Setup Biometric" link

2. OTP Verification
   ├─ 6-digit OTP input
   └─ "Resend OTP" button

3. Biometric Setup (After First Login)
   ├─ 4-digit PIN setup
   ├─ Face ID setup (optional)
   ├─ Fingerprint setup (optional)
   └─ "Continue" button

4. Dashboard
   ├─ Summary cards
   ├─ Pending tasks
   └─ Quick actions
```

### Persistent Login

After biometric setup, app auto-login on:
- App restart (using stored encrypted credentials)
- 4-digit PIN entry
- Face ID / Fingerprint scan

## 🔐 Security Considerations

1. **JWT Tokens**
   - Access Token: 1 hour expiration
   - Refresh Token: 7 days expiration
   - Secret key: Use environment variable

2. **Password Hashing**
   - Use bcrypt in production (currently SHA-256)
   - Minimum 8 characters, uppercase, lowercase, number

3. **OTP Security**
   - 6-digit code, 10-minute expiration
   - 3 attempts per code, 5 requests per 15 minutes
   - Rate limiting on email sending

4. **Biometric Data**
   - Never store raw biometric data
   - Hash all biometric data
   - Encrypt sensitive fields in storage

5. **Audit Logging**
   - Log all user actions
   - Track creation, updates, approvals
   - Store IP address, user agent

## ✅ Migration Checklist

- [ ] Create `enterprise-repository.ts` with new data models
- [ ] Create `otp-auth.ts` with OTP and biometric utilities
- [ ] Create `enterprise-auth.ts` routes
- [ ] Create `enterprise-management.ts` routes
- [ ] Create `enterprise-analytics.ts` routes
- [ ] Add route imports to main `index.ts`
- [ ] Create seed data with sample companies, users, branches
- [ ] Redesign React App.jsx with new structure
- [ ] Create new React components for dashboard, sidebar, admin
- [ ] Update mobile app with biometric login
- [ ] Add form validation on frontend
- [ ] Update API documentation
- [ ] Add integration tests
- [ ] Deploy to production

## 🚀 Getting Started

### 1. Create Company (Onboarding)
```bash
curl -X POST http://localhost:4000/api/v1/auth/register-company \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp",
    "email": "admin@acmecorp.com",
    "password": "SecurePass123",
    "adminName": "John Admin",
    "industry": "Retail"
  }'
```

### 2. Create Branch
```bash
curl -X POST http://localhost:4000/api/v1/admin/companies/{companyId}/branches \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Store",
    "type": "store",
    "city": "New York",
    "phone": "555-1234"
  }'
```

### 3. Create User
```bash
curl -X POST http://localhost:4000/api/v1/admin/companies/{companyId}/users \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "name": "Store User",
    "role": "STORE_USER",
    "branchIds": ["{branchId}"]
  }'
```

### 4. Request OTP Login
```bash
curl -X POST http://localhost:4000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

### 5. Verify OTP and Login
```bash
curl -X POST http://localhost:4000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otpCode": "123456"
  }'
```

## 📊 Next Steps

1. **Seed Data** - Create sample companies, branches, users
2. **Frontend Rebuild** - Create new React components
3. **Mobile Update** - Add biometric login to Flutter app
4. **Testing** - Write comprehensive tests
5. **Deployment** - Deploy to production with proper configurations
