# Bioregional Deploy Runbook

Use this repo to deploy a sovereign bioregional instance.

Required:

- PM Core / Docker Lab host foundation
- PostgreSQL with `postgis`, `vector`, and `pg_trgm`
- real `DATABASE_URL`
- real `AUTH_SECRET`

Core env:

- `INSTANCE_TYPE=region`
- `INSTANCE_ID=<uuid>`
- `INSTANCE_SLUG=<slug>`
- `INSTANCE_NAME=Rivr Bioregional`
- `REGISTRY_URL=<global registry url>`
- `NEXTAUTH_URL=<public url>`
- `NEXT_PUBLIC_BASE_URL=<public url>`

Spatial notes:

- hydrological layers
- terrestrial layers
- cultural layers

Verification:

- `/api/health`
- `/api/federation/status`
- `/api/app-release`
- map and basin/locale routes load
