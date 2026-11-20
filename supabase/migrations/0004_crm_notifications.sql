-- =============================================================================
-- 0004 CRM intake, notifications, email outbox (Resend), rate limits
-- Enquiries are persisted BEFORE any email is attempted.
-- =============================================================================
create type lead_status as enum ('NEW','CONTACTED','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST');
create type lead_source as enum ('WEBSITE','PROJECT_ENQUIRY','REFERRAL','CAMPAIGN','MANUAL','OTHER');

create table leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  company text,
  service_interest text,
  description text,
  source lead_source not null default 'MANUAL',
  source_detail text,
  status lead_status not null default 'NEW',
  priority priority_level not null default 'MEDIUM',
  assigned_to uuid references employees(id) on delete set null,
  next_follow_up_at timestamptz,
  lost_reason text,
  phone_normalized text generated always as (right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10)) stored,
  email_normalized text generated always as (lower(trim(email))) stored,
  duplicate_of uuid references leads(id) on delete set null,
  converted_client_id uuid references clients(id) on delete set null,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_org_status_idx on leads(org_id, status, created_at desc);
create index leads_email_idx on leads(org_id, email_normalized);
create index leads_phone_idx on leads(org_id, phone_normalized);
create trigger leads_touch before update on leads for each row execute function touch_updated_at();

create table lead_activities (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  actor_id uuid references employees(id),
  kind text not null check (kind in ('NOTE','CALL','EMAIL','MEETING','STATUS','ASSIGNED','SYSTEM')),
  body text,
  created_at timestamptz not null default now()
);

create or replace function find_lead_duplicate(p_org uuid, p_email text, p_phone text, p_exclude uuid default null)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from leads
  where org_id = p_org and duplicate_of is null and (p_exclude is null or id <> p_exclude)
    and ((p_email is not null and email_normalized = lower(trim(p_email)))
      or (length(right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10)) = 10
          and phone_normalized = right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10)))
  order by created_at asc limit 1
$$;

create or replace function leads_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.duplicate_of is null then
    new.duplicate_of := find_lead_duplicate(new.org_id, new.email, new.phone, new.id);
  end if;
  return new;
end $$;
create trigger leads_dedupe before insert on leads for each row execute function leads_before_insert();

create or replace function leads_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_activities(org_id, lead_id, actor_id, kind, body)
    values (new.org_id, new.id, current_employee_id(), 'SYSTEM',
      'Lead created from ' || new.source || case when new.duplicate_of is not null then ' (possible duplicate)' else '' end);
  else
    if new.status <> old.status then
      insert into lead_activities(org_id, lead_id, actor_id, kind, body)
      values (new.org_id, new.id, current_employee_id(), 'STATUS', old.status || ' → ' || new.status);
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      insert into lead_activities(org_id, lead_id, actor_id, kind, body)
      values (new.org_id, new.id, current_employee_id(), 'ASSIGNED', coalesce(new.assigned_to::text, 'unassigned'));
    end if;
  end if;
  return new;
end $$;
create trigger leads_activity_trg after insert or update on leads for each row execute function leads_activity();

-- ---------------------------------------------------------------------------
-- Notifications + email outbox
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  recipient_id uuid not null references employees(id) on delete cascade,
  category text not null,
  title text not null,
  body text,
  link text check (link is null or link ~ '^/'),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, dedupe_key)
);
create index notifications_recipient_idx on notifications(recipient_id, read_at, created_at desc);

create type email_status as enum ('QUEUED','SENDING','SENT','FAILED','SKIPPED');

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  to_email text not null,
  recipient_employee_id uuid references employees(id) on delete set null,
  template text not null,
  payload jsonb not null default '{}',
  status email_status not null default 'QUEUED',
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, dedupe_key)
);
create index email_outbox_due_idx on email_outbox(next_attempt_at) where status in ('QUEUED','FAILED');

create table rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits int not null
);

-- Fixed-window limiter usable from the service role (public intake) and authenticated APIs.
create or replace function hit_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now(); v_hits int;
begin
  insert into rate_limits(bucket, window_start, hits) values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    hits = case when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds) then 1 else rate_limits.hits + 1 end,
    window_start = case when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds) then v_now else rate_limits.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

