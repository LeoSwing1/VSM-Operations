-- Block 08: workforce operations — teams, schedules, time allocation, quality, meetings and calendar.
-- Attendance punches remain authoritative in attendance_events via record_attendance().

create table org_teams (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  department_id uuid references departments(id) on delete set null, name text not null check(length(name) between 2 and 100),
  description text, lead_employee_id uuid references employees(id) on delete set null,
  is_active boolean not null default true, created_by uuid references employees(id), created_at timestamptz not null default now(),
  unique(org_id, name), unique(id, org_id)
);
create table org_team_members (
  org_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null, employee_id uuid not null references employees(id) on delete cascade,
  member_role text not null default 'MEMBER' check(member_role in ('LEAD','MANAGER','MEMBER')),
  joined_at timestamptz not null default now(), primary key(team_id, employee_id),
  foreign key(team_id, org_id) references org_teams(id, org_id) on delete cascade
);
create index org_team_members_employee_idx on org_team_members(org_id, employee_id);

create table work_groups (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  name text not null check(length(name) between 2 and 100), description text,
  group_type text not null default 'WORKING' check(group_type in ('WORKING','PROJECT','SOCIAL','COMMITTEE')),
  is_private boolean not null default false, owner_id uuid not null references employees(id),
  created_at timestamptz not null default now(), unique(org_id, name), unique(id, org_id)
);
create table work_group_members (
  org_id uuid not null references organizations(id) on delete cascade, group_id uuid not null,
  employee_id uuid not null references employees(id) on delete cascade,
  member_role text not null default 'MEMBER' check(member_role in ('OWNER','MODERATOR','MEMBER')),
  joined_at timestamptz not null default now(), primary key(group_id, employee_id),
  foreign key(group_id, org_id) references work_groups(id, org_id) on delete cascade
);

create table schedule_assignments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade, shift_id uuid not null references shifts(id) on delete restrict,
  effective_from date not null, effective_to date, assigned_by uuid references employees(id), created_at timestamptz not null default now(),
  check(effective_to is null or effective_to >= effective_from)
);
create index schedule_assignments_employee_date_idx on schedule_assignments(employee_id, effective_from, effective_to);

create table task_time_entries (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null, project_id uuid references projects(id) on delete set null,
  work_date date not null, started_at timestamptz, ended_at timestamptz,
  minutes integer not null check(minutes between 1 and 1440), description text not null check(length(description) between 3 and 1000),
  billable boolean not null default false, status request_status not null default 'PENDING',
  approved_by uuid references employees(id), approved_at timestamptz, created_at timestamptz not null default now(),
  check(task_id is not null), check(ended_at is null or started_at is null or ended_at > started_at),
  check((status = 'APPROVED' and approved_by is not null and approved_at is not null) or status <> 'APPROVED')
);
create index task_time_entries_employee_date_idx on task_time_entries(org_id, employee_id, work_date desc);
create index task_time_entries_status_idx on task_time_entries(org_id, status, work_date);

create table quality_checklists (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  name text not null check(length(name) between 2 and 120), description text,
  criteria jsonb not null default '[]'::jsonb check(jsonb_typeof(criteria)='array'),
  is_active boolean not null default true, created_by uuid references employees(id), created_at timestamptz not null default now(), unique(org_id, name)
);
create table quality_assessments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null, project_id uuid references projects(id) on delete set null,
  employee_id uuid not null references employees(id) on delete cascade, reviewer_id uuid not null references employees(id),
  checklist_id uuid references quality_checklists(id) on delete set null,
  score numeric(5,2) not null check(score between 0 and 100), outcome text not null check(outcome in ('PASS','REWORK','FAIL')),
  findings text, evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array'), assessed_at timestamptz not null default now(),
  check(task_id is not null or project_id is not null), check(employee_id <> reviewer_id)
);
create index quality_assessments_employee_idx on quality_assessments(org_id, employee_id, assessed_at desc);

