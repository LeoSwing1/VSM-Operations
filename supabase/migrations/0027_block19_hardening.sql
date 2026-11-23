-- =============================================================================
-- 0027 · Block 19 — hardening: app error log, auth rate-limit helper, housekeeping.
-- =============================================================================
create table if not exists app_errors (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kind text not null default 'SERVER' check (kind in ('SERVER','CLIENT','ACTION','CRON')),
  path text check (length(path) <= 300),
  method text check (length(method) <= 10),
  message text not null check (length(message) <= 1000),
  digest text check (length(digest) <= 100),
  stack text check (length(stack) <= 4000)
);
create index if not exists app_errors_time_idx on app_errors(occurred_at desc);
alter table app_errors enable row level security;
drop policy if exists app_errors_read on app_errors;
create policy app_errors_read on app_errors for select to authenticated using (has_perm('settings.manage'));
revoke insert, update, delete on app_errors from authenticated;

-- One call for route handlers: returns true when the caller is still within the limit.
create or replace function auth_rate_ok(p_kind text, p_key text, p_limit int, p_window_seconds int)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select hit_rate_limit(left(p_kind || ':' || coalesce(p_key, '?'), 200), p_limit, p_window_seconds)
$$;
revoke all on function auth_rate_ok(text, text, int, int) from public, anon, authenticated;

-- Daily housekeeping, called by the cron route (service role).
create or replace function ops_housekeeping() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a int; b int;
begin
  delete from app_errors where occurred_at < now() - interval '30 days'; get diagnostics a = row_count;
  delete from rate_limits where window_start < now() - interval '1 day'; get diagnostics b = row_count;
  return jsonb_build_object('errors_pruned', a, 'rate_limits_pruned', b);
end $$;
revoke all on function ops_housekeeping() from public, anon, authenticated;
