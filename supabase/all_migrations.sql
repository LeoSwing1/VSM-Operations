-- VSM Growth Operations — ALL migrations in one file (generated). Paste into Supabase SQL Editor and Run once on an EMPTY project.

-- >>> 0001_foundation.sql
-- =============================================================================
-- VSM Growth Operations — 0001 Foundation
-- Organizations, people, RBAC, audit. Every table is org-scoped and RLS-protected.
-- =============================================================================
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app_role as enum (
  'SUPER_ADMIN','ADMIN','HR_MANAGER','OPERATIONS_MANAGER','DEPARTMENT_MANAGER',
  'TEAM_LEAD','SALES_EXECUTIVE','PROJECT_MANAGER','EMPLOYEE','INTERN'
);
create type employment_status as enum ('ACTIVE','PROBATION','NOTICE','ON_LEAVE','EXITED');
create type employment_type as enum ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT');

-- ---------------------------------------------------------------------------
-- Organizations & structure
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  grace_minutes int not null default 10 check (grace_minutes between 0 and 180),
  half_day_minutes int not null default 240 check (half_day_minutes > 0),
  full_day_minutes int not null default 480 check (full_day_minutes > 0),
  weekly_offs int[] not null default '{0}',            -- 0 = Sunday … 6 = Saturday
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  head_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  employee_code text not null,
  full_name text not null,
  official_email text not null,
  phone text,
  photo_url text,
  designation text,
  department_id uuid references departments(id) on delete set null,
  manager_id uuid references employees(id) on delete set null,
  role app_role not null default 'EMPLOYEE',
  joining_date date not null default current_date,
  exit_date date,
  status employment_status not null default 'ACTIVE',
  employment_type employment_type not null default 'FULL_TIME',
  work_location text,
  shift_id uuid references shifts(id) on delete set null,
  skills text[] not null default '{}',
  emergency_contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, employee_code),
  unique (org_id, official_email),
  check (manager_id is null or manager_id <> id),
  check (exit_date is null or exit_date >= joining_date)
);
create index employees_org_idx on employees(org_id);
create index employees_manager_idx on employees(manager_id);
create index employees_dept_idx on employees(department_id);

alter table departments
  add constraint departments_head_fk foreign key (head_employee_id) references employees(id) on delete set null;

-- Configurable role → permission mapping, per organization.
create table role_permissions (
  org_id uuid not null references organizations(id) on delete cascade,
  role app_role not null,
  permission text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (org_id, role, permission)
);

-- Immutable audit trail.
create table audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  actor_employee_id uuid references employees(id) on delete set null,
  actor_user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_org_time_idx on audit_events(org_id, created_at desc);
create index audit_entity_idx on audit_events(entity, entity_id);

-- ---------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER so RLS policies can call them without
-- recursion; each one only ever answers about the *calling* user.
-- ---------------------------------------------------------------------------
create or replace function current_employee_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from employees
  where user_id = auth.uid() and status <> 'EXITED'
  limit 1
$$;

create or replace function current_org_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select org_id from employees
  where user_id = auth.uid() and status <> 'EXITED'
  limit 1
$$;

create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from employees
  where user_id = auth.uid() and status <> 'EXITED'
  limit 1
$$;

create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select e.role = 'SUPER_ADMIN'
        or exists (select 1 from role_permissions rp
                   where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p)
     from employees e
     where e.user_id = auth.uid() and e.status <> 'EXITED'
     limit 1),
    false)
$$;