create table calendar_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  title text not null check(length(title) between 2 and 200), description text,
  event_type text not null default 'MEETING' check(event_type in ('MEETING','FOCUS','DEADLINE','LEAVE','HOLIDAY','TRAINING','OTHER')),
  visibility text not null default 'INVITEES' check(visibility in ('ORG','DEPARTMENT','TEAM','INVITEES','PRIVATE')),
  starts_at timestamptz not null, ends_at timestamptz not null, all_day boolean not null default false,
  location text, meeting_url text, department_id uuid references departments(id) on delete cascade,
  team_id uuid references org_teams(id) on delete cascade, project_id uuid references projects(id) on delete set null,
  organizer_id uuid not null references employees(id), recurrence_rule text,
  status text not null default 'SCHEDULED' check(status in ('SCHEDULED','CANCELLED','COMPLETED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at > starts_at), check(meeting_url is null or meeting_url ~ '^https?://'),
  check((visibility='DEPARTMENT')=(department_id is not null)), check((visibility='TEAM')=(team_id is not null))
);
create index calendar_events_org_start_idx on calendar_events(org_id, starts_at) where status <> 'CANCELLED';
create table calendar_attendees (
  event_id uuid not null references calendar_events(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  response text not null default 'NEEDS_ACTION' check(response in ('NEEDS_ACTION','ACCEPTED','DECLINED','TENTATIVE')),
  responded_at timestamptz, primary key(event_id, employee_id)
);
create index calendar_attendees_employee_idx on calendar_attendees(org_id, employee_id, event_id);

create table meeting_notes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null unique references calendar_events(id) on delete cascade,
  agenda text, minutes text, decisions jsonb not null default '[]'::jsonb check(jsonb_typeof(decisions)='array'),
  action_items jsonb not null default '[]'::jsonb check(jsonb_typeof(action_items)='array'),
  updated_by uuid references employees(id), updated_at timestamptz not null default now()
);

-- Scope helpers. Team membership grants team visibility, never cross-organisation access.
create or replace function can_view_team(p_team uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from org_teams t where t.id=p_team and t.org_id=current_org_id() and
   (has_perm('teams.view_all') or exists(select 1 from org_team_members m where m.team_id=t.id and m.employee_id=current_employee_id()) or t.lead_employee_id=current_employee_id()))
$$;
create or replace function can_manage_team(p_team uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from org_teams t where t.id=p_team and t.org_id=current_org_id() and
   (has_perm('teams.manage') or (has_perm('teams.manage_team') and (t.lead_employee_id=current_employee_id() or exists(select 1 from org_team_members m where m.team_id=t.id and m.employee_id=current_employee_id() and m.member_role in ('LEAD','MANAGER'))))))
$$;

-- Team and group tables.
alter table org_teams enable row level security; alter table org_team_members enable row level security;
alter table work_groups enable row level security; alter table work_group_members enable row level security;
alter table schedule_assignments enable row level security; alter table task_time_entries enable row level security;
alter table quality_checklists enable row level security; alter table quality_assessments enable row level security;
alter table calendar_events enable row level security; alter table calendar_attendees enable row level security; alter table meeting_notes enable row level security;

create policy teams_read on org_teams for select to authenticated using(org_id=current_org_id() and (has_perm('teams.view_all') or lead_employee_id=current_employee_id() or can_manage_team(id) or exists(select 1 from org_team_members m where m.team_id=id and m.employee_id=current_employee_id())));
create policy teams_insert on org_teams for insert to authenticated with check(org_id=current_org_id() and has_perm('teams.manage'));
create policy teams_update on org_teams for update to authenticated using(org_id=current_org_id() and (has_perm('teams.manage') or can_manage_team(id))) with check(org_id=current_org_id() and (has_perm('teams.manage') or can_manage_team(id)));
create policy team_members_read on org_team_members for select to authenticated using(org_id=current_org_id() and (has_perm('teams.view_all') or employee_id=current_employee_id() or can_view_team(team_id) or can_manage_team(team_id)));
create policy team_members_manage on org_team_members for all to authenticated using(org_id=current_org_id() and can_manage_team(team_id)) with check(org_id=current_org_id() and can_manage_team(team_id));

create policy groups_read on work_groups for select to authenticated using(org_id=current_org_id() and (not is_private or owner_id=current_employee_id() or exists(select 1 from work_group_members m where m.group_id=id and m.employee_id=current_employee_id()) or has_perm('teams.view_all')));
create policy groups_insert on work_groups for insert to authenticated with check(org_id=current_org_id() and owner_id=current_employee_id() and has_perm('teams.create_group'));
create policy groups_update on work_groups for update to authenticated using(org_id=current_org_id() and (owner_id=current_employee_id() or has_perm('teams.manage'))) with check(org_id=current_org_id() and (owner_id=current_employee_id() or has_perm('teams.manage')));
create policy group_members_read on work_group_members for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or exists(select 1 from work_groups g where g.id=group_id and (not g.is_private or g.owner_id=current_employee_id() or has_perm('teams.view_all'))) or has_perm('teams.view_all')));
create policy group_members_manage on work_group_members for all to authenticated using(org_id=current_org_id() and (has_perm('teams.manage') or exists(select 1 from work_groups g where g.id=group_id and g.owner_id=current_employee_id()))) with check(org_id=current_org_id() and (has_perm('teams.manage') or exists(select 1 from work_groups g where g.id=group_id and g.owner_id=current_employee_id())));

