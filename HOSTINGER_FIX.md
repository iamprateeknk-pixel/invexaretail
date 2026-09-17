# 🔧 Hostinger Deployment Issues & Fixes

## Issues Found

### 1. ❌ Service Worker 503 Error
**Problem**: `sw.js` was in `web/src/` but needs to be in `web/public/` for Nginx to serve it correctly.

**Fixed**: 
- ✅ Moved `web/src/sw.js` → `web/public/sw.js`
- ✅ Updated `web/nginx.conf` to serve service worker with proper MIME type and cache headers
- ✅ Updated `web/vite.config.js` to explicitly handle public directory

### 2. ❌ API Login 401 Error
**Problem**: `POST /api/v1/auth/login` returning 401 (Invalid credentials)

**Causes**:
- Database not initialized/migrated
- No seed data (demo users not created)
- Database connection failing

**Fix Required**:
```bash
# 1. SSH into Hostinger VPS
ssh your_user@your_server.com

# 2. Navigate to project
cd /path/to/retail-inventory

# 3. Run database migrations
docker-compose exec api npm run db:migrate

# 4. Seed demo data
docker-compose exec api npm run db:seed

# 5. Verify database connection
docker-compose exec api npm run db:validate
```

### 3. ❌ Service Worker Registration Error
**Problem**: Message channel closed before response received

**Status**: Will be fixed once service worker is properly served (issue #1)

---

## Production Deployment Checklist

### Environment Variables (`.env`)
Ensure these are set on Hostinger:

```bash
# Database
DATABASE_URL=mysql://retail:retail_password@mysql:3306/retail_inventory

# API
JWT_SECRET=your-secret-key-change-this
PORT=4000
UPLOAD_DIR=/app/uploads

# Frontend
VITE_API_BASE=https://api.invexaretail.com
NODE_ENV=production
```

### Deployment Steps

#### 1. **On Hostinger VPS**

```bash
# Clone/update repo
cd /path/to/retail-inventory
git fetch origin
git checkout main  # or your branch

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Wait for database to be ready
sleep 10

# Initialize database
docker-compose exec api npm run db:migrate
docker-compose exec api npm run db:seed

# Verify services
docker-compose ps
docker-compose logs -f
```

#### 2. **Test Connectivity**

```bash
# Test API health
curl https://api.invexaretail.com/health

# Test web portal
curl -I https://invexaretail.com/

# Test login (should succeed)
curl -X POST https://api.invexaretail.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@retail.local","password":"ChangeMe123!"}'
```

#### 3. **Verify Frontend**

- Open https://invexaretail.com/
- Check browser console - should show "Service Worker registered" (not 503)
- Try login with demo credentials:
  - Email: `admin@retail.local`
  - Password: `ChangeMe123!`

---

## Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@retail.local | ChangeMe123! |
| Store User | store@retail.local | ChangeMe123! |
| Warehouse Picker | picker@retail.local | ChangeMe123! |
| Auditor | auditor@retail.local | ChangeMe123! |

---

## Files Changed

1. ✅ `web/public/sw.js` - Moved service worker to correct location
2. ✅ `web/nginx.conf` - Added proper service worker headers and caching
3. ✅ `web/vite.config.js` - Added explicit public directory configuration

---

## Testing Locally (Before Deploying)

```bash
# Build frontend
cd web
npm run build

# Test service worker is in dist
ls -la dist/sw.js  # Should exist

# Start full stack
docker-compose up -d

# Check frontend loads service worker
curl -I http://localhost:5173/sw.js  # Should be 200, not 503
```

---

## Rollback (If Needed)

```bash
git reset --hard HEAD~1
docker-compose down -v
docker-compose up -d
```

---

## Next Steps

1. Push these fixes to Hostinger branch
2. SSH into Hostinger and pull latest changes
3. Run `docker-compose down && docker-compose up -d --build`
4. Wait 30 seconds for containers to start
5. Run database setup: `docker-compose exec api npm run db:migrate && npm run db:seed`
6. Test via browser at https://invexaretail.com/
7. Check console - service worker should register successfully
8. Try logging in with demo credentials

---

## Support Commands

```bash
# View logs
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f mysql

# Check running containers
docker-compose ps

# Restart specific service
docker-compose restart api

# Full reset
docker-compose down -v && docker-compose up -d

# Database commands
docker-compose exec api npm run db:validate
docker-compose exec api npm run db:push
docker-compose exec api npm run db:seed
```
