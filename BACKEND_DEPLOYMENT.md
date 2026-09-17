# Backend Deployment Guide - Render.com

Your backend API needs to be deployed for the registration and login to work with the Hostinger frontend. Follow these steps to deploy to **Render.com** (free tier available).

---

## Quick Start (2 minutes)

### Step 1: Go to Render.com
Visit: https://render.com

### Step 2: Sign Up (if needed)
- Click "Get Started" 
- Sign up with GitHub or email
- (GitHub recommended - it connects directly to your repo)

### Step 3: Create New Web Service
- Go to Dashboard → New → Web Service
- Select your GitHub repository: `prateek160298-glitch/invexaretail`
- Click "Connect"

### Step 4: Configure Deployment
When prompted for configuration, fill in:

**Name:** `invexaretail-api`

**Root Directory:** `api`

**Build Command:** `npm install && npm run build`

**Start Command:** `npm start`

**Environment Variables** (add these):
```
NODE_ENV = production
PORT = 4000
ALLOWED_ORIGINS = https://invexaretail.com,https://www.invexaretail.com
JWT_SECRET = [Random string - Render auto-generates]
SEED_PASSWORD = ChangeMe123!
```

### Step 5: Deploy
- Click "Deploy"
- Wait 3-5 minutes for build to complete
- You'll get a URL like `https://invexaretail-api-xxxx.onrender.com`

---

## Update Hostinger Frontend

Once your backend is deployed on Render, update the frontend to point to it:

### Option A: Use Environment Variable (Recommended)
1. Build frontend with:
```bash
VITE_API_BASE="https://your-render-url.onrender.com" npm run build
```

2. Upload new `dist` to Hostinger as before

### Option B: Manual API Configuration
The frontend will automatically try to connect to `https://api.invexaretail.com`

You can:
1. Point your domain's `api` subdomain to the Render URL via DNS CNAME
2. Or ask Render to set up a custom domain

---

## Testing Registration

After deployment:

1. Go to https://invexaretail.com
2. Click "Register here"
3. Fill in:
   - Company Name: "Test Company"
   - Email: "admin@test.com"
   - Password: "Test@123"
   - Admin Name: "Your Name"

4. Click Register - should work now!

---

## Troubleshooting

### "Backend not responding" error
- Check Render dashboard → your service → Logs
- Leave `DATABASE_URL` unset for in-memory testing
- Verify `ALLOWED_ORIGINS` includes your Hostinger domain

### "CORS error"  
- The backend CORS is already configured for Hostinger
- If using a different domain, update `ALLOWED_ORIGINS` env variable

### Service won't start
- Check build logs on Render
- Ensure Node.js 22+ (already configured in package.json)

---

## Manual Setup Alternative

If you prefer to deploy yourself:

1. Ensure Node.js 22+ is installed
2. `cd api`
3. `npm install`
4. `npm run build`
5. `NODE_ENV=production npm start`
6. Server listens on port 4000

---

## Next Steps

- ✅ Backend deployed and running
- ✅ Frontend can now register and login
- ✅ In-memory storage for testing (no database needed)

**For production**, add a MySQL database:
1. Create database on your hosting
2. Add `DATABASE_URL` connection string
3. Redeploy

---

Need help? Check Render docs: https://render.com/docs
