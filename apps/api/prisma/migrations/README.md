# Migrations

Generated with `prisma migrate diff`, then reviewed by hand. Rules:

1. **`vehicle_positions` is not a Prisma model** (it is a natively partitioned table created in
   `20261112000100_rls_and_telemetry`). Prisma diffs will propose `DROP TABLE "vehicle_positions"` —
   always delete that statement.
2. Every new tenant table (with `company_id`) must get the `tenant_isolation` RLS policy
   (`ENABLE` + `FORCE ROW LEVEL SECURITY`), as in the existing migrations.
3. Migrations are forward-only. Use expand → migrate → contract for destructive changes.

Generate a new migration (needs an empty scratch database for the shadow):

    npx prisma migrate diff --from-migrations prisma/migrations \
      --to-schema-datamodel prisma/schema.prisma \
      --shadow-database-url postgresql://postgres@localhost:5432/fms_shadow --script