-- Is `target` in the caller's reporting line (direct or indirect),
-- or in a department the caller heads?
create or replace function is_in_my_team(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive me as (select current_employee_id() as id),
  chain as (
    select e.id, e.manager_id, 1 as depth from employees e where e.id = target
    union all
    select m.id, m.manager_id, c.depth + 1
    from employees m join chain c on m.id = c.manager_id
    where c.depth < 12
  )
  select (select id from me) is not null and target <> (select id from me) and (
    exists (select 1 from chain c where c.manager_id = (select id from me))
    or exists (
      select 1 from employees t join departments d on d.id = t.department_id
      where t.id = target and d.head_employee_id = (select id from me)
    )
  )
$$;

create or replace function can_view_employee(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select target = current_employee_id()
      or has_perm('people.view_all')
      or (has_perm('people.view_team') and is_in_my_team(target))
$$;

create or replace function log_audit(p_action text, p_entity text, p_entity_id text, p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := current_org_id();
begin
  if v_org is null then
    raise exception 'not an active member of an organization' using errcode = '42501';
  end if;
  insert into audit_events(org_id, actor_employee_id, actor_user_id, action, entity, entity_id, metadata)
  values (v_org, current_employee_id(), auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'));
end $$;

-- Internal audit writer used by triggers (org passed explicitly).
create or replace function _audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_metadata jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into audit_events(org_id, actor_employee_id, actor_user_id, action, entity, entity_id, metadata)
  values (p_org, current_employee_id(), auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata,'{}'));
$$;

-- What the app needs to render the shell for the signed-in user.
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'employee_id', e.id,
    'org_id', e.org_id,
    'org_name', o.name,
    'timezone', o.timezone,
    'full_name', e.full_name,
    'email', e.official_email,
    'designation', e.designation,
    'role', e.role,
    'photo_url', e.photo_url,
    'permissions', case when e.role = 'SUPER_ADMIN'
        then to_jsonb(array['*'])
        else coalesce((select jsonb_agg(rp.permission order by rp.permission)
                       from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role), '[]'::jsonb)
      end
  )
  from employees e join organizations o on o.id = e.org_id
  where e.user_id = auth.uid() and e.status <> 'EXITED'
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger employees_touch before update on employees for each row execute function touch_updated_at();

-- No privilege escalation: nobody edits their own role; only SUPER_ADMIN grants SUPER_ADMIN/ADMIN;
-- org_id and user_id links cannot be moved by ordinary updates.
create or replace function employees_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_role app_role := current_role_name();
begin
  if auth.uid() is null then return new; end if;  -- service role / migrations
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'org_id is immutable' using errcode='42501'; end if;
    if new.user_id is distinct from old.user_id and v_role not in ('SUPER_ADMIN','ADMIN') then
      raise exception 'only administrators can relink accounts' using errcode='42501';
    end if;
    if new.role <> old.role then
      if old.id = v_me then raise exception 'you cannot change your own role' using errcode='42501'; end if;
      if not has_perm('roles.manage') then raise exception 'roles.manage required' using errcode='42501'; end if;
    end if;
  end if;
  if new.role in ('SUPER_ADMIN','ADMIN') and (tg_op = 'INSERT' or new.role <> old.role) and v_role <> 'SUPER_ADMIN' then
    raise exception 'only a super admin can grant % role', new.role using errcode='42501';
  end if;
  return new;
end $$;
create trigger employees_guard_trg before insert or update on employees for each row execute function employees_guard();

create or replace function employees_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform _audit(new.org_id, 'employee.created', 'employee', new.id::text, jsonb_build_object('role', new.role));
  elsif new.role <> old.role or new.status <> old.status or new.manager_id is distinct from old.manager_id then
    perform _audit(new.org_id, 'employee.updated', 'employee', new.id::text, jsonb_build_object(
      'role', jsonb_build_array(old.role, new.role),
      'status', jsonb_build_array(old.status, new.status),
      'manager_id', jsonb_build_array(old.manager_id, new.manager_id)));
  end if;
  return new;
end $$;
create trigger employees_audit_trg after insert or update on employees for each row execute function employees_audit();

create or replace function role_permissions_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform _audit(old.org_id, 'permission.revoked', 'role_permission', old.role || ':' || old.permission, '{}');
    return old;
  end if;
  perform _audit(new.org_id, 'permission.granted', 'role_permission', new.role || ':' || new.permission, '{}');
  return new;
end $$;
create trigger role_permissions_audit_trg after insert or delete on role_permissions
  for each row execute function role_permissions_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;
alter table shifts enable row level security;
alter table departments enable row level security;
alter table employees enable row level security;
alter table role_permissions enable row level security;
alter table audit_events enable row level security;

create policy org_read on organizations for select to authenticated using (id = current_org_id());
create policy org_update on organizations for update to authenticated
  using (id = current_org_id() and has_perm('settings.manage')) with check (id = current_org_id());

create policy shifts_read on shifts for select to authenticated using (org_id = current_org_id());
create policy shifts_write on shifts for all to authenticated
  using (org_id = current_org_id() and has_perm('attendance.manage'))
  with check (org_id = current_org_id() and has_perm('attendance.manage'));

create policy departments_read on departments for select to authenticated using (org_id = current_org_id());
create policy departments_write on departments for all to authenticated
  using (org_id = current_org_id() and has_perm('people.manage'))
  with check (org_id = current_org_id() and has_perm('people.manage'));

create policy employees_read on employees for select to authenticated
  using (org_id = current_org_id() and can_view_employee(id));
create policy employees_insert on employees for insert to authenticated
  with check (org_id = current_org_id() and has_perm('people.manage'));
create policy employees_update on employees for update to authenticated
  using (org_id = current_org_id() and has_perm('people.manage'))
  with check (org_id = current_org_id());

create policy role_permissions_read on role_permissions for select to authenticated
  using (org_id = current_org_id());
create policy role_permissions_write on role_permissions for all to authenticated
  using (org_id = current_org_id() and has_perm('roles.manage') and role <> 'SUPER_ADMIN')
  with check (org_id = current_org_id() and has_perm('roles.manage') and role <> 'SUPER_ADMIN');

create policy audit_read on audit_events for select to authenticated
  using (org_id = current_org_id() and has_perm('audit.view'));
-- No insert/update/delete policies: audit rows are written only via SECURITY DEFINER functions.

-- Directory view: the safe, org-wide subset (for chat, assignment pickers, org chart).
create view employee_directory with (security_barrier = true) as
  select e.id, e.org_id, e.employee_code, e.full_name, e.designation, e.department_id,
         d.name as department_name, e.manager_id, e.photo_url, e.status, e.role
  from employees e left join departments d on d.id = e.department_id
  where e.org_id = current_org_id() and e.status <> 'EXITED';

-- ---------------------------------------------------------------------------
-- Default permission catalogue (configurable afterwards in /settings/roles)
-- ---------------------------------------------------------------------------
create or replace function seed_default_permissions(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb := jsonb_build_object(
    'ADMIN', jsonb_build_array(
      'people.view_all','people.manage','attendance.view_all','attendance.approve','attendance.manage',
      'leave.view_all','leave.approve','leave.manage','tasks.view_all','tasks.manage','tasks.review',
      'projects.view_all','projects.manage','crm.view_all','crm.manage','crm.assign',
      'clients.view_all','clients.manage','performance.view_all','performance.review','performance.configure',
      'reports.view_org','settings.manage','roles.manage','audit.view'),
    'HR_MANAGER', jsonb_build_array(
      'people.view_all','people.manage','attendance.view_all','attendance.approve','attendance.manage',
      'leave.view_all','leave.approve','leave.manage','performance.view_all','performance.review',
      'performance.configure','payroll.view_all','payroll.manage','payroll.export','salary.manage',
      'reports.view_org','audit.view'),
    'OPERATIONS_MANAGER', jsonb_build_array(
      'people.view_all','attendance.view_all','attendance.approve','leave.view_all','leave.approve',
      'tasks.view_all','tasks.manage','tasks.review','projects.view_all','projects.manage',
      'clients.view_all','performance.view_all','performance.review','reports.view_org'),
    'DEPARTMENT_MANAGER', jsonb_build_array(
      'people.view_team','attendance.view_team','attendance.approve','leave.approve',
      'tasks.view_team','tasks.manage','tasks.review','projects.manage',
      'performance.view_team','performance.review'),
    'TEAM_LEAD', jsonb_build_array(
      'people.view_team','attendance.view_team','attendance.approve','leave.approve',
      'tasks.view_team','tasks.manage','tasks.review','performance.view_team','performance.review'),
    'SALES_EXECUTIVE', jsonb_build_array('crm.manage','clients.view_all'),
    'PROJECT_MANAGER', jsonb_build_array(
      'tasks.view_team','tasks.manage','tasks.review','projects.view_all','projects.manage','clients.view_all'),
    'EMPLOYEE', jsonb_build_array(),
    'INTERN', jsonb_build_array()
  );
  r text; p text;
begin
  for r in select jsonb_object_keys(m) loop
    for p in select jsonb_array_elements_text(m -> r) loop
      insert into role_permissions(org_id, role, permission) values (p_org, r::app_role, p)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- One-time bootstrap of the first organization + its super admin.
-- Callable only with the service role (Supabase SQL editor / CLI). Refuses once any org exists.
create or replace function bootstrap_organization(
  p_org_name text, p_slug text, p_admin_user uuid, p_admin_name text, p_admin_email text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_shift uuid;
begin
  if exists (select 1 from organizations) then
    raise exception 'bootstrap already completed';
  end if;
  insert into organizations(name, slug) values (p_org_name, p_slug) returning id into v_org;
  insert into shifts(org_id, name) values (v_org, 'General 9–6') returning id into v_shift;
  perform seed_default_permissions(v_org);
  insert into employees(org_id, user_id, employee_code, full_name, official_email, role, shift_id, designation)
  values (v_org, p_admin_user, 'VSM-0001', p_admin_name, lower(p_admin_email), 'SUPER_ADMIN', v_shift, 'Founder');
  -- Starting defaults (tables created in later migrations; plpgsql binds at run time). All editable.
  insert into leave_types(org_id, code, name, is_paid, annual_quota) values
    (v_org, 'CL', 'Casual leave', true, 12), (v_org, 'SL', 'Sick leave', true, 6), (v_org, 'LOP', 'Unpaid leave', false, 0);
  insert into performance_policies(org_id, name, weights) values (v_org, 'Organisation default',
    '{"task_completion":20,"task_quality":25,"on_time_delivery":15,"productivity":15,"attendance":10,"daily_updates":5,"manager_review":10}');
  insert into incentive_policies(org_id, name, slabs) values (v_org, 'Standard incentive (example)',
    '[{"min":90,"pct":100},{"min":80,"pct":75},{"min":65,"pct":50},{"min":50,"pct":25}]');
  return v_org;
end $$;

revoke all on function bootstrap_organization(text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function seed_default_permissions(uuid) from public, anon, authenticated;
revoke all on function _audit(uuid,text,text,text,jsonb) from public, anon, authenticated;

-- >>> 0002_workforce.sql
-- =============================================================================
-- 0002 Workforce — attendance, corrections, holidays, leave, daily updates,
-- projects, tasks (with review/quality separated from completion).
-- =============================================================================
grant execute on function bootstrap_organization(text,text,uuid,text,text) to service_role;

create type attendance_event_type as enum ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END');
create type request_status as enum ('PENDING','APPROVED','REJECTED','CANCELLED');

create table holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  unique (org_id, holiday_date)
);

create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  event_type attendance_event_type not null,
  occurred_at timestamptz not null,
  source text not null default 'WEB' check (source in ('WEB','MOBILE','CORRECTION','ADMIN')),
  correction_id uuid,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index attendance_emp_time_idx on attendance_events(employee_id, occurred_at);
create unique index attendance_no_dupe on attendance_events(employee_id, event_type, occurred_at);

create table attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  event_type attendance_event_type not null,
  requested_time timestamptz not null,
  reason text not null check (length(reason) between 5 and 1000),
  status request_status not null default 'PENDING',
  decided_by uuid references employees(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index corrections_emp_idx on attendance_corrections(employee_id, status);

-- Single entry point for clock events: validates the state machine, rate-limits, prevents doubles.
create or replace function record_attendance(p_type attendance_event_type, p_source text default 'WEB')
returns attendance_events language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_emp uuid := current_employee_id();
  v_org uuid := current_org_id();
  v_tz text;
  v_last attendance_events;
  v_row attendance_events;
  v_today_start timestamptz;
begin
  if v_emp is null then raise exception 'not an active employee' using errcode='42501'; end if;
  if p_source not in ('WEB','MOBILE') then raise exception 'invalid source'; end if;
  perform pg_advisory_xact_lock(hashtext(v_emp::text));
  select timezone into v_tz from organizations where id = v_org;
  v_today_start := (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;

  select * into v_last from attendance_events
   where employee_id = v_emp and occurred_at >= v_today_start
   order by occurred_at desc, created_at desc limit 1;

  if v_last.id is not null and now() - v_last.created_at < interval '30 seconds' then
    raise exception 'please wait a few seconds before the next punch' using errcode='P0001';
  end if;

  if p_type = 'CLOCK_IN' and v_last.id is not null and v_last.event_type <> 'CLOCK_OUT' then
    raise exception 'already clocked in' using errcode='P0001';
  elsif p_type = 'CLOCK_OUT' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    if v_last.event_type = 'BREAK_START' then
      raise exception 'end your break before clocking out' using errcode='P0001';
    end if;
    raise exception 'you are not clocked in' using errcode='P0001';
  elsif p_type = 'BREAK_START' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    raise exception 'clock in before starting a break' using errcode='P0001';
  elsif p_type = 'BREAK_END' and (v_last.id is null or v_last.event_type <> 'BREAK_START') then
    raise exception 'no break in progress' using errcode='P0001';
  end if;

  insert into attendance_events(org_id, employee_id, event_type, occurred_at, source, created_by)
  values (v_org, v_emp, p_type, date_trunc('second', now()), p_source, v_emp)
  returning * into v_row;
  return v_row;
end $$;

create or replace function decide_attendance_correction(p_id uuid, p_approve boolean, p_note text default null)
returns attendance_corrections language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_c attendance_corrections;
begin
  select * into v_c from attendance_corrections where id = p_id and org_id = current_org_id() for update;
  if v_c.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_c.status <> 'PENDING' then raise exception 'already decided' using errcode='P0001'; end if;
  if v_c.employee_id = v_me then raise exception 'you cannot approve your own request' using errcode='42501'; end if;
  if not (has_perm('attendance.manage') or (has_perm('attendance.approve') and is_in_my_team(v_c.employee_id))) then
    raise exception 'not authorized for this employee' using errcode='42501';
  end if;
  update attendance_corrections set status = case when p_approve then 'APPROVED'::request_status else 'REJECTED' end,
    decided_by = v_me, decided_at = now(), decision_note = p_note
  where id = p_id returning * into v_c;
  if p_approve then
    insert into attendance_events(org_id, employee_id, event_type, occurred_at, source, correction_id, created_by)
    values (v_c.org_id, v_c.employee_id, v_c.event_type, v_c.requested_time, 'CORRECTION', v_c.id, v_me)
    on conflict do nothing;
  end if;
  perform _audit(v_c.org_id, 'attendance.correction.' || lower(v_c.status::text), 'attendance_correction', v_c.id::text,
    jsonb_build_object('employee_id', v_c.employee_id, 'event_type', v_c.event_type, 'time', v_c.requested_time, 'note', p_note));
  return v_c;
end $$;

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
create table leave_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}$'),
  name text not null,
  is_paid boolean not null default true,
  annual_quota numeric(5,1) not null default 0 check (annual_quota >= 0),
  requires_document boolean not null default false,
  unique (org_id, code)
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  half_day boolean not null default false,
  reason text not null check (length(reason) between 3 and 2000),
  document_path text,
  status request_status not null default 'PENDING',
  decided_by uuid references employees(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (not half_day or start_date = end_date)
);
create index leave_emp_idx on leave_requests(employee_id, start_date);
-- No two live requests may overlap for the same employee.
alter table leave_requests add constraint leave_no_overlap exclude using gist (
  employee_id with =, daterange(start_date, end_date, '[]') with &&
) where (status in ('PENDING','APPROVED'));

create or replace function decide_leave(p_id uuid, p_approve boolean, p_note text default null)
returns leave_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_l leave_requests;
begin
  select * into v_l from leave_requests where id = p_id and org_id = current_org_id() for update;
  if v_l.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_l.status <> 'PENDING' then raise exception 'already decided' using errcode='P0001'; end if;
  if v_l.employee_id = v_me then raise exception 'you cannot approve your own leave' using errcode='42501'; end if;
  if not (has_perm('leave.manage') or (has_perm('leave.approve') and is_in_my_team(v_l.employee_id))) then
    raise exception 'not authorized for this employee' using errcode='42501';
  end if;
  if not p_approve and coalesce(length(trim(p_note)),0) < 3 then
    raise exception 'a rejection needs a comment' using errcode='P0001';
  end if;
  update leave_requests set status = case when p_approve then 'APPROVED'::request_status else 'REJECTED' end,
    decided_by = v_me, decided_at = now(), decision_note = p_note
  where id = p_id returning * into v_l;
  perform _audit(v_l.org_id, 'leave.' || lower(v_l.status::text), 'leave_request', v_l.id::text,
    jsonb_build_object('employee_id', v_l.employee_id));
  return v_l;
end $$;

-- ---------------------------------------------------------------------------
-- Daily updates
-- ---------------------------------------------------------------------------
create table daily_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  completed text not null,
  in_progress text,
  blockers text,
  tomorrow text,
  minutes_spent int check (minutes_spent between 0 and 1440),
  manager_comment text,
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ---------------------------------------------------------------------------
-- Clients (minimal; full Client 360 in a later block), projects, tasks
-- ---------------------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  relationship_manager_id uuid references employees(id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','CHURNED','PROSPECT')),
  created_at timestamptz not null default now()
);

create type project_status as enum ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED');
create type priority_level as enum ('LOW','MEDIUM','HIGH','URGENT');
create type task_status as enum ('BACKLOG','TODO','IN_PROGRESS','REVIEW','COMPLETED','BLOCKED','CANCELLED');

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  client_id uuid references clients(id) on delete set null,
  description text,
  start_date date,
  deadline date,
  priority priority_level not null default 'MEDIUM',
  status project_status not null default 'PLANNING',
  manager_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  primary key (project_id, employee_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null check (length(title) between 2 and 300),
  description text,
  assignee_id uuid references employees(id) on delete set null,
  assigned_by uuid references employees(id) on delete set null,
  priority priority_level not null default 'MEDIUM',
  deadline timestamptz,
  estimated_hours numeric(6,2) check (estimated_hours >= 0),
  actual_hours numeric(6,2) check (actual_hours >= 0),
  status task_status not null default 'TODO',
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  review_note text,
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  reopen_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assignee_idx on tasks(assignee_id, status);
create index tasks_project_idx on tasks(project_id);
create index tasks_deadline_idx on tasks(org_id, deadline) where status not in ('COMPLETED','CANCELLED');

create table task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  org_id uuid not null,
  actor_id uuid,
  kind text not null,
  from_status task_status,
  to_status task_status,
  note text,
  created_at timestamptz not null default now()
);

create or replace function can_see_task(t tasks) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select t.assignee_id = current_employee_id()
      or t.assigned_by = current_employee_id()
      or has_perm('tasks.view_all')
      or (has_perm('tasks.view_team') and t.assignee_id is not null and is_in_my_team(t.assignee_id))
      or exists (select 1 from project_members pm where pm.project_id = t.project_id and pm.employee_id = current_employee_id())
      or exists (select 1 from projects p where p.id = t.project_id and p.manager_id = current_employee_id())
$$;

-- Assignees move work forward but can never grade themselves or self-complete.
create or replace function tasks_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_manager boolean;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  v_manager := has_perm('tasks.manage') and (new.assigned_by = v_me or has_perm('tasks.view_all') or is_in_my_team(new.assignee_id));
  if tg_op = 'INSERT' then
    if not v_manager and new.assignee_id is distinct from v_me then
      raise exception 'tasks.manage required to assign work to others' using errcode='42501';
    end if;
    new.assigned_by := v_me;
    new.quality_score := null; new.reviewed_by := null; new.reviewed_at := null;
    if new.status = 'COMPLETED' then new.status := 'TODO'; end if;
    return new;
  end if;
  -- review fields only change through review_task()
  if (new.quality_score is distinct from old.quality_score or new.reviewed_by is distinct from old.reviewed_by
      or new.reopen_count <> old.reopen_count)
     and coalesce(current_setting('app.in_review', true), '') <> 'on' then
    raise exception 'use review_task() to review work' using errcode='42501';
  end if;
  if new.status = 'COMPLETED' and old.status <> 'COMPLETED' and coalesce(current_setting('app.in_review', true), '') <> 'on' then
    raise exception 'tasks are completed through review' using errcode='42501';
  end if;
  if not v_manager then
    if old.assignee_id is distinct from v_me then raise exception 'not your task' using errcode='42501'; end if;
    if (new.title, new.description, new.assignee_id, new.deadline, new.priority, new.project_id, new.estimated_hours)
       is distinct from (old.title, old.description, old.assignee_id, old.deadline, old.priority, old.project_id, old.estimated_hours)
       and old.assigned_by is distinct from v_me then
      raise exception 'only the assigning manager can edit task details' using errcode='42501';
    end if;
    if new.status = 'CANCELLED' and old.assigned_by is distinct from v_me then
      raise exception 'only the assigning manager can cancel' using errcode='42501';
    end if;
  end if;
  if new.status = 'IN_PROGRESS' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'REVIEW' and old.status <> 'REVIEW' then new.submitted_at := now(); end if;
  return new;
end $$;
create trigger tasks_guard_trg before insert or update on tasks for each row execute function tasks_guard();

create or replace function tasks_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into task_events(task_id, org_id, actor_id, kind, to_status) values (new.id, new.org_id, current_employee_id(), 'created', new.status);
  else
    if new.status <> old.status then
      insert into task_events(task_id, org_id, actor_id, kind, from_status, to_status)
      values (new.id, new.org_id, current_employee_id(), 'status', old.status, new.status);
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into task_events(task_id, org_id, actor_id, kind, note)
      values (new.id, new.org_id, current_employee_id(), 'reassigned', coalesce(new.assignee_id::text,'unassigned'));
    end if;
  end if;
  return new;
end $$;
create trigger tasks_history_trg after insert or update on tasks for each row execute function tasks_history();

-- Review = separate act from completion. Approve with a quality score, or send back (reopen).
create or replace function review_task(p_task uuid, p_approve boolean, p_quality numeric, p_note text default null)
returns tasks language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_t tasks;
begin
  select * into v_t from tasks where id = p_task and org_id = current_org_id() for update;
  if v_t.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_t.status <> 'REVIEW' then raise exception 'task is not awaiting review' using errcode='P0001'; end if;
  if v_t.assignee_id = v_me then raise exception 'you cannot review your own task' using errcode='42501'; end if;
  if not (has_perm('tasks.review') and (v_t.assigned_by = v_me or has_perm('tasks.view_all') or is_in_my_team(v_t.assignee_id)
          or exists (select 1 from projects p where p.id = v_t.project_id and p.manager_id = v_me))) then
    raise exception 'not authorized to review this task' using errcode='42501';
  end if;
  if p_approve and (p_quality is null or p_quality < 0 or p_quality > 100) then
    raise exception 'quality score 0–100 required on approval' using errcode='P0001';
  end if;
  perform set_config('app.in_review', 'on', true);
  if p_approve then
    update tasks set status='COMPLETED', completed_at=coalesce(submitted_at, now()), quality_score=p_quality,
      review_note=p_note, reviewed_by=v_me, reviewed_at=now() where id=p_task returning * into v_t;
  else
    update tasks set status='IN_PROGRESS', reopen_count=reopen_count+1, review_note=p_note,
      reviewed_by=v_me, reviewed_at=now() where id=p_task returning * into v_t;
  end if;
  perform set_config('app.in_review', 'off', true);
  insert into task_events(task_id, org_id, actor_id, kind, note)
  values (v_t.id, v_t.org_id, v_me, case when p_approve then 'review.approved' else 'review.rejected' end,
          coalesce(p_note,'') || case when p_approve then ' [quality ' || p_quality || ']' else '' end);
  return v_t;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table holidays enable row level security;
alter table attendance_events enable row level security;
alter table attendance_corrections enable row level security;
alter table leave_types enable row level security;
alter table leave_requests enable row level security;
alter table daily_updates enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table tasks enable row level security;
alter table task_events enable row level security;

create policy holidays_read on holidays for select to authenticated using (org_id = current_org_id());
create policy holidays_write on holidays for all to authenticated
  using (org_id = current_org_id() and has_perm('attendance.manage'))
  with check (org_id = current_org_id() and has_perm('attendance.manage'));

create or replace function can_view_attendance(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select target = current_employee_id() or has_perm('attendance.view_all')
      or (has_perm('attendance.view_team') and is_in_my_team(target))
$$;

-- Events: read by scope; writes ONLY via record_attendance()/decide_attendance_correction().
create policy att_read on attendance_events for select to authenticated
  using (org_id = current_org_id() and can_view_attendance(employee_id));

create policy corr_read on attendance_corrections for select to authenticated
  using (org_id = current_org_id() and can_view_attendance(employee_id));
create policy corr_insert on attendance_corrections for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id() and status = 'PENDING'
              and decided_by is null and requested_time <= now());

create policy lt_read on leave_types for select to authenticated using (org_id = current_org_id());
create policy lt_write on leave_types for all to authenticated
  using (org_id = current_org_id() and has_perm('leave.manage'))
  with check (org_id = current_org_id() and has_perm('leave.manage'));

create policy leave_read on leave_requests for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('leave.view_all')
         or ((has_perm('leave.approve') or has_perm('attendance.view_team')) and is_in_my_team(employee_id))));
create policy leave_insert on leave_requests for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id() and status = 'PENDING' and decided_by is null);
create policy leave_cancel on leave_requests for update to authenticated
  using (employee_id = current_employee_id() and status = 'PENDING')
  with check (employee_id = current_employee_id() and status in ('PENDING','CANCELLED') and decided_by is null);

create policy du_read on daily_updates for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('people.view_all')
         or (has_perm('people.view_team') and is_in_my_team(employee_id))));
