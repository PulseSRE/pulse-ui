-- 0001_init.up.sql — baseline schema revision (node-pg-migrate /
-- prisma migrate / knex). Real DDL required (clear-evidence
-- refuses SELECT 1 / empty stubs).
CREATE TABLE IF NOT EXISTS schema_migrations_baseline (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
