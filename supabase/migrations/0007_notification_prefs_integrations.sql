-- =============================================================================
-- 0007 Notification preferences, daily digest, integration status
--   • Each employee chooses per category how EMAIL reaches them: IMMEDIATE, DIGEST or MUTED.
--     In-app notifications are always recorded (the notification center is the record).
--     SYSTEM emails (security, account) can never be muted.
--   • DIGEST items are collected and sent as one daily email by build_daily_digests().
--   • integration_status records real test results — nothing is shown as "connected" until tested.
-- =============================================================================

create or replace function notification_categories() returns text[] language sql immutable as $$
  select array['ATTENDANCE','TASKS','PROJECTS','CRM','MEETINGS','APPROVALS','LEAVE','PAYROLL',
               'PERFORMANCE','CHAT','ANNOUNCEMENTS','TRAINING','INTEGRATIONS','SYSTEM']
$$;

-- Which category an email template belongs to (template keys are "<area>.<event>").
create or replace function template_category(p_template text) returns text language sql immutable as $$
  select case split_part(p_template, '.', 1)
    when 'lead' then 'CRM' when 'task' then 'TASKS' when 'project' then 'PROJECTS'
    when 'payroll' then 'PAYROLL' when 'leave' then 'LEAVE' when 'approval' then 'APPROVALS'
    when 'meeting' then 'MEETINGS' when 'performance' then 'PERFORMANCE' when 'attendance' then 'ATTENDANCE'
    when 'announcement' then 'ANNOUNCEMENTS' when 'chat' then 'CHAT' when 'training' then 'TRAINING'
    when 'integration' then 'INTEGRATIONS'
    else 'SYSTEM' end
$$;

create table notification_preferences (
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  category text not null check (category = any (notification_categories())),
  channel text not null default 'EMAIL' check (channel in ('EMAIL')),
  mode text not null check (mode in ('IMMEDIATE','DIGEST','MUTED')),
  updated_at timestamptz not null default now(),
  primary key (employee_id, category, channel),
  check (category <> 'SYSTEM' or mode = 'IMMEDIATE')
);

-- Defaults when an employee hasn't chosen: chat goes to the digest, everything else immediately.
create or replace function default_email_mode(p_category text) returns text language sql immutable as $$
  select case when p_category = 'CHAT' then 'DIGEST' else 'IMMEDIATE' end
$$;

create or replace function email_mode(p_employee uuid, p_category text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_category = 'SYSTEM' then 'IMMEDIATE' else coalesce(
    (select mode from notification_preferences where employee_id = p_employee and category = p_category and channel = 'EMAIL'),
    default_email_mode(p_category)) end
$$;

create table notification_digest_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  category text not null,
  template text not null,
  payload jsonb not null default '{}',
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (employee_id, dedupe_key)
);
create index digest_pending_idx on notification_digest_items(employee_id) where sent_at is null;