create policy du_insert on daily_updates for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id()
              and manager_comment is null and reviewed_by is null);
create policy du_update_own on daily_updates for update to authenticated
  using (employee_id = current_employee_id() and work_date >= current_date - 1 and reviewed_by is null)
  with check (employee_id = current_employee_id() and reviewed_by is null);
create policy du_review on daily_updates for update to authenticated
  using (org_id = current_org_id() and employee_id <> current_employee_id() and is_in_my_team(employee_id))
  with check (org_id = current_org_id());

create policy clients_read on clients for select to authenticated
  using (org_id = current_org_id() and (has_perm('clients.view_all') or relationship_manager_id = current_employee_id()));
create policy clients_write on clients for all to authenticated
  using (org_id = current_org_id() and has_perm('clients.manage'))
  with check (org_id = current_org_id() and has_perm('clients.manage'));

create or replace function is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from project_members pm where pm.project_id = p_project and pm.employee_id = current_employee_id())
$$;
create or replace function project_in_my_org(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from projects p where p.id = p_project and p.org_id = current_org_id())
$$;

create policy projects_read on projects for select to authenticated
  using (org_id = current_org_id() and (has_perm('projects.view_all') or manager_id = current_employee_id()
         or is_project_member(id)));
create policy projects_write on projects for all to authenticated
  using (org_id = current_org_id() and has_perm('projects.manage'))
  with check (org_id = current_org_id() and has_perm('projects.manage'));

