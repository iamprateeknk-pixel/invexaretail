# Production runbook — Hostinger shared hosting

This API runs on Hostinger shared Node hosting with MySQL. The application applies only additive compatibility schema changes at startup; it does not delete business data.

## Hostinger Node.js application settings

`Cannot GET /` with a `traceId` is Hostinger's wrapper, not this API. Our process answers `GET /` and `GET /health` with `{ "ok": true, "service": "retail-inventory-api" }`. A Hostinger HTML **503 Service Unavailable** means the Node process is down or the panel is starting the wrong file.

In hPanel → **Websites → api.invexaretail.com → Node.js**:

- **Node.js version:** 22.x
- **Application root:** `api` (the folder that contains the API `package.json`)
- **Application startup / entry file:** `app.js`. If the panel ignores Application root, use `api/app.js`. Never use `dist/index.js` (that file is built on the server and is not in Git).
- **Start command:** `npm start` (runs `node app.js`)
- After changing these, click **Install** / **Rebuild**, then **Restart**

## Required Hostinger environment variables

Set these in the API application's environment panel (never commit values):

- `NODE_ENV=production`
- `DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE` (percent-encode reserved characters in the password, e.g. `@` as `%40`). phpMyAdmin shows `127.0.0.1`; that host only works on Hostinger. On Render use `82.25.121.149` (or `srv834.hstgr.io` / `MYSQL_PUBLIC_HOST`). The API rewrites loopback automatically when `RENDER=true`. Persistence is database when `DATABASE_URL` is set; leave it unset for in-memory seed data.
- `JWT_SECRET` — a unique random value of at least 32 characters
- `ALLOWED_ORIGINS=https://invexaretail.com,https://www.invexaretail.com`
- `APP_VERSION` — optionally set this to the deployed Git commit

After every deployment, verify:

```text
GET https://api.invexaretail.com/health
GET https://api.invexaretail.com/ready
```

Both must return HTTP 200 JSON from this API (`service: "retail-inventory-api"`). The readiness response must show `persistence: "database"` and `repository.ready: true`. A JSON 503 from `/ready` means inventory hydration failed; a Hostinger HTML 503 means the Node process is not running — open the Node.js error log in hPanel.

## Backup and recovery

1. In Hostinger hPanel, enable a daily MySQL backup/retention policy for the production database.
2. Before an import, schema change, or manual SQL update, create an on-demand database backup in hPanel.
3. Download and keep a dated SQL export outside the web root. Never store database dumps in this Git repository or the public `public_html` directory.
4. Test restore into a separate temporary database first. Point a temporary API environment at that database and verify `/ready`; only then restore production if necessary.

## Deployment safety

GitHub Actions validates the API build/tests, web build, and mobile analysis before merge. Hostinger deployment must run the normal install/build command and restart the Node application. Do not use `prisma db push --accept-data-loss` against production; the runtime schema layer is deliberately additive for shared hosting compatibility.
