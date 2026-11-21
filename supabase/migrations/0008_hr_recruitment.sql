-- =============================================================================
-- 0008 HR lifecycle + recruitment. All records are organization-scoped.
-- =============================================================================
create type candidate_stage as enum ('APPLIED','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN');
create type interview_result as enum ('PENDING','PASS','FAIL','ON_HOLD');

create table candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  role_applied text not null check (length(trim(role_applied)) between 2 and 120),
  department_id uuid references departments(id) on delete set null,
  source text not null default 'DIRECT' check (source in ('DIRECT','REFERRAL','JOB_BOARD','LINKEDIN','WEBSITE','OTHER')),
  stage candidate_stage not null default 'APPLIED',
  resume_path text,
  expected_salary_paise bigint check (expected_salary_paise is null or expected_salary_paise >= 0),
  notice_period_days int check (notice_period_days is null or notice_period_days between 0 and 365),
  owner_id uuid references employees(id) on delete set null,
  notes text,
  rejection_reason text,
  converted_employee_id uuid references employees(id) on delete set null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email, role_applied),
  check ((stage = 'HIRED') = (converted_employee_id is not null) or stage <> 'HIRED')
);
create index candidates_org_stage_idx on candidates(org_id, stage, created_at desc);
create index candidates_owner_idx on candidates(owner_id, stage);

create table candidate_interviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  interviewer_id uuid references employees(id) on delete set null,
  scheduled_at timestamptz not null,
  interview_type text not null default 'TECHNICAL' check (interview_type in ('SCREENING','TECHNICAL','CULTURE','FINAL','OTHER')),
  result interview_result not null default 'PENDING',
  score numeric(5,2) check (score is null or score between 0 and 100),
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidate_interviews_candidate_idx on candidate_interviews(candidate_id, scheduled_at desc);

create table employment_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  event_type text not null check (event_type in ('JOINED','PROBATION_STARTED','CONFIRMED','PROMOTED','TRANSFERRED','STATUS_CHANGED','RESIGNED','NOTICE_STARTED','EXIT_CLEARED','EXITED','NOTE')),
  effective_date date not null default current_date,
  details jsonb not null default '{}',
  note text,
  actor_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index employment_events_employee_idx on employment_events(employee_id, effective_date desc, id desc);

create table onboarding_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 160),
  category text not null default 'GENERAL' check (category in ('DOCUMENTS','IT_ACCESS','HR_ORIENTATION','TEAM_SETUP','GENERAL')),
  due_date date,
  completed_at timestamptz,
  completed_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index onboarding_employee_idx on onboarding_checklist_items(employee_id, completed_at);

-- Record initial join event for future employee inserts. Existing staff are backfilled once.
insert into employment_events(org_id, employee_id, event_type, effective_date, details)
select e.org_id, e.id, 'JOINED', e.joining_date, jsonb_build_object('source','migration_backfill')
from employees e where not exists (
  select 1 from employment_events ev where ev.employee_id=e.id and ev.event_type='JOINED'
);

create or replace function employee_lifecycle_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into employment_events(org_id, employee_id, event_type, effective_date, details, actor_id)
    values (new.org_id, new.id, 'JOINED', new.joining_date,
      jsonb_build_object('status',new.status,'employment_type',new.employment_type), current_employee_id());
    if new.status='PROBATION' then
      insert into employment_events(org_id, employee_id, event_type, effective_date, details, actor_id)
      values (new.org_id, new.id, 'PROBATION_STARTED', new.joining_date, '{}'::jsonb, current_employee_id());
    end if;
  elsif new.status is distinct from old.status then
    insert into employment_events(org_id, employee_id, event_type, effective_date, details, actor_id)
    values (new.org_id, new.id,
      case when old.status='PROBATION' and new.status='ACTIVE' then 'CONFIRMED' when new.status='PROBATION' then 'PROBATION_STARTED' when new.status='NOTICE' then 'NOTICE_STARTED' when new.status='EXITED' then 'EXITED' else 'STATUS_CHANGED' end,
      coalesce(new.exit_date, current_date), jsonb_build_object('from',old.status,'to',new.status), current_employee_id());
  elsif new.department_id is distinct from old.department_id or new.designation is distinct from old.designation then
    insert into employment_events(org_id, employee_id, event_type, effective_date, details, actor_id)
    values (new.org_id, new.id, case when new.department_id is distinct from old.department_id then 'TRANSFERRED' else 'PROMOTED' end,
      current_date, jsonb_build_object('department_from',old.department_id,'department_to',new.department_id,'designation_from',old.designation,'designation_to',new.designation), current_employee_id());
  end if;
  return new;
