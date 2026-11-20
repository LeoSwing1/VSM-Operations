#!/usr/bin/env bash
# Applies all migrations to a throwaway database and runs the RLS/security suite.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run test:db
set -euo pipefail
DB=vsm_ops_test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for r in anon authenticated service_role; do psql -q -d postgres -c "do \$\$begin create role $r nologin; exception when duplicate_object then null; end\$\$" ; done
psql -q -d postgres -c "alter role service_role bypassrls"
PSQL="psql -q -v ON_ERROR_STOP=1 -d $DB"
$PSQL -f <(grep -v '^create role' "$ROOT/tests/db/00_supabase_shim.sql")
for f in "$ROOT"/supabase/migrations/*.sql; do echo "▸ migrate $(basename "$f")"; $PSQL -f "$f"; done
echo "▸ security suite"
$PSQL -f "$ROOT/tests/db/security.sql"
