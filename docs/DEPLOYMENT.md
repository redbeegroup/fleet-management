# Deployment

| Environment | Runtime | Database |
|---|---|---|
| Local development | Node 22 + pnpm (or Compose) | local PostgreSQL / Compose |
| **Test** | **Docker Compose** (whole stack) | **PostgreSQL container in the Compose project** |
| Staging | Kubernetes (Helm, `values-staging.yaml`) | staging database on the PostgreSQL cluster |
| **Production** | **Kubernetes (Helm, `values-prod.yaml`)** | **pre-installed PostgreSQL cluster (external)** |

There is one API image (`fms/api`) for the `api`, `worker`, `ingest` and migration processes, and one web image (`fms/web`, nginx serving the SPA and proxying `/api`).

---

## 1. Test environment: Docker Compose

```bash
cp deploy/docker/.env.example deploy/docker/.env    # then edit passwords and secrets
```

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up -d --build
```

| Service | Purpose |
|---|---|
| `postgres` | `postgis/postgis:16-3.4`. The init script creates the non-superuser `fms_app` role and extensions |
| `redis` | queues, locks |
| `seaweedfs` | S3-compatible object storage for files |
| `mailpit` | catches outgoing email (UI on `127.0.0.1:8025`) |
| `migrate` | one-shot: `prisma migrate deploy` as the owner, then the demo seed if `SEED=true` |
| `api`, `worker`, `ingest` | the API image with `MODE=api / worker / ingest` |
| `web` | console on `http://localhost:${WEB_PORT}` (default 8080), API docs at `/api/docs` |

Default login (seed): `admin@fms.local` / `ChangeMe123!` (change via `SEED_ADMIN_*`).
With `TELEMATICS_PROVIDER=mock`, every vehicle that has a GPS device ID moves around Yangon, so the live map works without Watch Tower access.

Useful commands:

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env ps
```

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env logs -f api worker ingest
```

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env down -v
```

`down -v` deletes the test database volume.

**Behind a TLS-intercepting corporate proxy:** builds can receive the proxy CA as a BuildKit secret without baking it into images:

```bash
docker build --secret id=extra_ca,src=/path/to/corp-ca.crt -f deploy/docker/api.Dockerfile -t fms/api:local .
```

**Files** (documents, photos, receipts) go to the bundled **SeaweedFS** S3 service (`seaweedfs`, data in the `s3data` volume). Everything is set in `.env`: `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (and `S3_ENDPOINT` to use another S3 service instead). `STORAGE_DRIVER=local` stores files on the `files` volume as a fallback. The bucket is created automatically on first upload.

**Run a background job on demand** (`compliance-alerts`, `maintenance-due`, `safety-alerts`, `incentives-monthly`, `gps-offline`, `position-partitions`, `daily-stats` — the latter accepts `JOB_FROM`/`JOB_TO` days for a backfill):

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env run --rm -e MODE=job -e JOB=compliance-alerts api
```

Alert emails appear in Mailpit at http://127.0.0.1:8025.

---

## 2. Production: Kubernetes + external PostgreSQL cluster

### 2.1 DBA prerequisites (once per environment)

Run on the PostgreSQL cluster as a DBA. Adjust names, passwords and the network rules in `pg_hba.conf`.

```sql
-- Owner / migrator: owns the schema, runs DDL (used only by the migration Job)
CREATE ROLE fms_migrator LOGIN PASSWORD '***';
-- Application: DML only, NOT superuser, NO BYPASSRLS (RLS must apply)
CREATE ROLE fms_app LOGIN PASSWORD '***' CONNECTION LIMIT 200;

CREATE DATABASE fms OWNER fms_migrator;
\c fms
GRANT CONNECT ON DATABASE fms TO fms_app;
-- Extensions need superuser on most installations:
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;   -- optional; geofencing falls back without it
```

The first migration grants `fms_app` DML rights on all tables and sets default privileges, provided the role exists when migrations run.

Checklist:

- [ ] `fms_app` is **not** a superuser and does **not** have `BYPASSRLS`. Otherwise tenant isolation at the database level is off.
- [ ] TLS enabled (`sslmode=require` in the URLs).
- [ ] Connection budget: pods × `connection_limit` (set in `DATABASE_URL`; Prisma's default is CPU count × 2 + 1). With **pgbouncer in transaction mode**, add `?pgbouncer=true` to `DATABASE_URL`, and point `DATABASE_MIGRATION_URL` **directly** at the primary (migrations need session features).
- [ ] Backups and PITR are owned by the DBA team. Telemetry partitions (`vehicle_positions_YYYYMM`) can follow a shorter retention.
- [ ] Monitoring: replication lag, connections, bloat on `vehicle_positions*`.

### 2.2 Secrets

Create the Secret with your secret tooling (External Secrets, Vault, sealed-secrets). Keys:

| Key | Example |
|---|---|
| `DATABASE_URL` | `postgresql://fms_app:***@fms-fms-db:5432/fms?sslmode=require&connection_limit=10` |
| `DATABASE_MIGRATION_URL` | `postgresql://fms_migrator:***@pg-primary.db.internal:5432/fms?sslmode=require` |
| `REDIS_URL` | `rediss://:***@redis.internal:6380/0` |
| `JWT_ACCESS_SECRET` | 64+ random characters |
| `WATCHTOWER_API_KEY` | issued by Watch Tower |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | object storage credentials (bucket from `config.S3_BUCKET`) |
| `SMTP_URL` | `smtps://user:***@smtp.example.com:465` (optional; email alerts) |

Manual example (for a first test only):

