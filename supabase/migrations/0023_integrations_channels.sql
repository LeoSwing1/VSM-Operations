-- =============================================================================
-- 0023 Integrations & delivery channels (Block 17)
--
-- One durable queue (delivery_outbox) for every outbound channel except email:
--   WHATSAPP · PUSH (web push) · SLACK · TEAMS · WEBHOOK
-- Rules that hold for every channel:
--   • The business record is saved first; a delivery is a separate queued row (event-first).
--   • Personal channels (WhatsApp, Push) respect each employee's per-category preference and opt-in.
--   • Organisation channels (Slack, Teams, Webhooks) receive ONLY allow-listed events, never salaries.
--   • Workers run with the service role; employees can't read or write any delivery row.
--   • Inbound webhooks (Meta Lead Ads, Razorpay, WhatsApp status) are idempotent by external id.
--   • Nothing marks a salary or invoice PAID automatically — verified events are shown for a
--     human to confirm (existing payroll/finance rules stay in force).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preferences gain WhatsApp and Push channels
-- ---------------------------------------------------------------------------
alter table notification_preferences drop constraint if exists notification_preferences_channel_check;
alter table notification_preferences add constraint notification_preferences_channel_check
  check (channel in ('EMAIL','WHATSAPP','PUSH'));
-- DIGEST only makes sense for email
alter table notification_preferences drop constraint if exists notification_preferences_digest_email_only;
alter table notification_preferences add constraint notification_preferences_digest_email_only
  check (channel = 'EMAIL' or mode in ('IMMEDIATE','MUTED'));

-- Defaults when an employee hasn't chosen.
--   WhatsApp: on only for time-sensitive categories (and only after opt-in).
--   Push: on for everything (and only after the browser subscribed).
create or replace function default_channel_mode(p_channel text, p_category text) returns text language sql immutable as $$
  select case
    when p_channel = 'EMAIL' then default_email_mode(p_category)
    when p_channel = 'WHATSAPP' then case when p_category in ('APPROVALS','LEAVE','PAYROLL','ATTENDANCE','MEETINGS','SYSTEM') then 'IMMEDIATE' else 'MUTED' end
    when p_channel = 'PUSH' then 'IMMEDIATE'
    else 'MUTED' end
$$;

create or replace function channel_mode(p_employee uuid, p_channel text, p_category text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select mode from notification_preferences where employee_id = p_employee and category = p_category and channel = p_channel),
    default_channel_mode(p_channel, p_category))
$$;

-- Map free-form notification categories onto preference categories.
create or replace function preference_category(p_category text) returns text language sql immutable as $$
  select case
    when upper(p_category) = any (notification_categories()) then upper(p_category)
    when upper(p_category) in ('WORKFLOW','SLA') then 'APPROVALS'
    when upper(p_category) in ('COMMUNICATION','MESSAGES') then 'CHAT'
    when upper(p_category) in ('FINANCE','EXPENSES') then 'APPROVALS'
    when upper(p_category) in ('CALENDAR') then 'MEETINGS'
    else 'SYSTEM' end
$$;

-- ---------------------------------------------------------------------------
-- 2. Opt-ins and subscriptions (employee-owned)
-- ---------------------------------------------------------------------------
create table whatsapp_optins (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  opted_in boolean not null default true,
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  revoked_at timestamptz
);
create index push_subscriptions_employee_idx on push_subscriptions(employee_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 3. Organisation channel settings + outbound webhook endpoints
-- ---------------------------------------------------------------------------
create or replace function org_event_keys() returns text[] language sql immutable as $$
  select array['lead.created','lead.won','employee.joined','leave.approved','payroll.approved',
               'announcement.published','task.completed','integration.failing']
$$;

create table integration_settings (
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null check (key in ('slack','teams')),
  enabled boolean not null default false,
  events text[] not null default array['lead.created','lead.won','employee.joined','announcement.published','integration.failing'],
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, key),
  check (events <@ org_event_keys())
);

create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  url text not null check (url ~ '^https://[^/@\s]+(/[^\s]*)?$' and length(url) <= 500),
  secret text not null check (length(secret) >= 32),
  events text[] not null check (array_length(events, 1) >= 1 and events <@ org_event_keys()),
  enabled boolean not null default true,
  consecutive_failures int not null default 0,
  disabled_reason text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index webhook_endpoints_org_idx on webhook_endpoints(org_id) where enabled;