create policy schedule_read on schedule_assignments for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('attendance.view_all') or (has_perm('attendance.view_team') and is_in_my_team(employee_id))));
create policy schedule_manage on schedule_assignments for all to authenticated using(org_id=current_org_id() and has_perm('attendance.manage')) with check(org_id=current_org_id() and has_perm('attendance.manage'));

create policy time_entries_read on task_time_entries for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('time.view_all') or (has_perm('time.view_team') and is_in_my_team(employee_id))));
create policy time_entries_insert on task_time_entries for insert to authenticated with check(org_id=current_org_id() and employee_id=current_employee_id() and status='PENDING' and approved_by is null and exists(select 1 from tasks t where t.id=task_id and t.assignee_id=current_employee_id()));
create policy time_entries_update on task_time_entries for update to authenticated using(org_id=current_org_id() and employee_id=current_employee_id() and status='PENDING') with check(org_id=current_org_id() and employee_id=current_employee_id() and status='PENDING' and approved_by is null and exists(select 1 from tasks t where t.id=task_id and t.assignee_id=current_employee_id()));

create policy quality_checklists_read on quality_checklists for select to authenticated using(org_id=current_org_id() and (has_perm('tasks.review') or is_active));
create policy quality_checklists_manage on quality_checklists for all to authenticated using(org_id=current_org_id() and has_perm('quality.manage')) with check(org_id=current_org_id() and has_perm('quality.manage'));
create policy quality_assessments_read on quality_assessments for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or reviewer_id=current_employee_id() or has_perm('quality.view_all') or (has_perm('quality.view_team') and is_in_my_team(employee_id))));
create policy quality_assessments_insert on quality_assessments for insert to authenticated with check(org_id=current_org_id() and reviewer_id=current_employee_id() and employee_id<>current_employee_id() and has_perm('quality.review'));

