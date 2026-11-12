# Fleet Management System (FMS)

Fleet visibility, operations and intelligence: vehicles, GPS tracking (via Watch Tower), dispatch, fuel, maintenance, drivers and safety, logistics, costs, KPIs, and AI in later phases. It is multi-company from day one.

- **Plan & roadmap:** [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Deployment (Docker test / Kubernetes production):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Repository

```
apps/api          NestJS API (MODE=api | worker | ingest), Prisma schema & migrations
apps/web          React + Vite web console
apps/driver-app   Expo (React Native) driver app — not part of the pnpm workspace
packages/shared   Enums, permissions and zod schemas shared by API and web
deploy/docker     Dockerfiles, nginx config, docker-compose test stack
deploy/helm/fms   Helm chart for Kubernetes (external PostgreSQL)
```

## Quick start (Docker)

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up -d --build
```

Open http://localhost:8080 and sign in as `admin@fms.local` / `ChangeMe123!`. The API docs are at http://localhost:8080/api/docs.

## Local development

Requires Node 22, pnpm 10, PostgreSQL 16 and Redis 7.

```bash
pnpm install
```

```bash
psql -U postgres -c "CREATE ROLE fms_app LOGIN PASSWORD 'fms_app'" -c "CREATE DATABASE fms"
```

```bash
export DATABASE_URL=postgresql://fms_app:fms_app@localhost:5432/fms DATABASE_MIGRATION_URL=postgresql://postgres@localhost:5432/fms REDIS_URL=redis://localhost:6379 JWT_ACCESS_SECRET=dev-secret-change-me-0123456789
```

```bash
pnpm --filter @fms/shared build && cd apps/api && npx prisma migrate deploy && DATABASE_URL=$DATABASE_MIGRATION_URL pnpm prisma:seed
```

```bash
pnpm --filter @fms/api dev
```

```bash
pnpm --filter @fms/web dev
```

The web dev server runs on http://localhost:5173 and proxies `/api` to the API on port 3000. To run the GPS ingest or the job worker locally, start the API build with `MODE=ingest` or `MODE=worker`.

## Tests

```bash
pnpm test
```

```bash
pnpm --filter @fms/api test:e2e
```

The e2e suite needs the environment variables above, with migrations and the seed applied.
