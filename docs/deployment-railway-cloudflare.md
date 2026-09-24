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

## Fallback: deploy without Workers Builds

Use this when Workers Builds is stuck. The failure seen on 2026-09-25: after
the build for PR #29, no build on either Git-connected worker
(`invexaretail-web` and `invexaretail`) succeeded. On `invexaretail-web`
every build sat at "Initializing build environment..." and never reached
Cloning, while Cloudflare Status showed Workers Builds as operational. Nothing
in the repo was at fault (`web/` was unchanged between the last good build and
the first stuck one) and a direct `wrangler deploy` from a workstation worked.

While builds are stuck, cancel them instead of pressing Retry: every retry adds
another build to the queue. Rows marked "Skipped" in the build history were not
run; they are not failures.

### Web app (`invexaretail-web`)

Deploy from a dedicated clean clone of `main`, never from a working tree with
local changes or another branch checked out: the deploy ships whatever is in the
folder. Clone once:

```bash
git clone https://github.com/iamprateeknk-pixel/invexaretail.git invexa-deploy
```

Then, for every deploy:

```bash
cd invexa-deploy && git pull && cd web
```

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run deploy
```

- `npm run deploy` runs `npx wrangler@4.137.0 deploy`, which needs a wrangler
  login for the Cloudflare account that owns the worker. Check with
  `npx wrangler@4.137.0 whoami`.
- `VITE_API_BASE` does not need to be set: the fallback in
  `web/src/lib/api-client.js` is the Railway production API. Set it only to
  point the build at a different API (bash: `VITE_API_BASE=https://... npm run
  build`; PowerShell: `$env:VITE_API_BASE="https://..."` before the build).
- Vite 8 needs Node 20.19+ or 22.12+.

### Control Plane (`invexaretail`)

Same approach from `admin-panel/`, which has no `deploy` script:

```bash
cd admin-panel && npm install && npm run build && npx wrangler@4.137.0 deploy
```

### Verify and roll back

```bash
npx wrangler@4.137.0 deployments list --name invexaretail-web
```

Open the worker URL and confirm the `/assets/index-*.js` hash in the page
source changed. To go back to an earlier version, pass a version id from the
list above:

```bash
npx wrangler@4.137.0 rollback <version-id> --name invexaretail-web
```

When Workers Builds works again, nothing needs undoing: the next push to
`main` builds and deploys as before, and the newest deployment wins.
