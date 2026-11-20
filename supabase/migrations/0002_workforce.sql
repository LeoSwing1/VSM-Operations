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
