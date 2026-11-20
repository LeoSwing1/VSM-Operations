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