create policy pm_read on project_members for select to authenticated
  using (project_in_my_org(project_id));
create policy pm_write on project_members for all to authenticated
  using (has_perm('projects.manage') and project_in_my_org(project_id))
  with check (has_perm('projects.manage') and project_in_my_org(project_id));

create policy tasks_read on tasks for select to authenticated
  using (org_id = current_org_id() and can_see_task(tasks));
create policy tasks_insert on tasks for insert to authenticated
  with check (org_id = current_org_id());               -- tasks_guard enforces who may assign whom
create policy tasks_update on tasks for update to authenticated
  using (org_id = current_org_id() and can_see_task(tasks))
  with check (org_id = current_org_id());

create policy task_events_read on task_events for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and t.org_id = current_org_id() and can_see_task(t)));

-- >>> 0003_performance_payroll.sql
-- =============================================================================
-- 0003 Performance & Payroll
-- Salary data is visible ONLY to the employee themself and to roles holding
-- payroll.view_all. Managers do not inherit salary visibility.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------
create or replace function valid_weights(w jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(w) = 'object'
     and not exists (select 1 from jsonb_object_keys(w) k where k not in
         ('task_completion','task_quality','on_time_delivery','productivity','attendance','daily_updates','manager_review','rework'))
     and not exists (select 1 from jsonb_each(w) e where jsonb_typeof(e.value) <> 'number' or (e.value)::numeric < 0)
     and (select coalesce(sum((value)::numeric), 0) from jsonb_each(w)) = 100
$$;

create table performance_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  department_id uuid references departments(id) on delete cascade,
  role app_role,
  weights jsonb not null check (valid_weights(weights)),
  min_coverage numeric(5,2) not null default 60 check (min_coverage between 0 and 100),
  category_thresholds jsonb not null default '{"EXCEPTIONAL":90,"EXCELLENT":80,"GOOD":65,"NEEDS_IMPROVEMENT":50}',
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create type snapshot_status as enum ('DRAFT','APPROVED','SUPERSEDED');

create table performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  policy_id uuid not null references performance_policies(id),
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,          -- raw inputs + source record ids
  components jsonb not null,       -- per-dimension score, weight, contribution
  computed_score numeric(5,2),     -- null = insufficient data
  adjustment numeric(5,2) not null default 0,
  final_score numeric(5,2),
  category text,
  coverage numeric(5,2) not null,
  status snapshot_status not null default 'DRAFT',
  computed_by uuid references employees(id),
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index perf_one_live_snapshot on performance_snapshots(employee_id, period_start, period_end)
  where status <> 'SUPERSEDED';

create table score_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  snapshot_id uuid not null references performance_snapshots(id) on delete cascade,
  delta numeric(5,2) not null check (delta between -20 and 20 and delta <> 0),
  reason text not null check (length(reason) >= 10),
  adjusted_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);

