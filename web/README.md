# Invexa Retail — web workspace

The operator web app for Invexa Retail: inventory, transfers, stock counts,
procurement, orders, intelligence and the SaaS control plane. It talks to
the API in `api/` (Node.js/Express) and is the primary desktop workspace;
the Flutter app in `mobile/` covers floor workflows.

## Stack

- **Vite 8 + React 19** (JavaScript/JSX; `src/offlineStore.ts` is the one
  TypeScript module)
- **Tailwind CSS 4** with an OKLCH design-token system and dark mode
- **shadcn/ui-style components** built on Radix primitives, `lucide-react`
  icons, `react-hook-form` for forms, `sonner` for toasts
- Realtime updates over authenticated SSE with topic-based invalidation,
  plus Playwright end-to-end tests with axe-core accessibility checks

## Layout

```
src/
  App.jsx          workspace shell and section routing
  main.jsx         entry point (registers the PWA service worker in production)
  components/      shared UI (shadcn primitives, feedback states, table views)
  control-plane/   SaaS control plane (ControlPlaneApp and its sections)
  hooks/           workspace data/realtime hooks
  lib/             API client, table state, pagination, utilities
  offlineStore.ts  offline snapshot store
```

## Commands

```bash
npm ci
npm run dev            # Vite dev server
npm run build          # production build
npm run preview        # preview the production build
npm run lint           # oxlint
npm test               # unit tests (hooks, lib, control-plane)
npm run test:components
npm run test:all
npm run test:e2e       # Playwright (incl. accessibility gate)
npm run budget         # bundle-size budget check
```

## Configuration

The app is configured at build time with Vite environment variables; the
API base is `VITE_API_BASE` (the mobile app's default API base matches it).
Do not commit real secrets — see the repo's deployment docs.

## Deployment

Production web is served from Cloudflare; `npm run deploy` deploys with
Wrangler (`wrangler.toml`). The canonical production topology (Cloudflare
web + Railway API/worker + managed PostgreSQL) is documented in
`docs/PRODUCTION_RUNBOOK.md` and `docs/deployment-railway-cloudflare.md`.