create policy calendar_read on calendar_events for select to authenticated using(org_id=current_org_id() and (visibility='ORG' or organizer_id=current_employee_id() or exists(select 1 from calendar_attendees a where a.event_id=id and a.employee_id=current_employee_id()) or (visibility='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or (visibility='TEAM' and team_id is not null and can_view_team(team_id)) or (visibility='PRIVATE' and organizer_id=current_employee_id())));
create policy calendar_insert on calendar_events for insert to authenticated with check(org_id=current_org_id() and organizer_id=current_employee_id() and has_perm('calendar.create'));
create policy calendar_update on calendar_events for update to authenticated using(org_id=current_org_id() and (organizer_id=current_employee_id() or has_perm('calendar.manage'))) with check(org_id=current_org_id() and (organizer_id=current_employee_id() or has_perm('calendar.manage')));
create policy attendees_read on calendar_attendees for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or exists(select 1 from calendar_events e where e.id=event_id and (e.organizer_id=current_employee_id() or e.visibility='ORG' or has_perm('calendar.manage')))));
create policy attendees_insert on calendar_attendees for insert to authenticated with check(org_id=current_org_id() and exists(select 1 from calendar_events e where e.id=event_id and e.org_id=current_org_id() and (e.organizer_id=current_employee_id() or has_perm('calendar.manage'))));
create policy attendees_update_self on calendar_attendees for update to authenticated using(org_id=current_org_id() and employee_id=current_employee_id()) with check(org_id=current_org_id() and employee_id=current_employee_id());
create policy meeting_notes_read on meeting_notes for select to authenticated using(org_id=current_org_id() and exists(select 1 from calendar_events e where e.id=event_id and (e.organizer_id=current_employee_id() or exists(select 1 from calendar_attendees a where a.event_id=e.id and a.employee_id=current_employee_id()) or has_perm('calendar.manage'))));
create policy meeting_notes_write on meeting_notes for all to authenticated using(org_id=current_org_id() and (has_perm('calendar.manage') or exists(select 1 from calendar_events e where e.id=event_id and e.organizer_id=current_employee_id()))) with check(org_id=current_org_id() and (has_perm('calendar.manage') or exists(select 1 from calendar_events e where e.id=event_id and e.organizer_id=current_employee_id())));

-- Approval RPC prevents self-approval and prevents changing approved/rejected records.
create or replace function decide_task_time_entry(p_id uuid,p_approve boolean) returns task_time_entries
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row task_time_entries; v_me uuid:=current_employee_id();
begin
 select * into v_row from task_time_entries where id=p_id and org_id=current_org_id() for update;
 if v_row.id is null then raise exception 'time entry not found' using errcode='P0002'; end if;
 if v_row.status<>'PENDING' then raise exception 'time entry already decided' using errcode='P0001'; end if;
 if v_row.employee_id=v_me then raise exception 'cannot approve your own time' using errcode='42501'; end if;
 if not (has_perm('time.approve_all') or (has_perm('time.approve_team') and is_in_my_team(v_row.employee_id))) then raise exception 'not authorized' using errcode='42501'; end if;
 update task_time_entries set status=case when p_approve then 'APPROVED'::request_status else 'REJECTED'::request_status end,
  approved_by=case when p_approve then v_me else null end, approved_at=case when p_approve then now() else null end
 where id=p_id returning * into v_row;
 perform _audit(v_row.org_id,case when p_approve then 'time.approved' else 'time.rejected' end,'task_time_entry',v_row.id::text,jsonb_build_object('employee_id',v_row.employee_id,'minutes',v_row.minutes));
 return v_row;
end $$;
revoke all on function decide_task_time_entry(uuid,boolean) from public,anon;
grant execute on function decide_task_time_entry(uuid,boolean) to authenticated;

-- Permission grants for default roles and future organisations.
insert into role_permissions(org_id,role,permission)
select o.id,r.role,p.permission from organizations o
cross join (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
cross join (values ('teams.view_all'),('time.view_all'),('time.view_team'),('time.approve_all'),('time.approve_team'),('quality.view_all'),('quality.view_team'),('quality.review'),('calendar.manage')) p(permission)
where (r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('time.view_team','time.approve_team','quality.view_team','quality.review'))
on conflict do nothing;
insert into role_permissions(org_id,role,permission)
select o.id,r.role,p.permission from organizations o
cross join (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
cross join (values ('teams.manage'),('teams.manage_team'),('teams.create_group'),('calendar.create'),('quality.manage')) p(permission)
where r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('teams.manage_team','teams.create_group','calendar.create')
on conflict do nothing;

create or replace function seed_workforce_collaboration_permissions(p_org uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 insert into role_permissions(org_id,role,permission)
 select p_org,r.role,p.permission from
 (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
 cross join (values ('teams.view_all'),('time.view_all'),('time.view_team'),('time.approve_all'),('time.approve_team'),('quality.view_all'),('quality.view_team'),('quality.review'),('calendar.manage')) p(permission)
 where r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('time.view_team','time.approve_team','quality.view_team','quality.review')
 on conflict do nothing;
 insert into role_permissions(org_id,role,permission)
 select p_org,r.role,p.permission from (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
 cross join (values ('teams.manage'),('teams.manage_team'),('teams.create_group'),('calendar.create'),('quality.manage')) p(permission)
 where r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('teams.manage_team','teams.create_group','calendar.create')
 on conflict do nothing;
 insert into role_permissions(org_id,role,permission)
 select p_org,r.role,'calendar.create' from unnest(enum_range(null::app_role)) as r(role)
 on conflict do nothing;
end $$;
revoke all on function seed_workforce_collaboration_permissions(uuid) from public,anon,authenticated;
create or replace function organizations_seed_workforce_collaboration_permissions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform seed_workforce_collaboration_permissions(new.id); return new; end $$;
create trigger organizations_seed_workforce_collaboration_permissions after insert on organizations for each row execute function organizations_seed_workforce_collaboration_permissions();

-- Protect immutable ownership/org identity and log key business records.
create or replace function workforce_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.org_id is distinct from old.org_id then raise exception 'organisation cannot be changed' using errcode='42501'; end if;
 if auth.uid() is not null and new.org_id<>current_org_id() then raise exception 'cross-organisation write denied' using errcode='42501'; end if;
 return new;
end $$;
create trigger workforce_org_guard_teams before insert or update on org_teams for each row execute function workforce_org_guard();
create trigger workforce_org_guard_groups before insert or update on work_groups for each row execute function workforce_org_guard();
create trigger workforce_org_guard_calendar before insert or update on calendar_events for each row execute function workforce_org_guard();
create trigger workforce_org_guard_time before insert or update on task_time_entries for each row execute function workforce_org_guard();
create trigger workforce_org_guard_quality before insert or update on quality_assessments for each row execute function workforce_org_guard();

-- Ensure the consolidated SQL remains a deterministic concatenation of source migrations.

-- Break policy recursion through security-definer visibility helpers.
create or replace function can_access_work_group(p_group uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from work_groups g where g.id=p_group and g.org_id=current_org_id() and
   (not g.is_private or g.owner_id=current_employee_id() or has_perm('teams.view_all') or has_perm('teams.manage') or exists(select 1 from work_group_members m where m.group_id=g.id and m.employee_id=current_employee_id())))
$$;
drop policy groups_read on work_groups;
create policy groups_read on work_groups for select to authenticated using(org_id=current_org_id() and can_access_work_group(id));
drop policy group_members_read on work_group_members;
create policy group_members_read on work_group_members for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or can_access_work_group(group_id)));

create or replace function can_view_calendar_event(p_event uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from calendar_events e where e.id=p_event and e.org_id=current_org_id() and
   (has_perm('calendar.manage') or e.visibility='ORG' or e.organizer_id=current_employee_id() or
    exists(select 1 from calendar_attendees a where a.event_id=e.id and a.employee_id=current_employee_id()) or
    (e.visibility='DEPARTMENT' and e.department_id=(select department_id from employees where id=current_employee_id())) or
    (e.visibility='TEAM' and e.team_id is not null and can_view_team(e.team_id))))
$$;
drop policy calendar_read on calendar_events;
create policy calendar_read on calendar_events for select to authenticated using(org_id=current_org_id() and can_view_calendar_event(id));
drop policy attendees_read on calendar_attendees;
create policy attendees_read on calendar_attendees for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or can_view_calendar_event(event_id) or has_perm('calendar.manage')));
drop policy meeting_notes_read on meeting_notes;
create policy meeting_notes_read on meeting_notes for select to authenticated using(org_id=current_org_id() and can_view_calendar_event(event_id));
drop policy quality_assessments_insert on quality_assessments;
create policy quality_assessments_insert on quality_assessments for insert to authenticated with check(org_id=current_org_id() and reviewer_id=current_employee_id() and employee_id<>current_employee_id() and (has_perm('quality.review') or has_perm('tasks.review')));

-- Enforce tenant consistency for every relationship that is not covered by a composite foreign key.
create or replace function workforce_relationship_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid;
begin
 if tg_op='UPDATE' and new.org_id is distinct from old.org_id then raise exception 'organisation cannot be changed' using errcode='42501'; end if;
 if auth.uid() is not null and new.org_id<>current_org_id() then raise exception 'cross-organisation write denied' using errcode='42501'; end if;
 if tg_table_name='org_teams' then
   if new.created_by is not null then select org_id into v_org from employees where id=new.created_by; if v_org is distinct from new.org_id then raise exception 'team creator must belong to this organisation'; end if; end if;
   if new.lead_employee_id is not null then select org_id into v_org from employees where id=new.lead_employee_id; if v_org is distinct from new.org_id then raise exception 'team lead must belong to this organisation'; end if; end if;
   if new.department_id is not null then select org_id into v_org from departments where id=new.department_id; if v_org is distinct from new.org_id then raise exception 'team department must belong to this organisation'; end if; end if;
 elsif tg_table_name='org_team_members' then
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'team member must belong to this organisation'; end if;
 elsif tg_table_name='work_groups' then
   if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then raise exception 'group ownership transfer is not available; create a new group or contact an administrator' using errcode='42501'; end if;
   select org_id into v_org from employees where id=new.owner_id; if v_org is distinct from new.org_id then raise exception 'group owner must belong to this organisation'; end if;
 elsif tg_table_name='work_group_members' then
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'group member must belong to this organisation'; end if;
 elsif tg_table_name='schedule_assignments' then
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'schedule employee must belong to this organisation'; end if;
   select org_id into v_org from shifts where id=new.shift_id; if v_org is distinct from new.org_id then raise exception 'shift must belong to this organisation'; end if;
   if new.assigned_by is not null then select org_id into v_org from employees where id=new.assigned_by; if v_org is distinct from new.org_id then raise exception 'schedule assigner must belong to this organisation'; end if; end if;
   perform pg_advisory_xact_lock(hashtext(new.employee_id::text));
   if exists(select 1 from schedule_assignments a where a.employee_id=new.employee_id and a.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and daterange(a.effective_from,coalesce(a.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')) then raise exception 'schedule dates overlap an existing assignment' using errcode='23P01'; end if;
 elsif tg_table_name='task_time_entries' then
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'time owner must belong to this organisation'; end if;
   if new.task_id is not null then select org_id into v_org from tasks where id=new.task_id; if v_org is distinct from new.org_id then raise exception 'task must belong to this organisation'; end if; end if;
   if new.project_id is not null then select org_id into v_org from projects where id=new.project_id; if v_org is distinct from new.org_id then raise exception 'project must belong to this organisation'; end if; if new.task_id is not null and not exists(select 1 from tasks where id=new.task_id and project_id=new.project_id) then raise exception 'selected project must match the task project'; end if; end if;
   if new.approved_by is not null then select org_id into v_org from employees where id=new.approved_by; if v_org is distinct from new.org_id then raise exception 'approver must belong to this organisation'; end if; end if;
 elsif tg_table_name='quality_checklists' then
   if new.created_by is not null then select org_id into v_org from employees where id=new.created_by; if v_org is distinct from new.org_id then raise exception 'checklist creator must belong to this organisation'; end if; end if;
 elsif tg_table_name='quality_assessments' then
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'assessed employee must belong to this organisation'; end if;
   select org_id into v_org from employees where id=new.reviewer_id; if v_org is distinct from new.org_id then raise exception 'reviewer must belong to this organisation'; end if;
   if new.task_id is not null then select org_id into v_org from tasks where id=new.task_id; if v_org is distinct from new.org_id then raise exception 'task must belong to this organisation'; end if; end if;
   if new.project_id is not null then select org_id into v_org from projects where id=new.project_id; if v_org is distinct from new.org_id then raise exception 'project must belong to this organisation'; end if; if new.task_id is not null and not exists(select 1 from tasks where id=new.task_id and project_id=new.project_id) then raise exception 'selected project must match the task project'; end if; end if;
   if new.checklist_id is not null then select org_id into v_org from quality_checklists where id=new.checklist_id; if v_org is distinct from new.org_id then raise exception 'quality checklist must belong to this organisation'; end if; end if;
 elsif tg_table_name='calendar_events' then
   select org_id into v_org from employees where id=new.organizer_id; if v_org is distinct from new.org_id then raise exception 'organizer must belong to this organisation'; end if;
   if new.department_id is not null then select org_id into v_org from departments where id=new.department_id; if v_org is distinct from new.org_id then raise exception 'department must belong to this organisation'; end if; end if;
   if new.team_id is not null then select org_id into v_org from org_teams where id=new.team_id; if v_org is distinct from new.org_id then raise exception 'team must belong to this organisation'; end if; end if;
   if new.project_id is not null then select org_id into v_org from projects where id=new.project_id; if v_org is distinct from new.org_id then raise exception 'project must belong to this organisation'; end if; end if;
 elsif tg_table_name='calendar_attendees' then
   if tg_op='UPDATE' and (new.event_id is distinct from old.event_id or new.employee_id is distinct from old.employee_id) then raise exception 'invitation identity cannot be changed' using errcode='42501'; end if;
   select org_id into v_org from employees where id=new.employee_id; if v_org is distinct from new.org_id then raise exception 'attendee must belong to this organisation'; end if;
   select org_id into v_org from calendar_events where id=new.event_id; if v_org is distinct from new.org_id then raise exception 'event must belong to this organisation'; end if;
 elsif tg_table_name='meeting_notes' then
   select org_id into v_org from calendar_events where id=new.event_id; if v_org is distinct from new.org_id then raise exception 'meeting must belong to this organisation'; end if;
   if new.updated_by is not null then select org_id into v_org from employees where id=new.updated_by; if v_org is distinct from new.org_id then raise exception 'meeting editor must belong to this organisation'; end if; end if;
 end if;
 return new;
end $$;
create trigger workforce_relationship_guard_teams before insert or update on org_teams for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_team_members before insert or update on org_team_members for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_groups before insert or update on work_groups for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_group_members before insert or update on work_group_members for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_schedules before insert or update on schedule_assignments for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_time before insert or update on task_time_entries for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_quality_checklists before insert or update on quality_checklists for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_quality before insert or update on quality_assessments for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_events before insert or update on calendar_events for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_attendees before insert or update on calendar_attendees for each row execute function workforce_relationship_guard();
create trigger workforce_relationship_guard_notes before insert or update on meeting_notes for each row execute function workforce_relationship_guard();

-- Every employee can schedule personal/invitee events; organisation-wide calendar administration stays gated.
insert into role_permissions(org_id,role,permission)
select o.id,r.role,'calendar.create' from organizations o cross join unnest(enum_range(null::app_role)) as r(role) on conflict do nothing;

-- Rebuild aggregate migration in source order.

create or replace function notify_calendar_invitation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text; v_start timestamptz; v_organizer uuid;
begin
 select title,starts_at,organizer_id into v_title,v_start,v_organizer from calendar_events where id=new.event_id;
 if new.employee_id<>v_organizer and new.response='NEEDS_ACTION' then
   insert into notifications(org_id,recipient_id,category,title,body,link,dedupe_key)
   values(new.org_id,new.employee_id,'MEETINGS','Meeting invitation: '||coalesce(v_title,'Meeting'),'You have been invited to a meeting.','/calendar','calendar-invite:'||new.event_id::text||':'||new.employee_id::text)
   on conflict(recipient_id,dedupe_key) do nothing;
 end if;
 return new;
end $$;
create trigger calendar_invitation_notify after insert on calendar_attendees for each row execute function notify_calendar_invitation();

-- Keep database delegation rules aligned with the application permission catalogue.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
 select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%'
   or p in ('roles.manage','audit.view','settings.manage','communication.moderate','communication.channel_manage',
            'teams.manage','time.approve_all','quality.manage','calendar.manage')
$$;

create or replace function join_public_work_group(p_group uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_group work_groups;
begin
 select * into v_group from work_groups where id=p_group and org_id=current_org_id() for update;
 if v_group.id is null then raise exception 'group not found' using errcode='P0002'; end if;
 if v_group.is_private then raise exception 'private groups require an invitation' using errcode='42501'; end if;
 insert into work_group_members(org_id,group_id,employee_id,member_role) values(v_group.org_id,v_group.id,current_employee_id(),'MEMBER') on conflict(group_id,employee_id) do nothing;
end $$;
create or replace function leave_work_group(p_group uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from work_group_members m using work_groups g where m.group_id=g.id and m.org_id=current_org_id() and m.group_id=p_group and m.employee_id=current_employee_id() and m.member_role<>'OWNER' and g.is_private=false;
 if not found then raise exception 'you cannot leave this group or it is private' using errcode='42501'; end if;
end $$;
revoke all on function join_public_work_group(uuid) from public,anon;
revoke all on function leave_work_group(uuid) from public,anon;
grant execute on function join_public_work_group(uuid),leave_work_group(uuid) to authenticated;

revoke all on function can_view_team(uuid),can_manage_team(uuid),can_access_work_group(uuid),can_view_calendar_event(uuid) from public,anon;
grant execute on function can_view_team(uuid),can_manage_team(uuid),can_access_work_group(uuid),can_view_calendar_event(uuid) to authenticated;
revoke all on function workforce_org_guard(),workforce_relationship_guard(),organizations_seed_workforce_collaboration_permissions(),notify_calendar_invitation() from public,anon,authenticated;

create or replace function protect_team_and_group_owners() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='org_team_members' then
   if old.member_role='LEAD' or exists(select 1 from org_teams t where t.id=old.team_id and t.lead_employee_id=old.employee_id) then
     raise exception 'transfer team leadership before removing the team lead' using errcode='42501';
   end if;
 elsif tg_table_name='work_group_members' then
   if old.member_role='OWNER' or exists(select 1 from work_groups g where g.id=old.group_id and g.owner_id=old.employee_id) then
     raise exception 'group ownership cannot be removed from the owner' using errcode='42501';
   end if;
 end if;
 return old;
end $$;
create trigger protect_team_lead_membership before delete on org_team_members for each row execute function protect_team_and_group_owners();
create trigger protect_group_owner_membership before delete on work_group_members for each row execute function protect_team_and_group_owners();
revoke all on function protect_team_and_group_owners() from public,anon,authenticated;

create or replace function transfer_org_team_lead(p_team uuid,p_employee uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_team org_teams; v_me uuid:=current_employee_id(); v_org uuid;
begin
 select * into v_team from org_teams where id=p_team and org_id=current_org_id() for update;
 if v_team.id is null then raise exception 'team not found' using errcode='P0002'; end if;
 if not can_manage_team(p_team) then raise exception 'team management permission required' using errcode='42501'; end if;
 select org_id into v_org from employees where id=p_employee and status<>'EXITED';
 if v_org is distinct from current_org_id() then raise exception 'new team lead must be an active employee in this organisation' using errcode='23514'; end if;
 if v_team.lead_employee_id is not null and v_team.lead_employee_id<>p_employee then
   update org_team_members set member_role='MEMBER' where team_id=p_team and employee_id=v_team.lead_employee_id;
 end if;
 update org_teams set lead_employee_id=p_employee where id=p_team;
 insert into org_team_members(org_id,team_id,employee_id,member_role) values(current_org_id(),p_team,p_employee,'LEAD')
 on conflict(team_id,employee_id) do update set member_role='LEAD';
 perform _audit(current_org_id(),'team.lead.transferred','org_team',p_team::text,jsonb_build_object('from',v_team.lead_employee_id,'to',p_employee));
end $$;
revoke all on function transfer_org_team_lead(uuid,uuid) from public,anon;
grant execute on function transfer_org_team_lead(uuid,uuid) to authenticated;

create or replace function notify_calendar_response() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text; v_organizer uuid; v_name text;
begin
 if new.response is distinct from old.response then
   select title,organizer_id into v_title,v_organizer from calendar_events where id=new.event_id;
   select full_name into v_name from employees where id=new.employee_id;
   if v_organizer is not null and v_organizer<>new.employee_id then
     insert into notifications(org_id,recipient_id,category,title,body,link,dedupe_key)
     values(new.org_id,v_organizer,'MEETINGS','Meeting response: '||coalesce(v_name,'An attendee'),coalesce(v_name,'An attendee')||' responded '||lower(new.response)||' to '||coalesce(v_title,'your meeting'),'/meetings','calendar-response:'||new.event_id::text||':'||new.employee_id::text||':'||new.response)
     on conflict(recipient_id,dedupe_key) do nothing;
   end if;
 end if;
 return new;
end $$;
create trigger calendar_response_notify after update of response on calendar_attendees for each row execute function notify_calendar_response();
revoke all on function notify_calendar_response() from public,anon,authenticated;

-- Atomic event + attendee creation: an event is never left half-created when an invite fails.
create or replace function create_calendar_event(
 p_title text,p_description text,p_event_type text,p_visibility text,p_starts_at timestamptz,p_ends_at timestamptz,
 p_location text default null,p_meeting_url text default null,p_department uuid default null,p_team uuid default null,p_attendees uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_org_id(); v_me uuid:=current_employee_id(); v_event uuid;
begin
 if v_me is null or not (has_perm('calendar.create') or has_perm('calendar.manage')) then raise exception 'calendar creation permission required' using errcode='42501'; end if;
 if length(trim(coalesce(p_title,'')))<2 or length(p_title)>200 or length(coalesce(p_description,''))>3000 or length(coalesce(p_location,''))>200 or coalesce(array_length(p_attendees,1),0)>100 or p_ends_at<=p_starts_at then raise exception 'invalid calendar event details'; end if;
 if p_visibility='DEPARTMENT' and p_department is null then raise exception 'department required for department event'; end if;
 if p_visibility='TEAM' and p_team is null then raise exception 'team required for team event'; end if;
 if exists(select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) a(id) left join employees e on e.id=a.id and e.org_id=v_org and e.status<>'EXITED' where e.id is null) then raise exception 'all invitees must be active employees in this organisation' using errcode='23514'; end if;
 insert into calendar_events(org_id,title,description,event_type,visibility,starts_at,ends_at,location,meeting_url,department_id,team_id,organizer_id)
 values(v_org,trim(p_title),nullif(p_description,''),p_event_type,p_visibility,p_starts_at,p_ends_at,nullif(p_location,''),nullif(p_meeting_url,''),p_department,p_team,v_me)
 returning id into v_event;
 insert into calendar_attendees(event_id,org_id,employee_id,response)
 select v_event,v_org,a.employee_id,case when a.employee_id=v_me then 'ACCEPTED' else 'NEEDS_ACTION' end
 from (select distinct unnest(array_append(coalesce(p_attendees,'{}'::uuid[]),v_me)) as employee_id) a;
 perform _audit(v_org,'calendar.event.created','calendar_event',v_event::text,jsonb_build_object('event_type',p_event_type,'visibility',p_visibility,'attendee_count',coalesce(array_length(p_attendees,1),0)));
 return v_event;
end $$;
revoke all on function create_calendar_event(text,text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,uuid[]) from public,anon;
grant execute on function create_calendar_event(text,text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,uuid[]) to authenticated;