create or replace function notify(p_org uuid, p_recipient uuid, p_category text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into notifications(org_id, recipient_id, category, title, body, link, dedupe_key)
  values (p_org, p_recipient, p_category, p_title, p_body, p_link, p_dedupe)
  on conflict (recipient_id, dedupe_key) do nothing;
$$;

create or replace function enqueue_email(p_org uuid, p_to text, p_recipient uuid, p_template text, p_payload jsonb, p_dedupe text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into email_outbox(org_id, to_email, recipient_employee_id, template, payload, dedupe_key)
  values (p_org, lower(trim(p_to)), p_recipient, p_template, coalesce(p_payload,'{}'), p_dedupe)
  on conflict (org_id, dedupe_key) do nothing;
$$;

-- Public website → CRM. Service role only. One transaction: lead + activity + notifications + email jobs.
create or replace function ingest_enquiry(p_org_slug text, p jsonb, p_alert_email text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_lead leads; v_src lead_source; r record;
begin
  select id into v_org from organizations where slug = p_org_slug;
  if v_org is null then raise exception 'unknown organization'; end if;
  v_src := case when p->>'kind' = 'project' then 'PROJECT_ENQUIRY'::lead_source else 'WEBSITE'::lead_source end;
  insert into leads(org_id, name, email, phone, company, service_interest, description, source, source_detail)
  values (v_org, left(p->>'name',200), nullif(lower(trim(p->>'email')),''), nullif(p->>'phone',''),
          nullif(p->>'company',''), nullif(p->>'service',''), left(p->>'message', 5000), v_src, left(p->>'page', 300))
  returning * into v_lead;

  for r in select e.id, e.official_email from employees e
           where e.org_id = v_org and e.status <> 'EXITED'
             and (e.role = 'SUPER_ADMIN' or exists (select 1 from role_permissions rp
                  where rp.org_id = v_org and rp.role = e.role and rp.permission = 'crm.assign'))
  loop
    perform notify(v_org, r.id, 'CRM', 'New enquiry: ' || v_lead.name,
      coalesce(v_lead.service_interest, 'Website enquiry'), '/leads/' || v_lead.id, 'lead:' || v_lead.id);
  end loop;

  if p_alert_email is not null and length(p_alert_email) > 3 then
    perform enqueue_email(v_org, p_alert_email, null, 'lead.new_internal',
      jsonb_build_object('lead_id', v_lead.id, 'name', v_lead.name, 'service', v_lead.service_interest,
                         'duplicate', v_lead.duplicate_of is not null), 'lead.new:' || v_lead.id);
  end if;
  if v_lead.email is not null then
    perform enqueue_email(v_org, v_lead.email, null, 'lead.acknowledgement',
      jsonb_build_object('name', v_lead.name), 'lead.ack:' || v_lead.id);
  end if;
  return jsonb_build_object('lead_id', v_lead.id, 'duplicate', v_lead.duplicate_of is not null);
end $$;

-- Atomically claim a batch of due emails for the worker (service role).
create or replace function claim_email_batch(p_limit int default 20)
returns setof email_outbox language sql security definer set search_path = public, pg_temp as $$
  update email_outbox set status = 'SENDING', attempts = attempts + 1
  where id in (
    select id from email_outbox
    where status in ('QUEUED','FAILED') and next_attempt_at <= now() and attempts < max_attempts
    order by next_attempt_at limit p_limit for update skip locked)
  returning *;
$$;

-- Task assignment → in-app notification + email job (respects the event-first rule).
create or replace function tasks_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from current_employee_id() then
    perform notify(new.org_id, new.assignee_id, 'TASKS', 'New task: ' || new.title, null, '/tasks?focus=' || new.id,
                   'task.assigned:' || new.id || ':' || new.assignee_id);
    select official_email into v_email from employees where id = new.assignee_id;
    perform enqueue_email(new.org_id, v_email, new.assignee_id, 'task.assigned',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'deadline', new.deadline),
      'task.assigned:' || new.id || ':' || new.assignee_id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'REVIEW' and old.status <> 'REVIEW' and new.assigned_by is not null then
    perform notify(new.org_id, new.assigned_by, 'TASKS', 'Ready for review: ' || new.title, null,
                   '/tasks?focus=' || new.id, 'task.review:' || new.id || ':' || new.reopen_count);
  end if;
  return new;
end $$;
create trigger tasks_notify_trg after insert or update on tasks for each row execute function tasks_notify();

create or replace function leave_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mgr uuid;
begin
  if tg_op = 'INSERT' then
    select manager_id into v_mgr from employees where id = new.employee_id;
    if v_mgr is not null then
      perform notify(new.org_id, v_mgr, 'LEAVE', 'Leave request awaiting approval', null, '/approvals', 'leave.req:' || new.id);
    end if;
  elsif new.status <> old.status and new.status in ('APPROVED','REJECTED') then
    perform notify(new.org_id, new.employee_id, 'LEAVE', 'Leave ' || lower(new.status::text), new.decision_note, '/leave',
                   'leave.decision:' || new.id);
  end if;
  return new;
end $$;
create trigger leave_notify_trg after insert or update on leave_requests for each row execute function leave_notify();

create or replace function payroll_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    for r in select pe.employee_id, e.official_email from payroll_entries pe join employees e on e.id = pe.employee_id
             where pe.run_id = new.id loop
      perform notify(new.org_id, r.employee_id, 'PAYROLL', 'Your payslip is available', null, '/payroll/my-salary',
                     'payslip:' || new.id || ':' || r.employee_id);
      -- Email carries NO amounts — only a link to the authenticated payslip page.
      perform enqueue_email(new.org_id, r.official_email, r.employee_id, 'payroll.payslip_available',
        jsonb_build_object('period_start', new.period_start, 'period_end', new.period_end),
        'payslip:' || new.id || ':' || r.employee_id);
    end loop;
  end if;
  return new;
end $$;
create trigger payroll_notify_trg after update on payroll_runs for each row execute function payroll_notify();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table leads enable row level security;
alter table lead_activities enable row level security;
alter table notifications enable row level security;
alter table email_outbox enable row level security;
alter table rate_limits enable row level security;

create policy leads_read on leads for select to authenticated
  using (org_id = current_org_id() and (has_perm('crm.view_all') or assigned_to = current_employee_id()
         or (has_perm('crm.manage') and assigned_to is null)));
create policy leads_insert on leads for insert to authenticated
  with check (org_id = current_org_id() and (has_perm('crm.manage') or has_perm('crm.view_all')) and source <> 'WEBSITE');
create policy leads_update on leads for update to authenticated
  using (org_id = current_org_id() and (has_perm('crm.assign') or (has_perm('crm.manage') and assigned_to = current_employee_id())))
  with check (org_id = current_org_id() and (has_perm('crm.assign') or assigned_to = current_employee_id()));

create policy la_read on lead_activities for select to authenticated
  using (exists (select 1 from leads l where l.id = lead_id and l.org_id = current_org_id()));
create policy la_insert on lead_activities for insert to authenticated
  with check (org_id = current_org_id() and actor_id = current_employee_id() and kind in ('NOTE','CALL','EMAIL','MEETING')
              and exists (select 1 from leads l where l.id = lead_id and l.org_id = current_org_id()));

create policy notif_read on notifications for select to authenticated using (recipient_id = current_employee_id());
create policy notif_mark on notifications for update to authenticated
  using (recipient_id = current_employee_id()) with check (recipient_id = current_employee_id());

create policy outbox_admin_read on email_outbox for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
-- rate_limits: no policies → no direct access for anon/authenticated.

revoke all on function ingest_enquiry(text,jsonb,text) from public, anon, authenticated;
revoke all on function claim_email_batch(int) from public, anon, authenticated;
revoke all on function notify(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function enqueue_email(uuid,text,uuid,text,jsonb,text) from public, anon, authenticated;
revoke all on function hit_rate_limit(text,int,int) from public, anon;
grant execute on function ingest_enquiry(text,jsonb,text) to service_role;
grant execute on function claim_email_batch(int) to service_role;
grant execute on function hit_rate_limit(text,int,int) to service_role, authenticated;
