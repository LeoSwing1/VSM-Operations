-- =============================================================================
-- VSM Growth Operations — 0024 Block 18
--   1. Exactly one Super Admin per organisation, protected from removal by anyone using the API
--   2. Automatic employee IDs (VSM-0001, VSM-0002 …)
--   3. Company posts (designations) with department, default role, team and responsibilities
--   4. SEO / Editing / Developers teams, each with a linked chat group kept in sync
--   5. Demo-employee flag, password-reset permission and audit
--   6. Chat inbox: unread summary, mark-read clears chat notifications; category fix
--   7. Live sync: more tables in the realtime publication
-- Idempotent: safe to run more than once.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
-- "Owner session" = SQL Editor / psql as postgres with no end-user JWT. The app (authenticator →
-- authenticated / service_role) can never pass this check, even through SECURITY DEFINER functions,
-- because session_user stays 'authenticator'.
create or replace function is_owner_session() returns boolean language sql stable as $$
  select auth.uid() is null and session_user in ('postgres', 'supabase_admin')
     and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres', 'supabase_admin')
$$;
revoke all on function is_owner_session() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from employees where role = 'SUPER_ADMIN' and status <> 'EXITED' group by org_id having count(*) > 1) then
    raise notice 'More than one active Super Admin exists in an organisation; one_super_admin index NOT created. Demote extras in the SQL Editor and re-run.';
  elsif not exists (select 1 from pg_indexes where indexname = 'one_super_admin_per_org') then
    create unique index one_super_admin_per_org on employees(org_id) where role = 'SUPER_ADMIN' and status <> 'EXITED';
  end if;
end $$;

create or replace function protect_super_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_owner_session() then return coalesce(new, old); end if;   -- break-glass from the SQL Editor only
  if tg_op = 'INSERT' then
    if new.role = 'SUPER_ADMIN' and exists (select 1 from employees where org_id = new.org_id and role = 'SUPER_ADMIN' and status <> 'EXITED') then
      raise exception 'This organisation already has its Super Admin. There can only be one.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'SUPER_ADMIN' then raise exception 'The Super Admin cannot be deleted.' using errcode = '42501'; end if;
    return old;
  end if;
  -- UPDATE
  if new.role = 'SUPER_ADMIN' and old.role <> 'SUPER_ADMIN' then
    raise exception 'Super Admin cannot be granted from the app. There is only one.' using errcode = '42501';
  end if;
  if old.role = 'SUPER_ADMIN' then
    if new.role <> 'SUPER_ADMIN' then raise exception 'The Super Admin role cannot be removed or changed.' using errcode = '42501'; end if;
    if new.status <> old.status and new.status in ('EXITED', 'NOTICE') then
      raise exception 'The Super Admin cannot be deactivated.' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id then raise exception 'The Super Admin login cannot be relinked.' using errcode = '42501'; end if;
    if new.official_email <> old.official_email and current_employee_id() is distinct from old.id then
      raise exception 'Only the Super Admin can change their own email.' using errcode = '42501';
    end if;
    if new.manager_id is not null then new.manager_id := null; end if;    -- nobody "manages" the Super Admin
  end if;
  return new;
end $$;
drop trigger if exists employees_protect_sa on employees;
create trigger employees_protect_sa before insert or update or delete on employees for each row execute function protect_super_admin();

-- Super Admin overrides can never be used to restrict them either.
create or replace function block_sa_overrides() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from employees where id = new.employee_id and role = 'SUPER_ADMIN') and not is_owner_session() then
    raise exception 'Super Admin permissions cannot be overridden.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists overrides_block_sa on employee_permission_overrides;
create trigger overrides_block_sa before insert or update on employee_permission_overrides for each row execute function block_sa_overrides();

-- The Super Admin's login cannot be deleted through the Auth API either.
create or replace function protect_super_admin_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.employees where user_id = old.id and role = 'SUPER_ADMIN') and not public.is_owner_session() then
    raise exception 'The Super Admin login cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end $$;
do $$
begin
  execute 'drop trigger if exists protect_sa_auth_user on auth.users';
  execute 'create trigger protect_sa_auth_user before delete on auth.users for each row execute function public.protect_super_admin_auth_user()';
exception when insufficient_privilege then
  raise notice 'Could not add the auth.users guard (insufficient privilege); employees-level protection is still active.';
end $$;