create table manager_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  reviewer_id uuid not null references employees(id),
  period_start date not null,
  period_end date not null,
  rating numeric(5,2) not null check (rating between 0 and 100),
  shared_comments text,              -- visible to the employee
  created_at timestamptz not null default now(),
  unique (employee_id, reviewer_id, period_start, period_end),
  check (employee_id <> reviewer_id)
);
-- Confidential notes live in a separate table the employee can never read.
create table manager_review_notes (
  review_id uuid primary key references manager_reviews(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  private_notes text not null
);

create table performance_review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  snapshot_id uuid not null references performance_snapshots(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  message text not null check (length(message) between 10 and 2000),
  status request_status not null default 'PENDING',
  response text,
  responded_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create or replace function can_view_performance(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select target = current_employee_id() or has_perm('performance.view_all')
      or (has_perm('performance.view_team') and is_in_my_team(target))
$$;

create or replace function adjust_snapshot(p_snapshot uuid, p_delta numeric, p_reason text)
returns performance_snapshots language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s performance_snapshots; v_me uuid := current_employee_id(); v_total numeric;
begin
  select * into v_s from performance_snapshots where id = p_snapshot and org_id = current_org_id() for update;
  if v_s.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_s.status <> 'DRAFT' then raise exception 'only draft snapshots can be adjusted' using errcode='P0001'; end if;
  if v_s.employee_id = v_me then raise exception 'cannot adjust your own score' using errcode='42501'; end if;
  if not (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(v_s.employee_id))) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_s.computed_score is null then raise exception 'cannot adjust a score with insufficient data' using errcode='P0001'; end if;
  insert into score_adjustments(org_id, snapshot_id, delta, reason, adjusted_by) values (v_s.org_id, v_s.id, p_delta, p_reason, v_me);
  select coalesce(sum(delta),0) into v_total from score_adjustments where snapshot_id = v_s.id;
  update performance_snapshots set adjustment = v_total,
    final_score = greatest(0, least(100, computed_score + v_total)) where id = v_s.id returning * into v_s;
  perform _audit(v_s.org_id, 'performance.adjusted', 'performance_snapshot', v_s.id::text,
    jsonb_build_object('delta', p_delta, 'reason', p_reason));
  return v_s;
end $$;

create or replace function approve_snapshot(p_snapshot uuid)
returns performance_snapshots language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s performance_snapshots; v_me uuid := current_employee_id();
begin
  select * into v_s from performance_snapshots where id = p_snapshot and org_id = current_org_id() for update;
  if v_s.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_s.status <> 'DRAFT' then raise exception 'already finalised' using errcode='P0001'; end if;
  if v_s.employee_id = v_me then raise exception 'cannot approve your own performance' using errcode='42501'; end if;
  if not (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(v_s.employee_id))) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  update performance_snapshots set status='APPROVED', approved_by=v_me, approved_at=now() where id=v_s.id returning * into v_s;
  perform _audit(v_s.org_id, 'performance.approved', 'performance_snapshot', v_s.id::text,
    jsonb_build_object('final_score', v_s.final_score));
  return v_s;
end $$;

-- ---------------------------------------------------------------------------
-- Compensation
-- ---------------------------------------------------------------------------
create type pay_type as enum ('FIXED','FIXED_PLUS_VARIABLE','INCENTIVE_ONLY');

create table incentive_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  department_id uuid references departments(id) on delete cascade,
  -- [{ "min": 90, "pct": 100 }, { "min": 80, "pct": 75 }, ...]  score >= min → pct of target
  slabs jsonb not null check (jsonb_typeof(slabs) = 'array' and jsonb_array_length(slabs) between 1 and 20),
  cap_amount numeric(12,2) check (cap_amount >= 0),
  prorate boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table salary_structures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  pay_type pay_type not null default 'FIXED',
  base_monthly numeric(12,2) not null default 0 check (base_monthly >= 0),
  allowances jsonb not null default '[]',     -- [{ "name": "Travel", "amount": 2000 }]
  deductions jsonb not null default '[]',     -- approved recurring deductions
  target_incentive numeric(12,2) not null default 0 check (target_incentive >= 0),
  incentive_policy_id uuid references incentive_policies(id),
  attendance_incentive numeric(12,2) not null default 0 check (attendance_incentive >= 0),
  notes text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (pay_type <> 'INCENTIVE_ONLY' or base_monthly = 0)
);
alter table salary_structures add constraint salary_no_overlap exclude using gist (
  employee_id with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
);

create type payroll_status as enum ('DRAFT','REVIEW','APPROVED','PROCESSED','PAID','REJECTED','CANCELLED');

create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status payroll_status not null default 'DRAFT',
  created_by uuid not null references employees(id),
  submitted_by uuid references employees(id),
  submitted_at timestamptz,
  approved_by uuid references employees(id),
  approved_at timestamptz,
  processed_at timestamptz,
  paid_at timestamptz,
  rejection_note text,
  notes text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index payroll_one_live_run on payroll_runs(org_id, period_start, period_end)
  where status not in ('CANCELLED','REJECTED');

create table payroll_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  structure_id uuid not null references salary_structures(id),
  snapshot_id uuid references performance_snapshots(id),
  period_days int not null,
  employed_days int not null,
  lop_days numeric(5,1) not null default 0,
  payable_days numeric(5,1) not null,
  base_amount numeric(12,2) not null,
  allowances_amount numeric(12,2) not null,
  incentive_amount numeric(12,2) not null,
  attendance_incentive_amount numeric(12,2) not null,
  bonus_amount numeric(12,2) not null default 0,
  reimbursement_amount numeric(12,2) not null default 0,
  deductions_amount numeric(12,2) not null,
  gross_amount numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  breakdown jsonb not null,           -- every line + the reason it applied or didn't
  payment_status text not null default 'UNPAID' check (payment_status in ('UNPAID','PAID','FAILED')),
  payment_reference text,
  payment_method text,
  paid_on date,
  payment_confirmed_by uuid references employees(id),
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index payroll_entries_emp_idx on payroll_entries(employee_id);

