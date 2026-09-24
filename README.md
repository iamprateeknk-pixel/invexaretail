# 🏪 Retail Inventory Warehouse Transfer App

> Enterprise-grade inventory management system for retail stores and warehouses with blind count validation, inter-location transfers, and comprehensive audit logging.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-green.svg)]()
[![Version: 1.0.0](https://img.shields.io/badge/Version-1.0.0-blue.svg)]()

---

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Roles & Permissions](#roles--permissions)
- [Workflows](#workflows)
- [Deployment](#deployment)
- [Mobile App](#mobile-app)
- [Documentation](#documentation)
- [Support](#support)

---

## ✨ Features

### Core Inventory Management
- ✅ Real-time stock visibility by location
- ✅ Multi-warehouse support with hierarchical locations
- ✅ Item master data with lot number tracking
- ✅ Stock variance calculation & analysis
- ✅ Inventory valuation

### Blind Count System
- ✅ Blind count submission (no book quantity visibility to users)
- ✅ Multi-mode counting (manual, barcode scan)
- ✅ Lot-level tracking with expiry dates
- ✅ Variance validation & approval workflow
- ✅ Audit trail for all counts

### Transfer Management
- ✅ Inter-location transfer requests
- ✅ Status workflow (REQUESTED → PICKED → DISPATCHED → RECEIVED → CLOSED)
- ✅ Warehouse picker task assignment
- ✅ Quantity confirmation at each step
- ✅ Damage & loss tracking
- ✅ Evidence upload support (photos, documents)

### Role-Based Access Control
- ✅ **ADMIN**: Full system access
- ✅ **STORE_USER**: Count submission, transfer initiation
- ✅ **WAREHOUSE_PICKER**: Item picking & confirmation
- ✅ **AUDITOR**: Read-only audit & reports
- ✅ Location-based scoping

### Reporting & Analytics
- ✅ Dashboard with KPIs
- ✅ Audit trail logging
- ✅ Stock variance reports
- ✅ Transfer performance metrics
- ✅ CSV export for counts & transfers
- ✅ Location-wise reporting

### Data Integrity
- ✅ Optimistic locking (version control)
- ✅ Transaction consistency (PostgreSQL)
- ✅ Comprehensive audit logging
- ✅ Data validation at every step
- ✅ Backup & disaster recovery

---

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js 22 (LTS)
- **Framework**: Express.js 5.x
- **Language**: TypeScript
- **ORM**: Prisma (PostgreSQL)
- **Database**: PostgreSQL 17
- **Authentication**: JWT (jsonwebtoken)
- **Security**: bcrypt, helmet, cors
- **API Rate Limiting**: express-rate-limit
- **File Handling**: multer, sharp, exceljs

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite
- **Styling**: CSS 3 (custom, no framework)
- **State**: React Hooks
- **HTTP**: Fetch API
- **Package Manager**: npm

### DevOps & Deployment
- **Containerization**: Docker & Docker Compose
- **Server**: Nginx (web) + Node (API)
- **SSL/TLS**: Let's Encrypt (certbot)
- **Database**: PostgreSQL 17 in Docker
- **Hosting**: Cloudflare Workers (web), Railway (API, worker, PostgreSQL)

### Testing
- **Unit Testing**: Node test runner (built-in)
- **Integration**: Custom test suites
- **E2E**: Manual testing framework

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 17+ (if not using Docker)
- Git

### 1. Clone Repository

```bash
git clone https://github.com/your-repo/retail-inventory.git
cd retail-inventory
```

### 2. Setup Environment

```bash
# Copy example env file
cp api/.env.example api/.env

# Edit with your settings
nano api/.env
```

### 3. Start with Docker Compose

```bash
# Start all services (PostgreSQL, API, Web)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 4. Access Application

- **Web Portal**: http://localhost:5173
- **API**: http://localhost:4000/api/v1
- **API Health**: http://localhost:4000/health

### 5. Login Credentials

Demo accounts (seeded automatically):

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@retail.local | ChangeMe123! |
| Store User | store@retail.local | ChangeMe123! |
| Warehouse Picker | picker@retail.local | ChangeMe123! |
| Auditor | auditor@retail.local | ChangeMe123! |

---

## 🏗️ Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    User Browsers                         │
│              (Web Portal @ :5173)                        │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼────────────┐   ┌───────▼────────────┐
│    React SPA       │   │  Nginx Reverse     │
│  (Frontend)        │   │  Proxy (443/SSL)   │
│  Port: 5173        │   │  Port: 443         │
└────────────────────┘   └───────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Express.js API       │
                    │   (Backend)            │
                    │   Port: 4000           │
                    │                        │
                    │ • Authentication       │
                    │ • Stock Management     │
                    │ • Transfers            │
                    │ • Audit Logging        │
                    └────────────┬───────────┘
                                 │
        ┌────────────┬───────────┴────────────┬──────────┐
        │            │                        │          │
┌───────▼──────┐ ┌──▼──────────┐ ┌──────────▼──┐  Local
│ PostgreSQL   │ │  File Store │ │  Memory     │  Cache
│   Database   │ │  (uploads)  │ │  Cache      │
└──────────────┘ └─────────────┘ └─────────────┘
```

### Data Flow

```
User Action
    ↓
[Web Portal] ──JWT Token──> [Express API]
    ↑                           ↓
    │                    [Validation & Auth]
    │                           ↓
    └────[Response]──────────[Database]
                                ↓
                          [Audit Log]
```

---

## 📁 Project Structure

```
retail-inventory/
├── api/                          # Backend API
│   ├── src/
│   │   ├── index.ts              # Express app & routes
│   │   ├── middleware/
│   │   │   └── auth.ts           # JWT verification
│   │   └── lib/
│   │       ├── auth.ts           # Authentication logic
│   │       ├── inventory.ts      # Business logic
│   │       ├── persistence.ts    # Database operations
│   │       ├── repository.ts     # Data access
│   │       ├── dashboard.ts      # Reports
│   │       ├── picker.ts         # Picker tasks
│   │       └── audit.ts          # Audit logging
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   └── migrations/           # DB migrations
│   ├── Dockerfile                # Container image
│   ├── package.json
│   └── tsconfig.json
│
├── web/                          # Frontend SPA
│   ├── src/
│   │   ├── App.jsx               # Main app component
│   │   ├── App.css               # Styling
│   │   └── main.jsx              # Entry point
│   ├── public/                   # Static assets
│   ├── Dockerfile                # Container image
│   ├── nginx.conf                # Nginx configuration
│   ├── package.json
│   └── vite.config.js
│
├── docker-compose.yml            # Docker Compose setup
├── .env.example                  # Environment template
│
├── docs/deployment-railway-cloudflare.md  # Railway + Cloudflare deployment
├── MOBILE_APP_PLAN.md            # React Native app plan
├── API_DOCUMENTATION.md          # API reference
├── README.md                     # This file
└── LICENSE
```

---

## 👥 Roles & Permissions

### ADMIN
- ✅ Create & manage locations
- ✅ Approve/reject blind counts
- ✅ Create & dispatch transfers
- ✅ Manage picker assignments
- ✅ View all reports & audit logs
- ✅ Manage users & roles
- ✅ System configuration

### STORE_USER
- ✅ Submit blind counts for assigned location
- ✅ Initiate transfers to warehouse
- ✅ Receive transferred items
- ✅ View assigned location stock (no book qty)
- ✅ Upload evidence photos

### WAREHOUSE_PICKER
- ✅ View assigned pick tasks
- ✅ Pick items with barcode scanning
- ✅ Confirm quantities picked
- ✅ Report damaged items
- ✅ Upload evidence for transfers
- ✅ View warehouse inventory

### AUDITOR
- ✅ View all counts (read-only)
- ✅ View all transfers (read-only)
- ✅ Access audit trail
- ✅ Generate reports
- ✅ Export data (CSV)
- ❌ Create or approve transactions

---

## 🔄 Workflows

### Blind Count Workflow

```
1. STORE_USER submits physical count
   ├─ No access to book quantity (blind)
   ├─ System calculates variance server-side
   └─ Count goes to PENDING_REVIEW
        │
2. ADMIN reviews count
   ├─ APPROVE ──> Stock variance recorded
   └─ REJECT ───> Count discarded
```

### Transfer Workflow

```
1. STORE_USER/ADMIN initiates transfer
   ├─ Source: Store (STORE_USER) or Any (ADMIN)
   ├─ Destination: Usually warehouse
   └─ Status: REQUESTED
        │
2. WAREHOUSE_PICKER picks items
   ├─ Confirms quantity via barcode scan
   ├─ Reports damages/losses
   └─ Status: PICKED
        │
3. ADMIN dispatches transfer
   ├─ Approves picked quantity
   └─ Status: DISPATCHED
        │
4. STORE_USER receives items
   ├─ Confirms receipt
   └─ Status: RECEIVED
        │
5. Transfer closed
   └─ Stock levels updated
```

---

## 📚 API Endpoints

All endpoints require authentication (`Bearer <JWT_TOKEN>`):

### Authentication
- `POST /login` - User login

### Stock Management
- `GET /stock/:locationId` - View stock by location
- `POST /stock-counts` - Submit blind count
- `GET /counts` - List counts
- `PATCH /stock-counts/:id/review` - Approve/reject count

### Transfers
- `POST /transfers` - Create transfer request
- `GET /transfers/list` - List all transfers
- `PATCH /transfers/:id/status` - Update transfer status
- `POST /transfers/:id/evidence` - Upload evidence

### Inventory
- `GET /items` - List items
- `POST /items` - Create item
- `POST /imports/items` - Bulk import

### Reports & Audit
- `GET /dashboard` - Dashboard summary
- `GET /reports/:locationId` - Location report
- `GET /audit` - Audit log
- `GET /exports/counts.csv` - Export counts

### Picker Tasks
- `GET /picker-tasks` - List picker tasks
- `POST /picker-tasks/complete` - Complete task

**Full documentation**: See [API_DOCUMENTATION.md](API_DOCUMENTATION.md)

---

## 🔒 Security Features

- ✅ JWT authentication with token expiry
- ✅ bcrypt password hashing
- ✅ CORS & CSRF protection
- ✅ Rate limiting (240 req/min per IP)
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS protection (helmet headers)
- ✅ HTTPS/SSL (Let's Encrypt)
- ✅ Role-based access control
- ✅ Location-based scoping
- ✅ Audit logging for all actions

---

## 📱 Deployment

### Local Development

```bash
docker-compose up
# Access at http://localhost:5173
```

### Production (Cloudflare + Railway)

Follow the guide: [docs/deployment-railway-cloudflare.md](docs/deployment-railway-cloudflare.md)

Quick summary:
1. Railway: an API service, a separate worker service (`api/railway.worker.json`) and a PostgreSQL service
2. Cloudflare Workers Builds: `invexaretail-web` (root `web`, `npm run build` / `npm run deploy`)
3. Set `VITE_API_BASE` on the web build to the API's public HTTPS domain
4. Keep `ALLOWED_ORIGINS` on the API in sync with the web origin

---

## 📱 Mobile App

React Native mobile app is in development. See [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md) for details.

**Planned Features:**
- iOS & Android native support
- Barcode scanner integration
- Camera for photo evidence
- Offline-first synchronization
- Real-time push notifications

**Timeline**: Q4 2026

---

## 📖 Documentation

- [API_DOCUMENTATION.md](API_DOCUMENTATION.md) - Complete API reference
- [docs/deployment-railway-cloudflare.md](docs/deployment-railway-cloudflare.md) - Railway + Cloudflare deployment steps
- [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md) - Mobile app architecture
- `api/README.md` - Backend setup
- `web/README.md` - Frontend setup

---

## 🧪 Testing

### Run Tests

```bash
# Unit tests
docker-compose exec api npm run test

# View coverage
docker-compose exec api npm run test:coverage
```

### Manual Testing

1. Login with different roles
2. Test blind count submission
3. Create transfers between locations
4. Complete picker tasks
5. Review audit logs

---

## 📊 Database Schema

Key tables:
- `users` - User accounts with roles
- `locations` - Stores & warehouses
- `items` - Inventory items
- `lots` - Lot numbers with expiry
- `stock_ledger` - Current stock levels
- `stock_counts` - Blind count records
- `transfers` - Transfer requests
- `transfer_lines` - Items in transfer
- `audit_logs` - All system actions

See `api/prisma/schema.prisma` for complete schema.

---

## 🐛 Troubleshooting

### Docker issues
```bash
# View logs
docker-compose logs [service]

# Restart service
docker-compose restart [service]

# Full reset
docker-compose down -v
docker-compose up
```

### Database connection failed
```bash
# Verify PostgreSQL is healthy
docker compose exec postgres pg_isready -U retail -d retail_inventory

# Check environment variables
docker-compose exec api env | grep DATABASE
```

### API not responding
```bash
# Check API logs
docker-compose logs api

# Test health endpoint
curl http://localhost:4000/health
```

See [docs/deployment-railway-cloudflare.md](docs/deployment-railway-cloudflare.md) for deployment details.

---

## 📋 Changelog

### v1.0.0 (2026-09-08)
- ✅ Initial release
- ✅ Core inventory management
- ✅ Blind count system
- ✅ Transfer workflow
- ✅ Role-based access
- ✅ Audit logging
- ✅ REST API
- ✅ Web portal (React)

### v1.1.0 (Planned)
- 📱 Mobile app (React Native)
- 🔔 Push notifications
- 📊 Advanced reporting
- 🔐 Two-factor authentication

---

## 📞 Support

- **Issues**: GitHub Issues (create an issue)
- **Email**: support@retail-inventory.app
- **Documentation**: See `/docs` folder

---

## 📄 License

ISC License - See [LICENSE](LICENSE) file

---

## 🙌 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 🎯 Roadmap

- [x] Backend API
- [x] Web portal
- [x] Deployment guide
- [ ] Mobile app (iOS/Android)
- [ ] Advanced analytics
- [ ] Machine learning for anomaly detection
- [ ] Real-time WebSocket updates
- [ ] Multi-language support
- [ ] Mobile app v1.0

---

**Made with ❤️ for retail & warehouse management**

© 2026 Retail Inventory Team. All rights reserved.
