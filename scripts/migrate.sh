#!/usr/bin/env bash
# Applies every migration in order, each in its own transaction, stopping at the first error.
# Usage:  DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' ./scripts/migrate.sh
# Use the SESSION pooler (port 5432) or the direct connection for migrations — not the transaction pooler (6543).
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL (see usage at the top of this file)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v psql >/dev/null || { echo "psql not found. Install PostgreSQL client tools (macOS: brew install libpq && brew link --force libpq)"; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists public._vsm_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public._vsm_migrations enable row level security;   -- not exposed to the API
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  name=$(basename "$f")
  done=$(psql "$DATABASE_URL" -Atq -c "select 1 from public._vsm_migrations where name = '$name'")
  if [ "$done" = "1" ]; then echo "  skip   $name (already applied)"; continue; fi
  echo "  apply  $name"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -c "set statement_timeout = 0" -f "$f" -c "insert into public._vsm_migrations(name) values ('$name')"
done

echo; echo "Verification:"
psql "$DATABASE_URL" -Atq <<'SQL'
select '  tables with RLS on: ' || count(*) filter (where c.relrowsecurity) || ' / ' || count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
select '  migrations applied: ' || string_agg(name, ', ' order by name) from public._vsm_migrations;
select '  organizations: ' || count(*) || case when count(*) = 0 then '  → next: run bootstrap_organization (RUNBOOK step 2.4)' else '' end from public.organizations;
SQL
