# 🚀 Render Deployment - Step-by-Step Manual

## Current Situation
- ✅ Latest code committed to GitHub
- ✅ All files pushed to: `prateek160298-glitch/invexaretail`
- ⏳ Render is still running OLD code (pre-inventory endpoints)
- 🎯 Need to trigger MANUAL DEPLOY of latest commit

---

## Step 1: Access Render Dashboard

1. Go to: **https://dashboard.render.com**
2. Sign in with your GitHub account
3. You'll see your services list
4. Find: **invexaretail-api**

---

## Step 2: Trigger Manual Deployment

1. Click on **invexaretail-api** service
2. Look at the top of the page for "Deployments" section
3. You should see recent deploys with status
4. Click the **Manual Deploy** button (or "Deploy Latest Commit")
5. Select branch: **main** (default)
6. Click **Deploy**

*Screenshot should show:*
```
Service: invexaretail-api
Status: Running (Old version)
┌─────────────────────────────────┐
│  Deployments                    │
│  ─────────────────────────────  │
│  Current: Sep 9, 3:00 AM       │
│  [Manual Deploy ▼] [Logs]      │
└─────────────────────────────────┘
```

---

## Step 3: Wait for Deployment

1. Render will now BUILD the new code
2. You'll see logs showing:
   ```
   Building...
   Cloning repository
   Installing Node dependencies
   npm install
   npm run build
   Starting application
   listening on port 4000 ✅
   ```
3. Wait **3-5 minutes** for completion
4. Status changes from "Building" → "Live"

---

## Step 4: Verify Health Check

Once deployment completes:

1. Get your Render URL from dashboard (usually at top of service page)
   - Format: `https://invexaretail-api-[random].onrender.com`
   
2. Test health endpoint in browser:
   ```
   https://invexaretail-api-[random].onrender.com/health
   ```
   
3. Should see:
   ```json
   {
     "ok": true,
     "service": "retail-inventory-api",
     "timestamp": "2026-09-09T..."
   }
   ```

---

## Step 5: Test New Endpoints

Test the newly added endpoints:

### 5a. Test Locations Endpoint
```
GET https://[your-render-url]/api/v1/locations
Headers: Authorization: Bearer [your-jwt-token]
```

### 5b. Test Items Endpoint
```
GET https://[your-render-url]/api/v1/items
Headers: Authorization: Bearer [your-jwt-token]
```

### 5c. Test Dashboard Endpoint
```
GET https://[your-render-url]/api/v1/dashboard
Headers: Authorization: Bearer [your-jwt-token]
```

---

## Step 6: Test Full Registration Flow

### 6a. Open Frontend
1. Go to: **https://invexaretail.com**
2. Should see login page

### 6b. Click "Register here"
- Should see registration form with fields:
  - Company Name
  - Email
  - Password
  - Admin Name
  - Phone

### 6c. Fill in Test Data
```
Company Name: Test Company Sept 9
Email: test.sept9@example.com
Password: TestPass@123
Admin Name: Your Name
Phone: 9999999999
```

### 6d. Submit Registration
1. Click "Register" button
2. Should see **loading indicator**
3. After 2-3 seconds, should see:
   - ✅ Success message
   - Dashboard page loads
   - Sample data displays

### 6e. Verify No Errors
- Open browser DevTools (F12)
- Go to **Console** tab
- Should see **NO red errors**
- Check **Network** tab - all requests should be green (200 status)

---

## Step 7: Test Login with New Account

1. Log out (if dashboard shows logout option)
2. Go back to login page
3. Use credentials from registration:
   ```
   Email: test.sept9@example.com
   Password: TestPass@123
   ```
4. Should login successfully and see dashboard

---

## 🐛 Troubleshooting

### Problem: "502 Bad Gateway"
**Solution**: 
- App is still starting
- Wait 2-3 more minutes
- Refresh page

### Problem: "Cannot reach [url]"
**Solution**:
- Render URL might be different
- Check dashboard for correct URL
- Verify it's in format: https://invexaretail-api-[random].onrender.com

### Problem: "CORS error: Origin not allowed"
**Solution**:
- Backend ALLOWED_ORIGINS might not include Hostinger domain
- Check Render dashboard → Settings → Environment
- Should have: `ALLOWED_ORIGINS=https://invexaretail.com,https://www.invexaretail.com`

### Problem: "404 on /api/v1/items"
**Solution**:
- Old code still running
- Trigger manual deploy again
- Wait for "Live" status
- Hard refresh browser (Ctrl+Shift+R)

### Problem: "Cannot login" after registration
**Solution**:
- Check Render logs for database/storage errors
- Verify JWT_SECRET environment variable is set
- Try creating account with different email

### Problem: "Invalid email or password" on login
**Solution**:
- Use the EXACT email and password from registration
- In-memory storage means user only exists after registration
- Cannot use hardcoded test credentials

---

## ✅ Success Checklist

After deployment and testing, verify:

- [ ] Render health endpoint returns 200
- [ ] Frontend loads at https://invexaretail.com
- [ ] Registration form displays all fields
- [ ] Can create new account without errors
- [ ] Dashboard appears after registration
- [ ] Can login with registered credentials
- [ ] Browser console has no CORS errors
- [ ] Network requests all show 200-201 status
- [ ] Sample data loads in dashboard

---

## 📞 If Still Having Issues

1. **Check Render Logs**:
   - Dashboard → Your Service → Logs
   - Look for red error messages
   - Copy the error and investigate

2. **Try Local Test First**:
   ```bash
   cd api
   npm install
   npm run build
   npm start
   ```
   - Should start on http://localhost:4000
   - Test /health endpoint

3. **Verify GitHub Commit**:
   ```bash
   git log --oneline | head -5
   ```
   - Should show: "Fix: Add missing inventory endpoints..."

4. **Check Frontend Configuration**:
   - web/src/api-client.ts should have API_BASE
   - Default: https://api.invexaretail.com
   - Or uses VITE_API_BASE environment variable

---

## 🎯 Next Steps After Successful Deployment

1. ✅ Mark registration flow as WORKING
2. Create test accounts for different roles
3. Begin Phase 2: Implement transfer state machine
4. Plan MySQL/Prisma integration for production

---

## 📋 Deployment Details

**Service Name**: invexaretail-api
**Repository**: prateek160298-glitch/invexaretail
**Branch**: main
**Root Directory**: api
**Build Command**: npm install && npm run build
**Start Command**: npm start
**Environment**: Free tier (sufficient for MVP)
**Region**: Oregon
**Node Version**: 22+ (configured in package.json)

---

## 💾 Important: Data Persistence

**Current Setting**: `DATABASE_URL` unset (in-memory seed data)
- Data stored in-memory
- Lost on server restart
- Acceptable for testing
- Users created via registration survive until next restart

**To Enable MySQL** (when ready for production):
1. Add DATABASE_URL environment variable
2. Update Prisma configuration
3. Run migrations: npx prisma migrate deploy

---

**Status**: Ready to deploy! Follow steps above to complete. 🚀