-- enqueue_email now honours preferences. Emails without a recipient employee (e.g. the enquiry
-- acknowledgement to a lead, or ALERT_EMAIL) are always sent.
create or replace function enqueue_email(p_org uuid, p_to text, p_recipient uuid, p_template text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cat text := template_category(p_template); v_mode text := 'IMMEDIATE';
begin
  if p_to is null or length(trim(p_to)) < 3 then return; end if;
  if p_recipient is not null then v_mode := email_mode(p_recipient, v_cat); end if;
  if v_mode = 'DIGEST' then
    insert into notification_digest_items(org_id, employee_id, category, template, payload, dedupe_key)
    values (p_org, p_recipient, v_cat, p_template, coalesce(p_payload, '{}'), p_dedupe)
    on conflict (employee_id, dedupe_key) do nothing;
    return;
  end if;
  insert into email_outbox(org_id, to_email, recipient_employee_id, template, payload, dedupe_key, status, last_error)
  values (p_org, lower(trim(p_to)), p_recipient, p_template, coalesce(p_payload,'{}'), p_dedupe,
          case when v_mode = 'MUTED' then 'SKIPPED'::email_status else 'QUEUED'::email_status end,
          case when v_mode = 'MUTED' then 'muted by recipient preference' end)
  on conflict (org_id, dedupe_key) do nothing;
end $$;
revoke all on function enqueue_email(uuid,text,uuid,text,jsonb,text) from public, anon, authenticated;

-- One digest email per employee with pending items. Service role only (cron).
create or replace function build_daily_digests() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; v_day text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
begin
  for r in
    select i.employee_id, i.org_id, e.official_email, e.full_name,
           jsonb_agg(jsonb_build_object('category', i.category, 'template', i.template, 'payload', i.payload, 'at', i.created_at)
                     order by i.created_at) as items,
           array_agg(i.id) as ids
    from notification_digest_items i join employees e on e.id = i.employee_id
    where i.sent_at is null and e.status <> 'EXITED'
    group by i.employee_id, i.org_id, e.official_email, e.full_name
  loop
    insert into email_outbox(org_id, to_email, recipient_employee_id, template, payload, dedupe_key)
    values (r.org_id, lower(r.official_email), r.employee_id, 'digest.daily',
            jsonb_build_object('name', r.full_name, 'date', v_day, 'items', r.items),
            'digest:' || r.employee_id || ':' || v_day)
    on conflict (org_id, dedupe_key) do nothing;
    update notification_digest_items set sent_at = now() where id = any (r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function build_daily_digests() from public, anon, authenticated;
grant execute on function build_daily_digests() to service_role;

-- ---------------------------------------------------------------------------
-- Integration status (results of real tests and real deliveries)
-- ---------------------------------------------------------------------------
create table integration_status (
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  failure_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

create or replace function _integration_result(p_org uuid, p_key text, p_ok boolean, p_error text, p_is_test boolean)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into integration_status(org_id, key, last_test_at, last_test_ok, last_success_at, last_failure_at, last_error, failure_count)
  values (p_org, p_key, case when p_is_test then now() end, case when p_is_test then p_ok end,
          case when p_ok then now() end, case when not p_ok then now() end,
          case when not p_ok then left(p_error, 500) end, case when p_ok then 0 else 1 end)
  on conflict (org_id, key) do update set
    last_test_at   = case when p_is_test then now() else integration_status.last_test_at end,
    last_test_ok   = case when p_is_test then p_ok else integration_status.last_test_ok end,
    last_success_at= case when p_ok then now() else integration_status.last_success_at end,
    last_failure_at= case when not p_ok then now() else integration_status.last_failure_at end,
    last_error     = case when p_ok then integration_status.last_error else left(p_error, 500) end,
    failure_count  = case when p_ok then 0 else integration_status.failure_count + 1 end,
    updated_at = now();
$$;
revoke all on function _integration_result(uuid,text,boolean,text,boolean) from public, anon, authenticated;

-- Called by the Integrations panel after a live test (settings.manage only).
create or replace function record_integration_test(p_key text, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_perm('settings.manage') then raise exception 'settings.manage required' using errcode='42501'; end if;
  perform _integration_result(current_org_id(), p_key, p_ok, p_error, true);
  perform log_audit('integration.tested', 'integration', p_key, jsonb_build_object('ok', p_ok, 'error', left(p_error, 200)));
end $$;

-- Called by workers (service role) after real deliveries / cron runs.
create or replace function record_integration_event(p_org uuid, p_key text, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  select _integration_result(p_org, p_key, p_ok, p_error, false);
$$;
revoke all on function record_integration_event(uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function record_integration_event(uuid,text,boolean,text) to service_role;

-- Re-queue emails that FAILED (they were never delivered, so a retry can't double-send).
create or replace function retry_failed_emails() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not has_perm('settings.manage') then raise exception 'settings.manage required' using errcode='42501'; end if;
  update email_outbox set status = 'QUEUED', attempts = 0, next_attempt_at = now(), last_error = null
  where org_id = current_org_id() and status = 'FAILED';
  get diagnostics n = row_count;
  perform log_audit('integration.email_retry', 'email_outbox', null, jsonb_build_object('requeued', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table notification_preferences enable row level security;
alter table notification_digest_items enable row level security;
alter table integration_status enable row level security;

create policy np_read on notification_preferences for select to authenticated using (employee_id = current_employee_id());
create policy np_write on notification_preferences for all to authenticated
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id() and org_id = current_org_id());

create policy ndi_read on notification_digest_items for select to authenticated using (employee_id = current_employee_id());

create policy is_read on integration_status for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