-- 2 ---------------------------------------------------------------------------
create or replace function next_employee_code(p_org uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select 'VSM-' || lpad((coalesce(max(nullif(regexp_replace(employee_code, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
  from employees where org_id = p_org and employee_code ~ '^VSM-\d+$'
$$;
grant execute on function next_employee_code(uuid) to authenticated;

create or replace function assign_employee_code() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    perform pg_advisory_xact_lock(hashtext('employee_code:' || new.org_id::text));
    new.employee_code := next_employee_code(new.org_id);
  else
    new.employee_code := upper(btrim(new.employee_code));
  end if;
  return new;
end $$;
drop trigger if exists employees_assign_code on employees;
create trigger employees_assign_code before insert on employees for each row execute function assign_employee_code();

-- 3 ---------------------------------------------------------------------------
alter table employees add column if not exists is_demo boolean not null default false;
alter table org_teams add column if not exists chat_channel_id uuid references chat_channels(id) on delete set null;
alter table org_teams add column if not exists team_key text;
create unique index if not exists org_teams_key_idx on org_teams(org_id, team_key) where team_key is not null;

create table if not exists designations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(title) between 2 and 80),
  department_id uuid references departments(id) on delete set null,
  default_role app_role not null default 'EMPLOYEE',
  team_key text,
  team_role text not null default 'MEMBER' check (team_role in ('LEAD','MANAGER','MEMBER')),
  reports_to text,
  responsibilities text[] not null default '{}',
  kpis text[] not null default '{}',
  sort int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, title)
);
alter table designations enable row level security;
drop policy if exists designations_read on designations;
create policy designations_read on designations for select to authenticated using (org_id = current_org_id());
drop policy if exists designations_manage on designations;
create policy designations_manage on designations for all to authenticated
  using (org_id = current_org_id() and has_perm('people.manage'))
  with check (org_id = current_org_id() and has_perm('people.manage') and default_role <> 'SUPER_ADMIN');

-- Company structure for VSM Growth / VSM Scholars. Safe to call again — it only adds what is missing.
create or replace function seed_vsm_structure(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; t record; v_team uuid; v_chan uuid;
begin
  select id into v_owner from employees where org_id = p_org and role = 'SUPER_ADMIN' and status <> 'EXITED' limit 1;

  insert into role_permissions(org_id, role, permission)
  select p_org, r::app_role, 'people.reset_password' from unnest(array['ADMIN','HR_MANAGER']) r on conflict do nothing;

  insert into departments(org_id, name)
  select p_org, d from unnest(array['Management','Human Resources','SEO','Content & Editing','Development','Sales','Accounts','Training (VSM Scholars)']) d
  on conflict (org_id, name) do nothing;

  insert into designations(org_id, title, department_id, default_role, team_key, team_role, reports_to, responsibilities, kpis, sort)
  select p_org, x.title, (select id from departments where org_id = p_org and name = x.dept), x.role::app_role, x.team, x.trole, x.reports,
         x.resp, x.kpis, x.sort
  from (values
    ('Founder & CEO','Management','SUPER_ADMIN',null,'MEMBER',null,
      array['Company direction, clients and final approvals'], array['Revenue','Client retention'], 1),
    ('Co-Founder','Management','ADMIN',null,'MEMBER','Founder & CEO',
      array['Operations, delivery and growth'], array['Delivery on time','Team utilisation'], 2),
    ('HR Manager','Human Resources','HR_MANAGER',null,'MEMBER','Co-Founder',
      array['Hiring and onboarding','Attendance, leave and payroll inputs','Policies, letters and exits'],
      array['Time to hire','Attendance compliance','Payroll on time'], 10),
    ('Operations Manager','Management','OPERATIONS_MANAGER',null,'MEMBER','Co-Founder',
      array['Daily operations','Approvals and SLAs','Client delivery tracking'], array['SLA breaches','Overdue tasks'], 11),
    ('SEO Manager','SEO','DEPARTMENT_MANAGER','seo','LEAD','Co-Founder',
      array['SEO strategy per client','Assign and review SEO tasks','Monthly client SEO reports'],
      array['Keyword rankings','Organic traffic growth','Report on time'], 20),
    ('SEO Executive','SEO','EMPLOYEE','seo','MEMBER','SEO Manager',
      array['Keyword research and on-page SEO','Technical audits and fixes','Off-page / backlinks and Google Business Profile','Daily update with work done'],
      array['Tasks closed on time','Pages optimised','Backlinks built','Ranking movement'], 21),
    ('Content Writer','Content & Editing','EMPLOYEE','editing','MEMBER','Editing Lead',
      array['Blogs, captions and website copy (Hinglish/English)'], array['Pieces delivered','Revisions per piece'], 30),
    ('Editing Lead','Content & Editing','TEAM_LEAD','editing','LEAD','Co-Founder',
      array['Reel and video pipeline','Quality checks before client delivery'], array['On-time delivery','First-pass approval rate'], 31),
    ('Video Editor','Content & Editing','EMPLOYEE','editing','MEMBER','Editing Lead',
      array['Reels and YouTube edits','Motion graphics and captions','Upload-ready exports'], array['Videos delivered','Revisions per video'], 32),
    ('Graphic Designer','Content & Editing','EMPLOYEE','editing','MEMBER','Editing Lead',
      array['Posts, carousels and brand creatives'], array['Creatives delivered','Revisions per creative'], 33),
    ('Tech Lead','Development','TEAM_LEAD','developers','LEAD','Co-Founder',
      array['Architecture and code reviews','Deployments and hosting'], array['Release on time','Production incidents'], 40),
    ('Web Developer','Development','EMPLOYEE','developers','MEMBER','Tech Lead',
      array['Client websites (WordPress / Next.js)','Speed, SEO-ready markup and bug fixes'], array['Tickets closed','Page speed score'], 41),
    ('Social Media Manager','Content & Editing','EMPLOYEE','editing','MEMBER','Editing Lead',
      array['Content calendars, posting and community'], array['Posts on schedule','Engagement rate'], 50),
    ('Sales Executive','Sales','SALES_EXECUTIVE',null,'MEMBER','Co-Founder',
      array['Lead follow-up in CRM','Proposals and closures'], array['Leads contacted','Conversions'], 60),
    ('Course Counsellor','Training (VSM Scholars)','EMPLOYEE',null,'MEMBER','Co-Founder',
      array['Student enquiries and admissions'], array['Admissions','Follow-up time'], 70),
    ('Trainer','Training (VSM Scholars)','EMPLOYEE',null,'MEMBER','Co-Founder',
      array['Batches for Digital Marketing, Graphic Design, Video Editing'], array['Batch completion','Student feedback'], 71),
    ('Accounts Executive','Accounts','EMPLOYEE',null,'MEMBER','Co-Founder',
      array['Invoices, expenses and reconciliation'], array['Receivables days','Reconciliation on time'], 80),
    ('Intern','Content & Editing','INTERN',null,'MEMBER','Editing Lead',
      array['Learning tasks assigned by the team lead'], array['Tasks completed'], 90)
  ) as x(title, dept, role, team, trole, reports, resp, kpis, sort)
  on conflict (org_id, title) do nothing;

  for t in select * from (values ('seo','SEO Team','SEO','SEO execution, audits and client reporting'),
                                 ('editing','Editing Team','Content & Editing','Reels, videos, design and content'),
                                 ('developers','Developers Team','Development','Websites, web apps and hosting')) as v(key, name, dept, descr) loop
    select id, chat_channel_id into v_team, v_chan from org_teams where org_id = p_org and (team_key = t.key or name = t.name) limit 1;
    if v_team is null then
      insert into org_teams(org_id, department_id, name, description, team_key, created_by)
      values (p_org, (select id from departments where org_id = p_org and name = t.dept), t.name, t.descr, t.key, v_owner)
      returning id into v_team;
    else
      update org_teams set team_key = coalesce(team_key, t.key) where id = v_team;
    end if;
    if v_chan is null and v_owner is not null then
      insert into chat_channels(org_id, name, description, channel_type, created_by)
      values (p_org, t.name, t.descr || ' · team group', 'GROUP', v_owner) returning id into v_chan;
      update org_teams set chat_channel_id = v_chan where id = v_team;
      insert into chat_channel_members(channel_id, employee_id, member_role) values (v_chan, v_owner, 'OWNER') on conflict do nothing;
      insert into chat_channel_members(channel_id, employee_id)
        select v_chan, m.employee_id from org_team_members m where m.team_id = v_team on conflict do nothing;
    end if;
  end loop;
end $$;
revoke all on function seed_vsm_structure(uuid) from public, anon, authenticated;

-- Team membership → chat group membership (join and leave automatically).
create or replace function sync_team_chat() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_chan uuid;
begin
  select chat_channel_id into v_chan from org_teams where id = coalesce(new.team_id, old.team_id);
  if v_chan is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into chat_channel_members(channel_id, employee_id, member_role)
    values (v_chan, new.employee_id, case when new.member_role = 'LEAD' then 'MODERATOR' else 'MEMBER' end) on conflict do nothing;
  elsif tg_op = 'DELETE' then
    delete from chat_channel_members where channel_id = v_chan and employee_id = old.employee_id and member_role <> 'OWNER';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists team_members_chat_sync on org_team_members;
create trigger team_members_chat_sync after insert or delete on org_team_members for each row execute function sync_team_chat();

-- Post → department + team, as per the company workflow (only fills what is empty / missing).
create or replace function apply_designation_dept() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_dept uuid;
begin
  if new.designation is not null and new.department_id is null then
    select department_id into v_dept from designations where org_id = new.org_id and lower(title) = lower(new.designation) and is_active;
    new.department_id := v_dept;
  end if;
  return new;
end $$;
drop trigger if exists employees_apply_designation_dept on employees;
create trigger employees_apply_designation_dept before insert or update of designation on employees
  for each row execute function apply_designation_dept();

create or replace function apply_designation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d designations; v_team uuid;
begin
  if new.designation is null or new.status = 'EXITED' then return new; end if;
  if tg_op = 'UPDATE' and new.designation is not distinct from old.designation then return new; end if;
  select * into d from designations where org_id = new.org_id and lower(title) = lower(new.designation) and is_active;
  if d.id is null or d.team_key is null then return new; end if;
  select id into v_team from org_teams where org_id = new.org_id and team_key = d.team_key and is_active;
  if v_team is null then return new; end if;
  insert into org_team_members(org_id, team_id, employee_id, member_role) values (new.org_id, v_team, new.id, d.team_role)
  on conflict (team_id, employee_id) do update set member_role = excluded.member_role;
  if d.team_role = 'LEAD' then update org_teams set lead_employee_id = new.id where id = v_team and lead_employee_id is null; end if;
  return new;
end $$;
drop trigger if exists employees_apply_designation on employees;
create trigger employees_apply_designation after insert or update of designation on employees for each row execute function apply_designation();

-- New organisations get the structure as soon as their Super Admin exists.
create or replace function seed_structure_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_vsm_structure(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_structure on employees;
create trigger employees_seed_structure after insert on employees for each row execute function seed_structure_on_sa();

do $$ declare o record; begin
  for o in select id from organizations loop perform seed_vsm_structure(o.id); end loop;
end $$;

-- 5 ---------------------------------------------------------------------------
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
 select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%'
   or p in ('roles.manage','audit.view','settings.manage','communication.moderate','communication.channel_manage',
            'teams.manage','time.approve_all','quality.manage','calendar.manage','people.reset_password')
$$;
insert into role_permissions(org_id, role, permission)
select o.id, r.role::app_role, 'people.reset_password' from organizations o cross join (values ('ADMIN'), ('HR_MANAGER')) r(role)
on conflict do nothing;

-- Who may reset whose password. Nobody resets the Super Admin (they use "Forgot password" themselves),
-- nobody resets someone at or above their own level, and you use the normal flow for yourself.
create or replace function can_reset_password(p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select t.role <> 'SUPER_ADMIN' and t.org_id = current_org_id() and t.id <> current_employee_id()
       and t.status <> 'EXITED' and has_perm('people.reset_password')
       and (current_role_name() = 'SUPER_ADMIN' or role_level(t.role) < my_level())
    from employees t where t.id = p_target), false)
$$;
grant execute on function can_reset_password(uuid) to authenticated;

-- 6 ---------------------------------------------------------------------------
create or replace function preference_category(p_category text) returns text language sql immutable as $$
  select case
    when upper(p_category) = any (notification_categories()) then upper(p_category)
    when upper(p_category) in ('WORKFLOW','SLA','FINANCE','EXPENSES') then 'APPROVALS'
    when upper(p_category) in ('COMMUNICATION','MESSAGES','CHAT_MESSAGE','CHAT_MENTION') or upper(p_category) like 'CHAT%' then 'CHAT'
    when upper(p_category) like 'ANNOUNCEMENT%' then 'ANNOUNCEMENTS'
    when upper(p_category) in ('CALENDAR') or upper(p_category) like 'MEETING%' then 'MEETINGS'
    else 'SYSTEM' end
$$;

create or replace function chat_unread_summary()
returns table(channel_id uuid, unread int, last_message_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.channel_id,
         (select count(*)::int from chat_messages x where x.channel_id = m.channel_id and x.deleted_at is null
            and x.author_id <> m.employee_id and x.created_at > coalesce(m.last_read_at, m.joined_at)),
         (select max(created_at) from chat_messages x where x.channel_id = m.channel_id and x.deleted_at is null)
  from chat_channel_members m join chat_channels c on c.id = m.channel_id and c.archived_at is null
  where m.employee_id = current_employee_id()
$$;
grant execute on function chat_unread_summary() to authenticated;

create or replace function mark_chat_read(p_channel uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); n int;
begin
  update chat_channel_members set last_read_at = now() where channel_id = p_channel and employee_id = v_me;
  if not found then raise exception 'not a member of this conversation' using errcode = '42501'; end if;
  update notifications set read_at = now()
   where recipient_id = v_me and read_at is null and category like 'CHAT%' and link = '/chat/' || p_channel::text;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function mark_chat_read(uuid) to authenticated;

-- 7 ---------------------------------------------------------------------------
do $$ declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['attendance_events','tasks','leave_requests','attendance_corrections','workflow_approval_cases','chat_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
