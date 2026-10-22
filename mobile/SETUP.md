# Mobile setup

Point the app at an API with:

```bash
flutter run --dart-define=INVEXA_API_BASE=http://127.0.0.1:4000
```

Empty `INVEXA_API_BASE` uses `https://invexaretail-api-production.up.railway.app`.

Seed/demo logins are created by the API seed (`api/prisma/seed.ts`, or the
API's in-memory seed mode when `DATABASE_URL` is unset). Their password is
whatever you set in the `SEED_PASSWORD` environment variable — see
`api/.env.example` and `DEVELOPMENT_SETUP.md`. The password is deliberately
not printed in this document.