-- ---------------------------------------------------------------------------
-- 4. Delivery queue (all non-email channels)
-- ---------------------------------------------------------------------------
create type delivery_channel as enum ('WHATSAPP','PUSH','SLACK','TEAMS','WEBHOOK');

create table delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel delivery_channel not null,
  recipient_employee_id uuid references employees(id) on delete set null,
  target_ref uuid,                           -- push_subscriptions.id / webhook_endpoints.id
  event_key text not null,
  payload jsonb not null default '{}',
  status email_status not null default 'QUEUED',
  attempts int not null default 0,
  max_attempts int not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, dedupe_key)
);
create index delivery_outbox_due_idx on delivery_outbox(next_attempt_at) where status in ('QUEUED','FAILED');
create index delivery_outbox_provider_idx on delivery_outbox(provider_message_id) where provider_message_id is not null;
create index delivery_outbox_org_channel_idx on delivery_outbox(org_id, channel, created_at desc);

create or replace function enqueue_delivery(p_org uuid, p_channel delivery_channel, p_recipient uuid, p_target uuid,
                                            p_event text, p_payload jsonb, p_dedupe text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into delivery_outbox(org_id, channel, recipient_employee_id, target_ref, event_key, payload, dedupe_key)
  values (p_org, p_channel, p_recipient, p_target, p_event, coalesce(p_payload, '{}'), p_dedupe)
  on conflict (org_id, dedupe_key) do nothing;
$$;
revoke all on function enqueue_delivery(uuid,delivery_channel,uuid,uuid,text,jsonb,text) from public, anon, authenticated;

create or replace function claim_delivery_batch(p_limit int default 50)
returns setof delivery_outbox language sql security definer set search_path = public, pg_temp as $$
  update delivery_outbox set status = 'SENDING', attempts = attempts + 1
  where id in (
    select id from delivery_outbox
    where status in ('QUEUED','FAILED') and next_attempt_at <= now() and attempts < max_attempts
    order by next_attempt_at limit greatest(1, least(p_limit, 200)) for update skip locked)
  returning *;
$$;
revoke all on function claim_delivery_batch(int) from public, anon, authenticated;
grant execute on function claim_delivery_batch(int) to service_role;

create or replace function retry_failed_deliveries(p_channel delivery_channel default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not has_perm('settings.manage') then raise exception 'settings.manage required' using errcode='42501'; end if;
  update delivery_outbox set status = 'QUEUED', attempts = 0, next_attempt_at = now(), last_error = null
  where org_id = current_org_id() and status = 'FAILED' and (p_channel is null or channel = p_channel);
  get diagnostics n = row_count;
  perform log_audit('integration.delivery_retry', 'delivery_outbox', coalesce(p_channel::text, 'ALL'), jsonb_build_object('requeued', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Personal fan-out: every notification → WhatsApp / Push per preference
-- ---------------------------------------------------------------------------
create or replace function notifications_fanout() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cat text := preference_category(new.category); s record; v_optin whatsapp_optins;
  v_payload jsonb := jsonb_build_object('title', left(new.title, 120), 'body', left(coalesce(new.body, ''), 300),
                                        'link', coalesce(new.link, '/notifications'), 'notification_id', new.id, 'category', v_cat);
begin
  -- Payroll never carries amounts outside the app: drop the body for payroll notifications.
  if v_cat = 'PAYROLL' then v_payload := v_payload || jsonb_build_object('body', 'Open VSM Ops to view it securely.'); end if;

  if channel_mode(new.recipient_id, 'PUSH', v_cat) = 'IMMEDIATE' then
    for s in select id from push_subscriptions where employee_id = new.recipient_id and revoked_at is null loop
      perform enqueue_delivery(new.org_id, 'PUSH', new.recipient_id, s.id, 'notification.' || lower(v_cat), v_payload,
                               'push:' || new.id || ':' || s.id);
    end loop;
  end if;

  select * into v_optin from whatsapp_optins where employee_id = new.recipient_id and opted_in;
  if v_optin.employee_id is not null and channel_mode(new.recipient_id, 'WHATSAPP', v_cat) = 'IMMEDIATE' then
    perform enqueue_delivery(new.org_id, 'WHATSAPP', new.recipient_id, null, 'notification.' || lower(v_cat),
                             v_payload || jsonb_build_object('to', v_optin.phone_e164), 'wa:' || new.id);
  end if;
  return new;
end $$;
create trigger notifications_fanout_trg after insert on notifications for each row execute function notifications_fanout();

-- ---------------------------------------------------------------------------
-- 6. Organisation fan-out: allow-listed events → Slack / Teams / Webhooks
-- ---------------------------------------------------------------------------
create or replace function emit_org_event(p_org uuid, p_event text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare st integration_settings; ep record;
  v_payload jsonb := coalesce(p_payload, '{}') || jsonb_build_object('event', p_event, 'occurred_at', now());
begin
  if not (p_event = any (org_event_keys())) then raise exception 'event % is not allow-listed', p_event; end if;
  -- Defence in depth: organisation channels must never carry money amounts.
  v_payload := v_payload - 'amount' - 'net_amount' - 'gross_amount' - 'salary' - 'base_monthly';
  for st in select * from integration_settings where org_id = p_org and enabled and p_event = any (events) loop
    perform enqueue_delivery(p_org, upper(st.key)::delivery_channel, null, null, p_event, v_payload, st.key || ':' || p_dedupe);
  end loop;
  for ep in select id from webhook_endpoints where org_id = p_org and enabled and p_event = any (events) loop
    perform enqueue_delivery(p_org, 'WEBHOOK', null, ep.id, p_event, v_payload, 'wh:' || ep.id || ':' || p_dedupe);
  end loop;
end $$;
revoke all on function emit_org_event(uuid,text,jsonb,text) from public, anon, authenticated;

create or replace function org_events_from_leads() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.duplicate_of is null then
    perform emit_org_event(new.org_id, 'lead.created', jsonb_build_object('lead_id', new.id, 'name', new.name,
      'company', new.company, 'service', new.service_interest, 'source', new.source, 'link', '/leads/' || new.id), 'lead.created:' || new.id);
  elsif tg_op = 'UPDATE' and new.status = 'WON' and old.status <> 'WON' then
    perform emit_org_event(new.org_id, 'lead.won', jsonb_build_object('lead_id', new.id, 'name', new.name, 'company', new.company,
      'link', '/leads/' || new.id), 'lead.won:' || new.id);
  end if;
  return new;
end $$;
create trigger org_events_leads after insert or update on leads for each row execute function org_events_from_leads();

create or replace function org_events_from_employees() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform emit_org_event(new.org_id, 'employee.joined', jsonb_build_object('employee_id', new.id, 'name', new.full_name,
    'designation', new.designation, 'joining_date', new.joining_date), 'employee.joined:' || new.id);
  return new;
end $$;
create trigger org_events_employees after insert on employees for each row execute function org_events_from_employees();

create or replace function org_events_from_leave() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    select full_name into v_name from employees where id = new.employee_id;
    -- Who is away and when — never the reason or the leave type.
    perform emit_org_event(new.org_id, 'leave.approved', jsonb_build_object('name', v_name, 'from', new.start_date,
      'to', new.end_date, 'half_day', new.half_day), 'leave.approved:' || new.id);
  end if;
  return new;
end $$;
create trigger org_events_leave after update on leave_requests for each row execute function org_events_from_leave();

create or replace function org_events_from_payroll() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    perform emit_org_event(new.org_id, 'payroll.approved', jsonb_build_object('run_id', new.id,
      'period_start', new.period_start, 'period_end', new.period_end,
      'employees', (select count(*) from payroll_entries where run_id = new.id)), 'payroll.approved:' || new.id);
  end if;
  return new;
end $$;
create trigger org_events_payroll after update on payroll_runs for each row execute function org_events_from_payroll();

create or replace function org_events_from_announcements() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.audience = 'ALL' then   -- department/project announcements stay internal
    perform emit_org_event(new.org_id, 'announcement.published', jsonb_build_object('announcement_id', new.id,
      'title', new.title, 'link', '/announcements'), 'announcement:' || new.id);
  end if;
  return new;
end $$;
create trigger org_events_announcements after insert on company_announcements for each row execute function org_events_from_announcements();

create or replace function org_events_from_tasks() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
    select full_name into v_name from employees where id = new.assignee_id;
    perform emit_org_event(new.org_id, 'task.completed', jsonb_build_object('task_id', new.id, 'title', new.title,
      'assignee', v_name, 'quality', new.quality_score), 'task.completed:' || new.id);
  end if;
  return new;
end $$;
create trigger org_events_tasks after update on tasks for each row execute function org_events_from_tasks();

-- Integration failing 3 times in a row → one alert per failure streak.
create or replace function org_events_from_integration_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.failure_count = 3 and coalesce(old.failure_count, 0) < 3 and new.key not in ('slack','teams','webhooks') then
    perform emit_org_event(new.org_id, 'integration.failing', jsonb_build_object('integration', new.key,
      'error', left(new.last_error, 200), 'link', '/settings/integrations'),
      'integration.failing:' || new.key || ':' || to_char(new.last_failure_at, 'YYYYMMDDHH24MI'));
  end if;
  return new;
end $$;
create trigger org_events_integration after insert or update on integration_status for each row execute function org_events_from_integration_status();

-- ---------------------------------------------------------------------------
-- 7. Inbound webhooks (Meta Lead Ads, Razorpay, WhatsApp delivery status)
-- ---------------------------------------------------------------------------
create table inbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  provider text not null check (provider in ('META_LEADS','RAZORPAY','WHATSAPP')),
  external_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  error text,
  match_kind text check (match_kind in ('INVOICE','PAYROLL_ENTRY','LEAD','DELIVERY')),
  match_id uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);
create index inbound_events_org_idx on inbound_webhook_events(org_id, provider, received_at desc);

-- Campaign leads (Meta Lead Ads) → CRM. Service role only. Same dedupe as website intake.
create or replace function ingest_campaign_lead(p_org_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_lead leads; r record;
begin
  select id into v_org from organizations where slug = p_org_slug;
  if v_org is null then raise exception 'unknown organization'; end if;
  insert into leads(org_id, name, email, phone, company, service_interest, description, source, source_detail)
  values (v_org, left(coalesce(nullif(p->>'name',''), 'Meta lead'), 200), nullif(lower(trim(p->>'email')),''),
          nullif(p->>'phone',''), nullif(p->>'company',''), nullif(p->>'service',''), left(p->>'message', 5000),
          'CAMPAIGN', left('Meta Lead Ads · form ' || coalesce(p->>'form_id','?') || coalesce(' · ad ' || (p->>'ad_id'), ''), 300))
  returning * into v_lead;
  for r in select e.id from employees e where e.org_id = v_org and e.status <> 'EXITED'
           and (e.role = 'SUPER_ADMIN' or exists (select 1 from role_permissions rp where rp.org_id = v_org and rp.role = e.role and rp.permission = 'crm.assign'))
  loop
    perform notify(v_org, r.id, 'CRM', 'New campaign lead: ' || v_lead.name, coalesce(v_lead.service_interest, 'Meta Lead Ads'),
                   '/leads/' || v_lead.id, 'lead:' || v_lead.id);
  end loop;
  return jsonb_build_object('lead_id', v_lead.id, 'duplicate', v_lead.duplicate_of is not null, 'org_id', v_org);
end $$;
revoke all on function ingest_campaign_lead(text,jsonb) from public, anon, authenticated;
grant execute on function ingest_campaign_lead(text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
alter table whatsapp_optins enable row level security;
alter table push_subscriptions enable row level security;
alter table integration_settings enable row level security;
alter table webhook_endpoints enable row level security;
alter table delivery_outbox enable row level security;
alter table inbound_webhook_events enable row level security;

create policy wa_own on whatsapp_optins for all to authenticated
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id() and org_id = current_org_id());
create policy wa_admin_read on whatsapp_optins for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));

create policy push_own on push_subscriptions for all to authenticated
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id() and org_id = current_org_id());

create policy is_settings_admin on integration_settings for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy webhooks_admin on webhook_endpoints for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));
-- The signing secret is shown once at creation; afterwards nobody reads it through the API.
-- (A column revoke is ignored while a table-level SELECT exists, so re-grant column by column.)
revoke select on webhook_endpoints from authenticated, anon;
grant select (id, org_id, name, url, events, enabled, consecutive_failures, disabled_reason,
              last_success_at, last_failure_at, created_by, created_at) on webhook_endpoints to authenticated;

create policy delivery_admin_read on delivery_outbox for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));

create policy inbound_admin_read on inbound_webhook_events for select to authenticated
  using (org_id = current_org_id() and (has_perm('settings.manage') or (provider = 'RAZORPAY' and has_perm('finance.view'))));

-- Audit configuration changes on organisation channels
create or replace function audit_integration_config() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  perform _audit((v->>'org_id')::uuid, 'integration.config.' || lower(tg_op), tg_table_name,
    coalesce(v->>'id', v->>'key'), jsonb_build_object('enabled', v->'enabled', 'events', v->'events', 'name', v->'name'));
  return coalesce(new, old);
end $$;
create trigger audit_integration_settings after insert or update or delete on integration_settings for each row execute function audit_integration_config();
create trigger audit_webhook_endpoints after insert or update or delete on webhook_endpoints for each row execute function audit_integration_config();