```bash
kubectl -n fms create secret generic fms-prod-secrets --from-literal=DATABASE_URL='...' --from-literal=DATABASE_MIGRATION_URL='...' --from-literal=REDIS_URL='...' --from-literal=JWT_ACCESS_SECRET='...' --from-literal=WATCHTOWER_API_KEY='...'
```

### 2.3 Install / upgrade

```bash
helm upgrade --install fms deploy/helm/fms -n fms --create-namespace -f deploy/helm/fms/values-prod.yaml --set image.api.tag=$GIT_SHA --set image.web.tag=$GIT_SHA --wait --timeout 10m
```

What happens:

1. A **pre-install / pre-upgrade hook Job** runs `scripts/migrate.js` (`prisma migrate deploy`) with `DATABASE_MIGRATION_URL`. If it fails, the release stops and the running version stays untouched.
2. The `api` (HPA 3–10), `worker`, `ingest` (2 replicas, one active via a Redis lock) and `web` Deployments roll out with `maxUnavailable: 0`.
3. Ingress routes `/api` (including the `/api/socket.io` WebSocket) to the api and `/` to the web. The chart sets 1-hour proxy timeouts for WebSockets. Clients use the WebSocket transport only, so no sticky sessions are needed with several API replicas.

`values-prod.yaml` also configures:

- `database.externalService`: an in-cluster name (`<release>-fms-db`) for the external cluster, either as an `ExternalName` or as a selector-less Service with an EndpointSlice when only IPs are available.
- `networkPolicy`: default deny, then egress allowed to DNS, the DB CIDRs, intra-release traffic and HTTPS.
- Pod security: non-root, read-only root filesystem, all capabilities dropped, `RuntimeDefault` seccomp. The API image is distroless.
- Files: `STORAGE_DRIVER=s3` (default in the chart). The API needs egress to the S3 endpoint (add its CIDR to `networkPolicy.extraEgressCidrs` if you restrict egress).

### 2.4 Rollback

```bash
helm rollback fms <REVISION> -n fms
```

Migrations are forward-only. Ship schema changes as expand → migrate → contract across releases so the previous image still works with the newer schema.

### 2.5 Observability

- Probes: `/api/health/live` (liveness/startup) and `/api/health/ready` (checks DB and Redis).
- Logs: `LOG_FORMAT=json` (chart default) writes one JSON object per line (`time`, `level`, `context`, `msg`) for Loki/ELK; `LOG_LEVEL` controls verbosity.
- Metrics: Prometheus format at `/metrics` — the API on its HTTP port (outside `/api`, so not exposed by the ingress), worker and ingest on `METRICS_PORT` (9100). Pods carry `prometheus.io/*` annotations; the NetworkPolicy admits pods labelled `app.kubernetes.io/name: prometheus`. Key series: `fms_http_request_duration_seconds`, `fms_positions_ingested_total`, `fms_telemetry_events_total{type}`, `fms_notifications_total{channel,result}`, `fms_job_runs_total{job,result}`.
- Suggested alerts: ingest stalled (`rate(fms_positions_ingested_total[15m]) == 0` during working hours), job failures, API p95 latency, readiness failures.

### 2.6 Mobile push

Set `PUSH_ENABLED=true` (chart default) and, if your Expo project requires it, the `EXPO_ACCESS_TOKEN` secret key. The API needs egress to `exp.host:443`. The driver app registers its token after sign-in (`apps/driver-app/README.md`).

---

## 3. CI/CD

`.github/workflows/ci.yml`:

1. **test**: install, build, lint, typecheck, unit tests, then migrations, seed and e2e tests against PostgreSQL and Redis service containers (the app connects as `fms_app`, so RLS is exercised).
2. **helm**: `helm lint` for the staging and prod values, plus `helm template` and `kubeconform`.
3. **images**: builds both images. To publish, add a registry login and set `push: true` on `main`.

Suggested CD: tag images with the git SHA, then `helm upgrade` to staging automatically and to production with a manual approval (GitHub Environments or Argo CD).

---

## 4. CorexLab test cluster (Talos via Portainer)

Deployed to Portainer environment `talos-corexlab-portainer` (id 17), namespace `fms`:

| Release | Chart | Notes |
|---|---|---|
| `fms-db` | `deploy/helm/fms-test-postgres` + `values-corexlab.yaml` | PostGIS 16 on `synology-iscsi`, pinned to nodes with the Talos `iscsi-tools` extension |
| `fms` | `deploy/helm/fms` + `values-corexlab.yaml` | Public GHCR images (pinned commit tag), SeaweedFS `https://s3.corexlab.net` bucket `cannopy-fms`, mock telematics, internal Redis |

Secrets live in the `fms-secrets` Secret (created out of band; keys: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `JWT_ACCESS_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SEED_ADMIN_PASSWORD`).

**Ingress** is managed manually (Traefik): route `fms.corexlab.net` to service **`fms-web`** port **80** in namespace `fms` (it serves the SPA, `/api` and the `/api/socket.io` WebSocket). The NetworkPolicy admits the `traefik` namespace.

**Upgrade** to a newer build (images are published by `.github/workflows/images.yml` on every push):

```bash
helm upgrade fms deploy/helm/fms -n fms -f deploy/helm/fms/values-corexlab.yaml --set image.api.tag=<git-sha> --set image.web.tag=<git-sha> --timeout 32m
```

**Known cluster issues** (at deployment time): `wo4` — flannel `cni0` has a wrong address (no pod can start) and lacks `iscsi-tools`; `wo1` — image pulls from ghcr.io hang; `synology-nfs` — the NAS rejects NFS 4.1; outbound pulls from Docker Hub/GHCR are slow and reset intermittently (Redis comes from `mirror.gcr.io`). FMS pods avoid `wo1` and `wo4` via affinity in `values-corexlab.yaml`; remove those exclusions once the nodes are fixed.