-- Entries are frozen once the run leaves DRAFT, except the payment fields via mark_entry_paid().
create or replace function payroll_entries_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status payroll_status;
begin
  select status into v_status from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if coalesce(current_setting('app.payroll_payment', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'payroll entries are locked once the run leaves DRAFT' using errcode='42501';
  end if;
  if tg_op <> 'DELETE' then
    new.payment_status := 'UNPAID'; new.payment_reference := null; new.paid_on := null; new.payment_confirmed_by := null;
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_entries_guard_trg before insert or update or delete on payroll_entries
  for each row execute function payroll_entries_guard();

create or replace function payroll_transition(p_run uuid, p_to payroll_status, p_note text default null)
returns payroll_runs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r payroll_runs; v_me uuid := current_employee_id(); v_count int;
begin
  select * into v_r from payroll_runs where id = p_run and org_id = current_org_id() for update;
  if v_r.id is null then raise exception 'not found' using errcode='P0002'; end if;

  if p_to = 'REVIEW' then
    if v_r.status not in ('DRAFT') then raise exception 'only drafts can be submitted' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    select count(*) into v_count from payroll_entries where run_id = p_run;
    if v_count = 0 then raise exception 'run has no entries' using errcode='P0001'; end if;
    update payroll_runs set status='REVIEW', submitted_by=v_me, submitted_at=now() where id=p_run returning * into v_r;

  elsif p_to = 'DRAFT' then
    if v_r.status <> 'REVIEW' then raise exception 'only runs in review can return to draft' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    update payroll_runs set status='DRAFT', submitted_by=null, submitted_at=null where id=p_run returning * into v_r;

  elsif p_to in ('APPROVED','REJECTED') then
    if v_r.status <> 'REVIEW' then raise exception 'run must be in REVIEW' using errcode='P0001'; end if;
    if not has_perm('payroll.approve') then raise exception 'payroll.approve required' using errcode='42501'; end if;
    -- Segregation of duties: the preparer/submitter cannot approve, nor can anyone paid in this run.
    if v_me in (v_r.created_by, v_r.submitted_by) then
      raise exception 'the person who prepared or submitted a run cannot approve it' using errcode='42501';
    end if;
    if exists (select 1 from payroll_entries where run_id = p_run and employee_id = v_me) then
      raise exception 'you cannot approve a payroll run that includes your own salary' using errcode='42501';
    end if;
    if p_to = 'REJECTED' and coalesce(length(trim(p_note)),0) < 3 then
      raise exception 'rejection needs a note' using errcode='P0001';
    end if;
    update payroll_runs set status=p_to, approved_by=case when p_to='APPROVED' then v_me end,
      approved_at=case when p_to='APPROVED' then now() end, rejection_note=case when p_to='REJECTED' then p_note end
    where id=p_run returning * into v_r;

  elsif p_to = 'PROCESSED' then
    if v_r.status <> 'APPROVED' then raise exception 'run must be APPROVED' using errcode='P0001'; end if;
    if not has_perm('payroll.pay') and current_role_name() <> 'SUPER_ADMIN' then
      raise exception 'payroll.pay required' using errcode='42501'; end if;
    update payroll_runs set status='PROCESSED', processed_at=now() where id=p_run returning * into v_r;

  elsif p_to = 'CANCELLED' then
    if v_r.status in ('PROCESSED','PAID') then raise exception 'processed runs cannot be cancelled' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    update payroll_runs set status='CANCELLED', notes=coalesce(p_note, notes) where id=p_run returning * into v_r;

  elsif p_to = 'PAID' then
    raise exception 'runs become PAID automatically once every entry has a confirmed payment' using errcode='P0001';
  else
    raise exception 'unsupported transition' using errcode='P0001';
  end if;

  perform _audit(v_r.org_id, 'payroll.' || lower(p_to::text), 'payroll_run', v_r.id::text,
    jsonb_build_object('period', v_r.period_start || '..' || v_r.period_end, 'note', p_note));
  return v_r;
end $$;

-- Never "paid" without a payment reference recorded by an authorised person.
create or replace function mark_entry_paid(p_entry uuid, p_reference text, p_method text, p_paid_on date)
returns payroll_entries language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e payroll_entries; v_r payroll_runs; v_me uuid := current_employee_id();
begin
  if coalesce(length(trim(p_reference)),0) < 4 then raise exception 'a payment reference (UTR / txn id) is required' using errcode='P0001'; end if;
  if p_method not in ('BANK_TRANSFER','UPI','CHEQUE','CASH') then raise exception 'invalid payment method' using errcode='P0001'; end if;
  select * into v_e from payroll_entries where id = p_entry and org_id = current_org_id() for update;
  if v_e.id is null then raise exception 'not found' using errcode='P0002'; end if;
  select * into v_r from payroll_runs where id = v_e.run_id for update;
  if v_r.status <> 'PROCESSED' then raise exception 'run must be PROCESSED before recording payments' using errcode='P0001'; end if;
  if not has_perm('payroll.pay') and current_role_name() <> 'SUPER_ADMIN' then raise exception 'payroll.pay required' using errcode='42501'; end if;
  if v_e.employee_id = v_me then raise exception 'cannot confirm your own salary payment' using errcode='42501'; end if;
  if v_e.payment_status = 'PAID' then raise exception 'already paid' using errcode='P0001'; end if;
  perform set_config('app.payroll_payment', 'on', true);
  update payroll_entries set payment_status='PAID', payment_reference=trim(p_reference), payment_method=p_method,
    paid_on=p_paid_on, payment_confirmed_by=v_me where id=p_entry returning * into v_e;
  perform set_config('app.payroll_payment', 'off', true);
  if not exists (select 1 from payroll_entries where run_id = v_r.id and payment_status <> 'PAID') then
    update payroll_runs set status='PAID', paid_at=now() where id=v_r.id;
  end if;
  perform _audit(v_e.org_id, 'payroll.entry_paid', 'payroll_entry', v_e.id::text,
    jsonb_build_object('run_id', v_r.id, 'method', p_method));
  return v_e;
end $$;

-- Sensitive-read log (called by the app whenever salary data is rendered/exported).
create or replace function log_salary_access(p_entity text, p_entity_id text, p_subject uuid, p_purpose text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform log_audit('salary.viewed', p_entity, p_entity_id, jsonb_build_object('subject', p_subject, 'purpose', p_purpose));
end $$;

create or replace function salary_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(coalesce(new.org_id, old.org_id), 'salary_structure.' || lower(tg_op), 'salary_structure',
    coalesce(new.id, old.id)::text, jsonb_build_object('employee_id', coalesce(new.employee_id, old.employee_id)));
  return coalesce(new, old);
end $$;
create trigger salary_audit_trg after insert or update or delete on salary_structures
  for each row execute function salary_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table performance_policies enable row level security;
alter table performance_snapshots enable row level security;
alter table score_adjustments enable row level security;
alter table manager_reviews enable row level security;
alter table manager_review_notes enable row level security;
alter table performance_review_requests enable row level security;
alter table incentive_policies enable row level security;
alter table salary_structures enable row level security;
alter table payroll_runs enable row level security;
alter table payroll_entries enable row level security;

create policy pp_read on performance_policies for select to authenticated using (org_id = current_org_id());
create policy pp_write on performance_policies for all to authenticated
  using (org_id = current_org_id() and has_perm('performance.configure'))
  with check (org_id = current_org_id() and has_perm('performance.configure'));

create policy ps_read on performance_snapshots for select to authenticated
  using (org_id = current_org_id() and can_view_performance(employee_id));
create policy ps_insert on performance_snapshots for insert to authenticated
  with check (org_id = current_org_id() and status = 'DRAFT' and employee_id <> current_employee_id()
              and (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(employee_id))));
create policy ps_supersede on performance_snapshots for update to authenticated
  using (org_id = current_org_id() and status = 'DRAFT' and employee_id <> current_employee_id()
         and (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(employee_id))))
  with check (status = 'SUPERSEDED');

create policy sa_read on score_adjustments for select to authenticated
  using (exists (select 1 from performance_snapshots s where s.id = snapshot_id and s.org_id = current_org_id()
                 and can_view_performance(s.employee_id)));

create policy mr_read on manager_reviews for select to authenticated
  using (org_id = current_org_id() and can_view_performance(employee_id));
create policy mr_write on manager_reviews for insert to authenticated
  with check (org_id = current_org_id() and reviewer_id = current_employee_id() and employee_id <> current_employee_id()
              and has_perm('performance.review') and (is_in_my_team(employee_id) or has_perm('performance.view_all')));

-- Employees can NEVER read confidential notes — not even about themselves.
create policy mrn_read on manager_review_notes for select to authenticated
  using (org_id = current_org_id() and exists (
    select 1 from manager_reviews r where r.id = review_id and r.employee_id <> current_employee_id()
      and (r.reviewer_id = current_employee_id() or has_perm('performance.view_all'))));
create policy mrn_write on manager_review_notes for insert to authenticated
  with check (org_id = current_org_id() and exists (
    select 1 from manager_reviews r where r.id = review_id and r.reviewer_id = current_employee_id()));

create policy prr_read on performance_review_requests for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id()
         or has_perm('performance.view_all') or (has_perm('performance.review') and is_in_my_team(employee_id))));