end $$;
create trigger employee_lifecycle_event_trg after insert or update of status, department_id, designation on employees
for each row execute function employee_lifecycle_event();

create or replace function candidates_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger candidates_touch before update on candidates for each row execute function candidates_touch_updated_at();
create trigger interviews_touch before update on candidate_interviews for each row execute function candidates_touch_updated_at();

alter table candidates enable row level security;
alter table candidate_interviews enable row level security;
alter table employment_events enable row level security;
alter table onboarding_checklist_items enable row level security;

create policy candidates_read on candidates for select to authenticated
using (org_id=current_org_id() and (has_perm('recruit.view') or has_perm('recruit.manage')));
create policy candidates_insert on candidates for insert to authenticated
with check (org_id=current_org_id() and has_perm('recruit.manage') and created_by=current_employee_id());
create policy candidates_update on candidates for update to authenticated
using (org_id=current_org_id() and has_perm('recruit.manage'))
with check (org_id=current_org_id() and has_perm('recruit.manage'));
create policy candidates_delete on candidates for delete to authenticated
using (org_id=current_org_id() and has_perm('recruit.manage'));

create policy interviews_read on candidate_interviews for select to authenticated
using (org_id=current_org_id() and (has_perm('recruit.view') or has_perm('recruit.manage')));
create policy interviews_write on candidate_interviews for all to authenticated
using (org_id=current_org_id() and has_perm('recruit.manage'))
with check (org_id=current_org_id() and has_perm('recruit.manage'));

