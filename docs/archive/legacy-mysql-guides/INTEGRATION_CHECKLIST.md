# 🎯 Backend-Frontend Integration Checklist

## What's Been Done ✅

### Frontend (Hostinger)
- ✅ Registration page implemented and displaying
- ✅ Login form connected to `/api/v1/auth/login` endpoint
- ✅ Registration form connected to `/api/v1/auth/register-company` endpoint
- ✅ Frontend built and deployed to `https://invexaretail.com`
- ✅ CORS handling configured in frontend

### Backend (Ready to Deploy)
- ✅ Express.js backend built and tested
- ✅ Authentication endpoints ready: `/api/v1/auth/login`, `/api/v1/auth/register-company`
- ✅ CORS configured for Hostinger domain
- ✅ In-memory storage (no database needed for testing)
- ✅ Deployment files created (Procfile, render.yaml)
- ✅ Local startup scripts available (start-local.sh, start-local.bat)

---

## What You Need To Do ⚙️

### Option 1: Deploy to Render.com (RECOMMENDED - Free, 2 minutes)

1. Go to: https://DEPLOY_NOW.md (or click deploy button in DEPLOY_NOW.md)
2. Sign up with GitHub
3. Configure with these settings:
   - **Root Directory**: `api`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - Environment variables will be pre-filled
4. Click Deploy
5. Wait 3-5 minutes
6. Get your backend URL: `https://invexaretail-api-xxxx.onrender.com`

**Next**: Update frontend to use this URL (see Option A or B below)

---

### Option 2: Run Backend Locally (Testing Only)

If you want to test locally before deploying:

```bash
cd api
npm install
npm run build
./start-local.sh      # On Mac/Linux
# OR
start-local.bat       # On Windows
```

Server will run on `http://localhost:4000`

Test registration at: `http://localhost:5173` (with dev server)

---

## Connecting Frontend to Backend

### Method A: Using Render's Custom Domain (Best)

1. Deploy backend to Render.com (you get: `https://invexaretail-api-xxxx.onrender.com`)
2. In Render dashboard, go to Settings
3. Add Custom Domain: `api.invexaretail.com`
4. Frontend will automatically find it!
5. Done ✨

**Advantage**: No code changes needed, frontend just works

---

### Method B: Update Frontend Environment

1. Deploy backend to Render
2. Build frontend with backend URL:

```bash
cd web
VITE_API_BASE="https://invexaretail-api-xxxx.onrender.com" npm run build
```

3. Upload new `dist` to Hostinger
4. Done ✨

**Advantage**: Works immediately, no DNS changes needed

---

### Method C: DNS CNAME (Advanced)

1. Point your domain registrar's DNS:
   - CNAME record: `api.invexaretail.com` → Render URL
2. Frontend uses `https://api.invexaretail.com` (already configured)
3. Render routes the request to your backend

---

## Testing After Deployment

### 1. Test Backend Health
Visit: `https://[your-backend-url]/health`

Should show:
```json
{
  "ok": true,
  "service": "retail-inventory-api",
  "timestamp": "2026-09-09T..."
}
```

### 2. Test Registration Flow
1. Visit your Hostinger site: `https://invexaretail.com`
2. Click "Register here"
3. Fill in test data:
   - Company: "Test Company"
   - Email: "test@company.com"
   - Password: "Test@123"
   - Admin Name: "Test User"
4. Click Register

✅ Should see success message and redirect to dashboard

### 3. Test Login Flow
1. Use credentials from registration
2. Login should work
3. Dashboard should load with sample data

---

## Troubleshooting

### "Cannot reach api.invexaretail.com"
- Backend not deployed yet
- Deploy to Render first (see Option 1)

### "CORS error: Origin not allowed"
- Check Render environment variables
- Should have: `ALLOWED_ORIGINS=https://invexaretail.com,...`
- Or rebuild frontend with correct VITE_API_BASE

### "502 Bad Gateway"
- Render backend crashed or still building
- Check Render dashboard → Logs
- Usually resolves in 2-3 minutes

### "Invalid email or password" on test login
- Use credentials from registration (not hardcoded test credentials)
- Backend uses in-memory storage, so users only exist after registration
- To test with demo users, add them to persistence.ts

---

## Next Steps After Working

### For Production
1. Add real database (MySQL on Hostinger)
2. Configure `DATABASE_URL` connection string
3. User data will persist

### For Scaling
1. Add more backends on Render
2. Use load balancer
3. Add caching layer
4. Optimize database queries

---

## Quick Links

- **Render Dashboard**: https://dashboard.render.com
- **Backend Deployment Guide**: BACKEND_DEPLOYMENT.md
- **One-Click Deploy**: DEPLOY_NOW.md
- **API Documentation**: API_DOCUMENTATION.md

---

## Support

**If registration/login isn't working:**

1. Check Render logs: `dashboard.render.com` → your service → Logs
2. Verify ALLOWED_ORIGINS environment variable
3. Check browser console for CORS errors
4. Try Method B (rebuild frontend with explicit VITE_API_BASE)

**If deployment fails:**

1. Check Node.js version: needs 22+
2. Check build logs on Render
3. Verify all files are committed to GitHub
4. Try local build first: `cd api && npm run build`

---

✨ **Everything is ready!** Just deploy the backend and users can register/login! ✨