create policy prr_insert on performance_review_requests for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id() and status = 'PENDING'
              and exists (select 1 from performance_snapshots s where s.id = snapshot_id and s.employee_id = current_employee_id()));
create policy prr_respond on performance_review_requests for update to authenticated
  using (org_id = current_org_id() and employee_id <> current_employee_id()
         and (has_perm('performance.view_all') or (has_perm('performance.review') and is_in_my_team(employee_id))))
  with check (org_id = current_org_id());

create policy ip_read on incentive_policies for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('salary.manage')));
create policy ip_write on incentive_policies for all to authenticated
  using (org_id = current_org_id() and has_perm('salary.manage'))
  with check (org_id = current_org_id() and has_perm('salary.manage'));

-- Salary: self or payroll roles. Managers deliberately excluded.
create policy ss_read on salary_structures for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('payroll.view_all')));
create policy ss_write on salary_structures for insert to authenticated
  with check (org_id = current_org_id() and has_perm('salary.manage') and employee_id <> current_employee_id());
create policy ss_update on salary_structures for update to authenticated
  using (org_id = current_org_id() and has_perm('salary.manage') and employee_id <> current_employee_id())
  with check (org_id = current_org_id() and employee_id <> current_employee_id());

create policy pr_read on payroll_runs for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('payroll.approve')));
create policy pr_insert on payroll_runs for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and status = 'DRAFT' and created_by = current_employee_id());

-- Narrow definer helper: employees can't read payroll_runs, but may learn whether their own run is released.
create or replace function payroll_run_released(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payroll_runs r where r.id = p_run and r.org_id = current_org_id()
                 and r.status in ('APPROVED','PROCESSED','PAID'))
$$;

create policy pe_read on payroll_entries for select to authenticated
  using (org_id = current_org_id() and (
    (employee_id = current_employee_id() and payroll_run_released(run_id))
    or has_perm('payroll.view_all') or has_perm('payroll.approve')));
create policy pe_write on payroll_entries for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id()
              and exists (select 1 from payroll_runs r where r.id = run_id and r.org_id = current_org_id() and r.status = 'DRAFT'));
create policy pe_delete on payroll_entries for delete to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage')
         and exists (select 1 from payroll_runs r where r.id = run_id and r.status = 'DRAFT'));

-- SUPER_ADMIN gets payroll.approve + payroll.pay implicitly via has_perm(). Give HR the explicit grants
-- by configuration in /settings/roles if your policy wants HR to approve (default: Super Admin approves).

-- >>> 0004_crm_notifications.sql
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

-- >>> 0005_payroll_adjustments.sql
-- =============================================================================
-- 0005 One-off payroll adjustments (bonus / reimbursement / deduction) per run.
-- =============================================================================
create table payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('BONUS','REIMBURSEMENT','DEDUCTION')),
  label text not null check (length(label) between 2 and 120),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (length(reason) >= 5),
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);
create index payroll_adj_run_idx on payroll_adjustments(run_id, employee_id);

create or replace function payroll_adjustments_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select status from payroll_runs where id = coalesce(new.run_id, old.run_id)) <> 'DRAFT' then
    raise exception 'adjustments are locked once the run leaves DRAFT' using errcode='42501';
  end if;
  if tg_op <> 'DELETE' then
    perform _audit(new.org_id, 'payroll.adjustment_added', 'payroll_run', new.run_id::text,
      jsonb_build_object('employee_id', new.employee_id, 'kind', new.kind, 'reason', new.reason));
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_adjustments_guard_trg before insert or update or delete on payroll_adjustments
  for each row execute function payroll_adjustments_guard();

alter table payroll_adjustments enable row level security;
create policy padj_read on payroll_adjustments for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('payroll.approve')
         or (employee_id = current_employee_id() and payroll_run_released(run_id))));
create policy padj_write on payroll_adjustments for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id()
              and created_by = current_employee_id());
create policy padj_delete on payroll_adjustments for delete to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id());

-- >>> 0006_access_hierarchy.sql
-- =============================================================================
-- 0006 Access hierarchy
--   • Role levels (who outranks whom), editable labels/descriptions per org.
--   • No escalation: you can only manage roles BELOW your level, and only grant
--     permissions you hold yourself. Sensitive permissions are Super-Admin-only.
--   • Per-employee overrides (GRANT / DENY, optional expiry) — Super Admin only.
--   • has_perm() = Super Admin → DENY override → GRANT override → role permission.
--   • The last active Super Admin can never be demoted or exited.
-- =============================================================================

create table role_settings (
  org_id uuid not null references organizations(id) on delete cascade,
  role app_role not null,
  level int not null check (level between 1 and 100),
  label text not null,
  description text,
  primary key (org_id, role),
  check ((role = 'SUPER_ADMIN') = (level = 100))      -- only Super Admin sits at 100
);

create or replace function default_role_level(r app_role) returns int language sql immutable as $$
  select case r
    when 'SUPER_ADMIN' then 100 when 'ADMIN' then 90 when 'HR_MANAGER' then 80
    when 'OPERATIONS_MANAGER' then 75 when 'DEPARTMENT_MANAGER' then 70 when 'PROJECT_MANAGER' then 60
    when 'TEAM_LEAD' then 55 when 'SALES_EXECUTIVE' then 40 when 'EMPLOYEE' then 20 when 'INTERN' then 10 end
$$;

create or replace function seed_role_settings(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_settings(org_id, role, level, label, description)
  select p_org, r, default_role_level(r), initcap(replace(r::text, '_', ' ')),
    case r
      when 'SUPER_ADMIN' then 'Founders. Full access to everything; cannot be restricted.'
      when 'ADMIN' then 'Runs the platform day to day. Cannot touch payroll unless granted.'
      when 'HR_MANAGER' then 'People, attendance, leave, performance and payroll preparation.'
      when 'OPERATIONS_MANAGER' then 'Delivery across all teams: projects, tasks, attendance.'
      when 'DEPARTMENT_MANAGER' then 'Heads a department; sees and approves for that department.'
      when 'PROJECT_MANAGER' then 'Runs projects and reviews task quality.'
      when 'TEAM_LEAD' then 'Leads a small team; approves and reviews for direct reports.'
      when 'SALES_EXECUTIVE' then 'Works CRM leads and clients.'
      when 'EMPLOYEE' then 'Own attendance, tasks, performance and salary only.'
      when 'INTERN' then 'Same as employee; usually time-bound.'
    end
  from unnest(enum_range(null::app_role)) r
  on conflict do nothing;
$$;
revoke all on function seed_role_settings(uuid) from public, anon, authenticated;

select seed_role_settings(id) from organizations;

create or replace function organizations_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform seed_role_settings(new.id); return new; end $$;
create trigger organizations_seed_roles after insert on organizations for each row execute function organizations_after_insert();

-- ---------------------------------------------------------------------------
-- Per-employee overrides
-- ---------------------------------------------------------------------------
create table employee_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  permission text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  effect text not null check (effect in ('GRANT','DENY')),
  reason text not null check (length(reason) >= 5),
  expires_at timestamptz,
  granted_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  unique (employee_id, permission)
);
create index epo_employee_idx on employee_permission_overrides(employee_id);

-- ---------------------------------------------------------------------------
-- Hierarchy helpers
-- ---------------------------------------------------------------------------
create or replace function role_level(r app_role) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select level from role_settings where org_id = current_org_id() and role = r), default_role_level(r))
$$;

