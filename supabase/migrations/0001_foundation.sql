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
