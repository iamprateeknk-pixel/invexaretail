# 🚀 Deploy Backend Now - One Click!

The backend is ready to deploy. Click the link below to deploy to Render.com in seconds:

## Deploy Button

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/prateek160298-glitch/invexaretail&branch=main)

---

## After Deployment

Once deployed, you'll get a backend URL like:
```
https://invexaretail-api-xxxx.onrender.com
```

### Test it immediately:

Visit this URL in your browser:
```
https://invexaretail-api-xxxx.onrender.com/health
```

You should see:
```json
{
  "ok": true,
  "service": "retail-inventory-api",
  "timestamp": "2026-09-09T..."
}
```

### Then test registration on your app:

1. Go to https://invexaretail.com
2. Click "Register here"
3. Try creating an account

If CORS error appears, the backend URL needs to be configured on the frontend.

---

## Manual Deployment Steps (If button doesn't work)

1. Go to https://render.com
2. Sign up with GitHub
3. Create New → Web Service
4. Select your GitHub repo
5. Set Root Directory: `api`
6. Build Command: `npm install && npm run build`
7. Start Command: `npm start`
8. Add Environment Variables (see BACKEND_DEPLOYMENT.md)
9. Click Deploy

---

**Status**: Backend is built and configured. Just needs to be deployed! ✨
