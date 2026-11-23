-- Block 13: durable per-organisation integration diagnostics history.
create table integration_check_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  integration_key text not null check (integration_key ~ '^[a-z_]{2,40}$'),
  status text not null check (status in ('HEALTHY','FAILED','PARTIAL')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  message text not null check (length(message) between 1 and 500),
  details jsonb not null default '{}'::jsonb,
  checked_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index integration_check_runs_org_time_idx on integration_check_runs(org_id, created_at desc);
create index integration_check_runs_key_time_idx on integration_check_runs(org_id, integration_key, created_at desc);
alter table integration_check_runs enable row level security;
create policy integration_check_runs_read on integration_check_runs for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
create policy integration_check_runs_insert on integration_check_runs for insert to authenticated
  with check (org_id = current_org_id() and checked_by = current_employee_id() and has_perm('settings.manage'));
