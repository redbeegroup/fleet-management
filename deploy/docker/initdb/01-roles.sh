#!/bin/bash
# Runs once on first start of the test database container.
# Mirrors production: migrations run as the owner, the application connects as
# a non-superuser role so PostgreSQL Row-Level Security is enforced.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE fms_app LOGIN PASSWORD '${FMS_APP_PASSWORD}';
  GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO fms_app;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS postgis;
SQL
