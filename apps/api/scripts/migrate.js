#!/usr/bin/env node
/**
 * Container entrypoint for database migrations (Docker `migrate` service and the
 * Kubernetes pre-install/pre-upgrade Job). Works without a shell (distroless).
 *   1. prisma migrate deploy        (uses DATABASE_MIGRATION_URL via directUrl)
 *   2. optional demo seed           (only when SEED=true; refuses in production)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(args) {
  const res = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const prismaCli = require.resolve('prisma/build/index.js');
run([prismaCli, 'migrate', 'deploy', '--schema', path.join(__dirname, '..', 'prisma', 'schema.prisma')]);

if (process.env.SEED === 'true') {
  run([path.join(__dirname, '..', 'dist-seed', 'seed.js')]);
}
