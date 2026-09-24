# Railway worker and Cloudflare web deployment

## Railway worker

Use a separate Railway service for the background worker, connected to the
same repository and environment as the API and Postgres services.

- Root directory: `/api`
- Config file path: `/api/railway.worker.json`
- `DATABASE_URL`: reference the Postgres service's `DATABASE_URL`; do not copy
  the credential into the repository.
- `NODE_ENV`: `production`
- `REQUIRE_DATABASE`: `true`
- Healthcheck path: empty (the worker does not expose HTTP)

The config runs `npm run db:migrate` before deployment and starts the compiled
worker with `node dist/worker.js`. Railway service references use this form:

```text
${{Postgres.DATABASE_URL}}
```

If the database service has a different name, select it from Railway's
reference-variable autocomplete instead of typing the name manually.

## Cloudflare main web app

Create a separate Workers Builds project for the customer-facing web app. Do
not reuse the `invexaretail` Control Plane worker from `admin-panel/`.

- Worker name: `invexaretail-web`
- Production branch: `main`
- Root directory: `/web`
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Build variable: `VITE_API_BASE=https://<public-api-domain>`

The repository's `web/wrangler.toml` deploys `web/dist` as static assets and
uses SPA fallback routing, so routes opened directly in the browser resolve to
`index.html`.

`VITE_API_BASE` is public build-time configuration, not a secret. It must use
the API service's public HTTPS domain, never the private
`*.railway.internal` hostname. After changing it, redeploy the frontend so
Vite bakes the new value into the bundle.