create policy employment_events_read on employment_events for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage') or has_perm('people.view_all') or (has_perm('people.view_team') and is_in_my_team(employee_id))));
-- Events are written only by triggers / trusted service role; no client write policy.
create policy onboarding_read on onboarding_checklist_items for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage') or (has_perm('people.view_team') and is_in_my_team(employee_id))));
create policy onboarding_insert on onboarding_checklist_items for insert to authenticated
with check (org_id=current_org_id() and has_perm('people.manage'));
create policy onboarding_update on onboarding_checklist_items for update to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage')))
with check (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage')) and completed_by=current_employee_id());
create policy onboarding_delete on onboarding_checklist_items for delete to authenticated
using (org_id=current_org_id() and has_perm('people.manage'));

-- Extend default role permissions for existing and future organizations.
insert into role_permissions(org_id, role, permission)
select o.id, r.role, p.permission
from organizations o
cross join (values ('ADMIN'::app_role),('HR_MANAGER'::app_role)) r(role)
cross join (values ('recruit.view'),('recruit.manage')) p(permission)
on conflict do nothing;

create or replace function seed_recruitment_permissions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into role_permissions(org_id, role, permission) values
    (new.id,'ADMIN','recruit.view'),(new.id,'ADMIN','recruit.manage'),
    (new.id,'HR_MANAGER','recruit.view'),(new.id,'HR_MANAGER','recruit.manage')
  on conflict do nothing;
  return new;
end $$;
create trigger organizations_seed_recruitment after insert on organizations
for each row execute function seed_recruitment_permissions();

-- Candidate stage transitions are auditable.
create or replace function candidate_audit_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='INSERT' then
    perform _audit(new.org_id,'recruit.candidate.created','candidate',new.id::text,jsonb_build_object('stage',new.stage));
  elsif new.stage is distinct from old.stage then
    perform _audit(new.org_id,'recruit.candidate.stage_changed','candidate',new.id::text,jsonb_build_object('from',old.stage,'to',new.stage));
  end if;
  return new;
end $$;
create trigger candidate_audit_trg after insert or update on candidates for each row execute function candidate_audit_event();

-- Atomic candidate-to-employee conversion; no partially hired candidate if insert fails.
create or replace function hire_candidate(
  p_candidate uuid, p_employee_code text, p_joining_date date,
  p_employment_type employment_type default 'FULL_TIME'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c candidates; v_employee uuid;
begin
  if not has_perm('recruit.manage') or not has_perm('people.manage') then
    raise exception 'recruit.manage and people.manage required' using errcode='42501';
  end if;
  select * into c from candidates where id=p_candidate and org_id=current_org_id() for update;
  if c.id is null then raise exception 'candidate not found' using errcode='P0002'; end if;
  if c.stage='HIRED' or c.converted_employee_id is not null then raise exception 'candidate already hired' using errcode='P0001'; end if;
  if c.stage <> 'OFFER' then raise exception 'candidate must reach OFFER stage before hiring' using errcode='P0001'; end if;
  if p_employee_code is null or upper(trim(p_employee_code)) !~ '^[A-Z0-9-]{2,20}$' then raise exception 'invalid employee ID' using errcode='P0001'; end if;
  if p_joining_date is null then raise exception 'joining date is required' using errcode='P0001'; end if;
  insert into employees(org_id,employee_code,full_name,official_email,phone,designation,department_id,role,joining_date,employment_type,status)
  values(c.org_id,upper(trim(p_employee_code)),c.full_name,lower(c.email),c.phone,c.role_applied,c.department_id,'EMPLOYEE',p_joining_date,p_employment_type,'PROBATION')
  returning id into v_employee;
  insert into onboarding_checklist_items(org_id,employee_id,title,category)
  values
    (c.org_id,v_employee,'Collect identity and employment documents','DOCUMENTS'),
    (c.org_id,v_employee,'Create official email and system access','IT_ACCESS'),
    (c.org_id,v_employee,'Complete HR policies and handbook orientation','HR_ORIENTATION'),
    (c.org_id,v_employee,'Introduce team, manager and reporting process','TEAM_SETUP'),
    (c.org_id,v_employee,'Confirm workstation and required tools','IT_ACCESS');
  update candidates set stage='HIRED',converted_employee_id=v_employee where id=c.id;
  perform _audit(c.org_id,'recruit.candidate.hired','candidate',c.id::text,jsonb_build_object('employee_id',v_employee,'employee_code',upper(trim(p_employee_code))));
  return v_employee;
end $$;
revoke all on function hire_candidate(uuid,text,date,employment_type) from public, anon;
grant execute on function hire_candidate(uuid,text,date,employment_type) to authenticated;


-- Reject cross-organization foreign-key references even when a caller guesses UUIDs.
create or replace function guard_recruitment_org_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name='candidates' then
    if new.department_id is not null and not exists(select 1 from departments d where d.id=new.department_id and d.org_id=new.org_id) then raise exception 'department is outside this organization' using errcode='23514'; end if;
    if new.owner_id is not null and not exists(select 1 from employees e where e.id=new.owner_id and e.org_id=new.org_id) then raise exception 'recruiter is outside this organization' using errcode='23514'; end if;
  elsif tg_table_name='candidate_interviews' then
    if not exists(select 1 from candidates c where c.id=new.candidate_id and c.org_id=new.org_id and c.stage not in ('HIRED','REJECTED','WITHDRAWN')) then raise exception 'candidate is unavailable for interview' using errcode='23514'; end if;
    if new.interviewer_id is not null and not exists(select 1 from employees e where e.id=new.interviewer_id and e.org_id=new.org_id) then raise exception 'interviewer is outside this organization' using errcode='23514'; end if;
  elsif tg_table_name='onboarding_checklist_items' then
    if not exists(select 1 from employees e where e.id=new.employee_id and e.org_id=new.org_id) then raise exception 'employee is outside this organization' using errcode='23514'; end if;
    if new.completed_by is not null and not exists(select 1 from employees e where e.id=new.completed_by and e.org_id=new.org_id) then raise exception 'completer is outside this organization' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger candidates_org_guard before insert or update on candidates for each row execute function guard_recruitment_org_refs();
create trigger interviews_org_guard before insert or update on candidate_interviews for each row execute function guard_recruitment_org_refs();
create trigger onboarding_org_guard before insert or update on onboarding_checklist_items for each row execute function guard_recruitment_org_refs();


-- A converted hire is terminal; only hire_candidate may set HIRED + employee link.
create or replace function protect_hired_candidate() returns trigger
language plpgsql as $$
begin
  if old.stage='HIRED' or old.converted_employee_id is not null then
    raise exception 'a hired candidate cannot be changed' using errcode='P0001';
  end if;
  if new.stage='HIRED' and new.converted_employee_id is null then
    raise exception 'use the hire workflow to convert a candidate' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger candidates_protect_hired before update on candidates
for each row execute function protect_hired_candidate();

-- Candidate conversion link is writable only inside the SECURITY DEFINER hire RPC.
-- Restrict authenticated table grants as well as RLS so callers cannot forge a hire.
revoke insert, update on candidates from authenticated;
grant insert (org_id,full_name,email,phone,role_applied,department_id,source,stage,resume_path,expected_salary_paise,notice_period_days,owner_id,notes,rejection_reason,created_by)
  on candidates to authenticated;
grant update (stage,rejection_reason,owner_id,notes,resume_path,expected_salary_paise,notice_period_days)
  on candidates to authenticated;

-- Employees may complete checklist status only; HR owns checklist content.
revoke update on onboarding_checklist_items from authenticated;
grant update (completed_at,completed_by) on onboarding_checklist_items to authenticated;