create or replace function my_level() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when current_role_name() is null then 0 else role_level(current_role_name()) end
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(current_role_name() = 'SUPER_ADMIN', false)
$$;

-- Only Super Admin may grant these to a role or a person.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
  select p like 'payroll.%' or p like 'salary.%' or p in ('roles.manage','audit.view','settings.manage')
$$;

-- Can the caller manage (assign / configure) this role at all?
create or replace function can_manage_role(r app_role) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_super_admin() or (r <> 'SUPER_ADMIN' and my_level() > role_level(r))
$$;

-- Effective permission check. Signature unchanged — every existing policy picks this up.
create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.role = 'SUPER_ADMIN' then true
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'DENY' and (o.expires_at is null or o.expires_at > now())) then false
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'GRANT' and (o.expires_at is null or o.expires_at > now())) then true
      else exists (select 1 from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p)
    end
    from employees e where e.user_id = auth.uid() and e.status <> 'EXITED' limit 1), false)
$$;

-- Effective permission list for one employee, with where each one comes from.
create or replace function effective_permissions(p_employee uuid)
returns table(permission text, via text) language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_e employees;
begin
  select * into v_e from employees where id = p_employee and org_id = current_org_id();
  if v_e.id is null then return; end if;
  if p_employee <> current_employee_id() and not has_perm('roles.manage') then
    raise exception 'roles.manage required' using errcode = '42501';
  end if;
  if v_e.role = 'SUPER_ADMIN' then return query select '*'::text, 'Super Admin'::text; return; end if;
  return query
    with role_p as (select rp.permission from role_permissions rp where rp.org_id = v_e.org_id and rp.role = v_e.role),
    ov as (select o.permission, o.effect from employee_permission_overrides o
           where o.employee_id = v_e.id and (o.expires_at is null or o.expires_at > now()))
    select x.permission, x.via from (
      select r.permission, 'role'::text as via from role_p r where r.permission not in (select permission from ov where effect = 'DENY')
      union
      select o.permission, 'override'::text from ov o where o.effect = 'GRANT'
    ) x order by 1;
end $$;

-- Who holds a permission right now (role, override or Super Admin).
create or replace function permission_holders(p text)
returns table(employee_id uuid, full_name text, role app_role, via text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not has_perm('roles.manage') then raise exception 'roles.manage required' using errcode = '42501'; end if;
  return query
    select e.id, e.full_name, e.role,
      case when e.role = 'SUPER_ADMIN' then 'Super Admin'
           when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p and o.effect = 'GRANT'
                        and (o.expires_at is null or o.expires_at > now())) then 'override'
           else 'role' end
    from employees e
    where e.org_id = current_org_id() and e.status <> 'EXITED' and (
      e.role = 'SUPER_ADMIN'
      or (not exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p and o.effect = 'DENY'
                      and (o.expires_at is null or o.expires_at > now()))
          and (exists (select 1 from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p)
               or exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p and o.effect = 'GRANT'
                          and (o.expires_at is null or o.expires_at > now())))))
    order by default_role_level(e.role) desc, e.full_name;
end $$;

-- App shell context now returns EFFECTIVE permissions and the caller's level.
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'employee_id', e.id, 'org_id', e.org_id, 'org_name', o.name, 'timezone', o.timezone,
    'full_name', e.full_name, 'email', e.official_email, 'designation', e.designation,
    'role', e.role, 'role_level', role_level(e.role), 'photo_url', e.photo_url,
    'permissions', case when e.role = 'SUPER_ADMIN' then to_jsonb(array['*'])
      else coalesce((select jsonb_agg(ep.permission order by ep.permission) from effective_permissions(e.id) ep), '[]'::jsonb) end
  )
  from employees e join organizations o on o.id = e.org_id
  where e.user_id = auth.uid() and e.status <> 'EXITED'
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Hierarchy enforcement on employees (replaces the Block 1 guard)
-- ---------------------------------------------------------------------------
create or replace function employees_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_sa boolean := is_super_admin();
begin
  if auth.uid() is null then return new; end if;   -- service role / migrations
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'org_id is immutable' using errcode='42501'; end if;
    if new.user_id is distinct from old.user_id and not v_sa and my_level() < 90 then
      raise exception 'only administrators can relink accounts' using errcode='42501';
    end if;
    if new.role <> old.role and old.id = v_me then
      raise exception 'you cannot change your own role' using errcode='42501';
    end if;
    -- Nobody edits a colleague at or above their own level (Super Admin excepted).
    if old.id <> v_me and not v_sa and role_level(old.role) >= my_level() then
      raise exception 'you can only manage people below your level' using errcode='42501';
    end if;
    if new.role <> old.role and not has_perm('roles.manage') and not has_perm('people.manage') then
      raise exception 'people.manage required to change roles' using errcode='42501';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.role <> old.role) and not can_manage_role(new.role) then
    raise exception 'you can only assign roles below your own level' using errcode='42501';
  end if;
  return new;
end $$;

-- Never lose the last Super Admin.
create or replace function protect_last_super_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'SUPER_ADMIN' and old.status <> 'EXITED'
     and (tg_op = 'DELETE' or new.role <> 'SUPER_ADMIN' or new.status = 'EXITED')
     and not exists (select 1 from employees e where e.org_id = old.org_id and e.id <> old.id
                     and e.role = 'SUPER_ADMIN' and e.status <> 'EXITED') then
    raise exception 'cannot remove the last active Super Admin' using errcode='42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger employees_last_sa before update or delete on employees for each row execute function protect_last_super_admin();

-- ---------------------------------------------------------------------------
-- Role-permission matrix: hierarchy + no-escalation
-- ---------------------------------------------------------------------------
drop policy role_permissions_write on role_permissions;
create policy role_permissions_insert on role_permissions for insert to authenticated
  with check (org_id = current_org_id() and role <> 'SUPER_ADMIN' and (
    is_super_admin()
    or (has_perm('roles.manage') and can_manage_role(role) and has_perm(permission) and not is_sensitive_permission(permission))));
create policy role_permissions_delete on role_permissions for delete to authenticated
  using (org_id = current_org_id() and role <> 'SUPER_ADMIN' and (
    is_super_admin()
    or (has_perm('roles.manage') and can_manage_role(role) and not is_sensitive_permission(permission))));

-- Role settings: everyone reads (labels in the UI); only Super Admin edits.
alter table role_settings enable row level security;
create policy rs_read on role_settings for select to authenticated using (org_id = current_org_id());
create policy rs_write on role_settings for update to authenticated
  using (org_id = current_org_id() and is_super_admin())
  with check (org_id = current_org_id() and is_super_admin());

-- Overrides: Super Admin writes; roles.manage reads; employees read their own.
alter table employee_permission_overrides enable row level security;
create policy epo_read on employee_permission_overrides for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('roles.manage')));
create policy epo_write on employee_permission_overrides for all to authenticated
  using (org_id = current_org_id() and is_super_admin() and employee_id <> current_employee_id())
  with check (org_id = current_org_id() and is_super_admin() and employee_id <> current_employee_id()
              and granted_by = current_employee_id()
              and not exists (select 1 from employees t where t.id = employee_id and t.role = 'SUPER_ADMIN'));

create or replace function overrides_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(coalesce(new.org_id, old.org_id), 'permission.override.' || lower(tg_op), 'employee',
    coalesce(new.employee_id, old.employee_id)::text,
    jsonb_build_object('permission', coalesce(new.permission, old.permission), 'effect', coalesce(new.effect, old.effect),
                       'reason', coalesce(new.reason, old.reason), 'expires_at', coalesce(new.expires_at, old.expires_at)));
  return coalesce(new, old);
end $$;
create trigger overrides_audit_trg after insert or update or delete on employee_permission_overrides
  for each row execute function overrides_audit();

create or replace function role_settings_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(new.org_id, 'role.settings_updated', 'role', new.role::text,
    jsonb_build_object('level', jsonb_build_array(old.level, new.level), 'label', jsonb_build_array(old.label, new.label)));
  return new;
end $$;
create trigger role_settings_audit_trg after update on role_settings for each row execute function role_settings_audit();

-- >>> 0007_notification_prefs_integrations.sql
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
