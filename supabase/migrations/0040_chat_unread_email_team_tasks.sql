-- =============================================================================
-- 0040 · (A) Email people about chat messages unseen for 2+ hours. (B) Assign tasks to a whole team.
-- =============================================================================

-- ---------- (A) Unread chat reminder emails ----------
-- One email per person per batch: "You have N unread messages in X, Y". No message text in the email.
-- A person is emailed again only when NEW messages have waited 2 hours since the previous reminder.
-- Respects Notification settings → Chat → Email (muted / digest).
create table if not exists chat_unread_reminders (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  last_sent_at timestamptz not null
);
alter table chat_unread_reminders enable row level security;
revoke insert, update, delete on chat_unread_reminders from authenticated, anon;  -- RLS with no policy: nobody reads it from the app

create or replace function chat_send_unread_reminders(p_hours int default 2) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    with unread as (
      select mb.employee_id, c.org_id, c.id as channel_id, c.channel_type, c.name as channel_name,
             count(*) as cnt, min(m.created_at) as oldest, max(m.created_at) as newest
        from chat_channel_members mb
        join chat_channels c on c.id = mb.channel_id and c.archived_at is null
        join chat_messages m on m.channel_id = c.id and m.author_id <> mb.employee_id and m.deleted_at is null
                            and m.created_at > coalesce(mb.last_read_at, '-infinity'::timestamptz)
       group by mb.employee_id, c.org_id, c.id, c.channel_type, c.name)
    select u.employee_id, u.org_id, e.official_email, e.full_name, sum(u.cnt)::int as total,
           jsonb_agg(jsonb_build_object(
             'name', case when u.channel_type = 'DIRECT' then coalesce((
                       select o.full_name from chat_channel_members x join employees o on o.id = x.employee_id
                        where x.channel_id = u.channel_id and x.employee_id <> u.employee_id limit 1), 'Direct message')
                     else u.channel_name end,
             'count', u.cnt, 'channel_id', u.channel_id) order by u.newest desc) as chats
      from unread u
      join employees e on e.id = u.employee_id and e.status <> 'EXITED' and e.user_id is not null
      left join chat_unread_reminders rr on rr.employee_id = u.employee_id
     group by u.employee_id, u.org_id, e.official_email, e.full_name, rr.last_sent_at
    having min(u.oldest) < now() - make_interval(hours => p_hours)
       -- something new has waited the full time since the last reminder
       and bool_or(u.newest > coalesce(rr.last_sent_at, '-infinity'::timestamptz)
                   and exists (select 1 from chat_messages m2 where m2.channel_id = u.channel_id
                                 and m2.author_id <> u.employee_id and m2.deleted_at is null
                                 and m2.created_at > coalesce(rr.last_sent_at, '-infinity'::timestamptz)
                                 and m2.created_at < now() - make_interval(hours => p_hours)
                                 and m2.created_at > coalesce((select last_read_at from chat_channel_members z
                                                               where z.channel_id = u.channel_id and z.employee_id = u.employee_id), '-infinity'::timestamptz)))
  loop
    -- Sent straight away (not held for the daily digest); skipped only if the person muted chat emails.
    if not exists (select 1 from notification_preferences np where np.employee_id = r.employee_id
                    and np.category = 'CHAT' and np.channel = 'EMAIL' and np.mode = 'MUTED') then
      insert into email_outbox(org_id, to_email, recipient_employee_id, template, payload, dedupe_key, status)
      values (r.org_id, lower(trim(r.official_email)), r.employee_id, 'chat.unread_reminder',
              jsonb_build_object('name', split_part(r.full_name, ' ', 1), 'total', r.total, 'chats',
                (select jsonb_agg(x) from (select x from jsonb_array_elements(r.chats) x limit 5) s)),
              'chat-unread-' || r.employee_id || '-' || to_char(now(), 'YYYYMMDDHH24MI'), 'QUEUED')
      on conflict (org_id, dedupe_key) do nothing;
    end if;
    insert into chat_unread_reminders(employee_id, org_id, last_sent_at) values (r.employee_id, r.org_id, now())
    on conflict (employee_id) do update set last_sent_at = excluded.last_sent_at;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function chat_send_unread_reminders(int) from public, anon, authenticated;

-- ---------- (B) Team tasks ----------
alter table tasks add column if not exists team_id uuid references org_teams(id) on delete set null;
create index if not exists tasks_team_open on tasks(team_id) where team_id is not null and assignee_id is null;

-- HR can assign tasks as well (managers, admins and owners already can).
create or replace function seed_tasks_hr(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  values (p_org, 'HR_MANAGER', 'tasks.manage') on conflict do nothing
$$;
revoke all on function seed_tasks_hr(uuid) from public, anon, authenticated;
select seed_tasks_hr(id) from organizations;
create or replace function seed_tasks_hr_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_tasks_hr(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_x_tasks on employees;
create trigger employees_seed_x_tasks after insert on employees for each row execute function seed_tasks_hr_on_sa();

-- A shared (unclaimed) team task is visible to that team's members.
create or replace function can_see_task(t tasks) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select t.assignee_id = current_employee_id()
      or t.assigned_by = current_employee_id()
      or has_perm('tasks.view_all')
      or (has_perm('tasks.view_team') and t.assignee_id is not null and is_in_my_team(t.assignee_id))
      or (t.team_id is not null and exists (select 1 from org_team_members m where m.team_id = t.team_id and m.employee_id = current_employee_id()))
      or exists (select 1 from project_members pm where pm.project_id = t.project_id and pm.employee_id = current_employee_id())
      or exists (select 1 from projects p where p.id = t.project_id and p.manager_id = current_employee_id())
$$;

-- Who may give work to a whole team: its lead/manager, HR, admins and owners (all with tasks.manage).
create or replace function can_assign_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select has_perm('tasks.manage') and exists (select 1 from org_teams t where t.id = p_team and t.org_id = current_org_id())
     and (can_manage_team(p_team) or has_perm('tasks.view_all') or has_perm('people.manage'))
$$;
grant execute on function can_assign_team(uuid) to authenticated;

-- Same rules as before, plus: claiming a shared team task goes through claim_team_task() only.
create or replace function tasks_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_manager boolean;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('app.claiming', true), '') = 'on' then return new; end if;
  v_manager := has_perm('tasks.manage') and (new.assigned_by = v_me or has_perm('tasks.view_all') or is_in_my_team(new.assignee_id)
               or (new.team_id is not null and can_assign_team(new.team_id)));
  if tg_op = 'INSERT' then
    if not v_manager and new.assignee_id is distinct from v_me then
      raise exception 'tasks.manage required to assign work to others' using errcode='42501';
    end if;
    if new.team_id is not null and new.assignee_id is null and not can_assign_team(new.team_id) then
      raise exception 'You can''t give work to that team.' using errcode='42501';
    end if;
    new.assigned_by := v_me;
    new.quality_score := null; new.reviewed_by := null; new.reviewed_at := null;
    if new.status = 'COMPLETED' then new.status := 'TODO'; end if;
    return new;
  end if;
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
    if (new.title, new.description, new.assignee_id, new.deadline, new.priority, new.project_id, new.estimated_hours, new.team_id)
       is distinct from (old.title, old.description, old.assignee_id, old.deadline, old.priority, old.project_id, old.estimated_hours, old.team_id)
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

-- Create work for a team: 'EACH' = one task per member; 'SHARED' = one task anyone in the team can claim.
create or replace function create_team_task(p_team uuid, p_mode text, p_title text, p_description text, p_priority text,
                                            p_deadline timestamptz, p_estimate numeric, p_project uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); t org_teams; m record; n int := 0; v_id uuid;
begin
  select * into t from org_teams where id = p_team and org_id = current_org_id();
  if t.id is null or not can_assign_team(p_team) then raise exception 'You can''t give work to that team.' using errcode = '42501'; end if;
  if p_mode not in ('EACH','SHARED') then raise exception 'Choose how to assign the task.'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'Give the task a title.'; end if;
  if p_project is not null and not exists (select 1 from projects where id = p_project and org_id = current_org_id()) then
    raise exception 'Unknown project.';
  end if;
  if p_mode = 'EACH' then
    for m in select tm.employee_id from org_team_members tm join employees e on e.id = tm.employee_id and e.status <> 'EXITED'
              where tm.team_id = p_team and tm.employee_id <> v_me loop
      insert into tasks(org_id, title, description, assignee_id, assigned_by, team_id, project_id, priority, deadline, estimated_hours, status)
      values (t.org_id, trim(p_title), nullif(trim(p_description), ''), m.employee_id, v_me, p_team, p_project,
              coalesce(p_priority, 'MEDIUM')::priority_level, p_deadline, p_estimate, 'TODO');
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'That team has no other members yet.'; end if;
  else
    insert into tasks(org_id, title, description, assignee_id, assigned_by, team_id, project_id, priority, deadline, estimated_hours, status)
    values (t.org_id, trim(p_title), nullif(trim(p_description), ''), null, v_me, p_team, p_project,
            coalesce(p_priority, 'MEDIUM')::priority_level, p_deadline, p_estimate, 'TODO')
    returning id into v_id;
    for m in select tm.employee_id from org_team_members tm join employees e on e.id = tm.employee_id and e.status <> 'EXITED'
              where tm.team_id = p_team and tm.employee_id <> v_me loop
      perform notify(t.org_id, m.employee_id, 'TASKS', 'New team task · ' || t.name, trim(p_title) || ' — first to claim it owns it.',
                     '/tasks?view=open', 'team-task:' || v_id || ':' || m.employee_id);
    end loop;
    n := 1;
  end if;
  perform log_audit('task.team_created', 'org_team', p_team::text, jsonb_build_object('mode', p_mode, 'tasks', n));
  return n;
end $$;

-- A team member takes a shared task.
create or replace function claim_team_task(p_task uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare tk tasks;
begin
  select * into tk from tasks where id = p_task and org_id = current_org_id() for update;
  if tk.id is null or tk.team_id is null then raise exception 'Unknown task.' using errcode = '42501'; end if;
  if not exists (select 1 from org_team_members where team_id = tk.team_id and employee_id = current_employee_id()) then
    raise exception 'Only members of that team can claim it.' using errcode = '42501';
  end if;
  if tk.assignee_id is not null then raise exception 'Someone already claimed this task.'; end if;
  if tk.status in ('COMPLETED','CANCELLED') then raise exception 'This task is closed.'; end if;
  perform set_config('app.claiming', 'on', true);
  update tasks set assignee_id = current_employee_id() where id = p_task;
  perform set_config('app.claiming', 'off', true);
  if tk.assigned_by is not null and tk.assigned_by <> current_employee_id() then
    perform notify(tk.org_id, tk.assigned_by, 'TASKS', 'Claimed · ' || tk.title,
      (select full_name from employees where id = current_employee_id()) || ' took this team task.', '/tasks?focus=' || tk.id,
      'task-claimed:' || tk.id);
  end if;
end $$;
revoke all on function create_team_task(uuid, text, text, text, text, timestamptz, numeric, uuid), claim_team_task(uuid) from public, anon;
grant execute on function create_team_task(uuid, text, text, text, text, timestamptz, numeric, uuid), claim_team_task(uuid) to authenticated;

-- ---------- (C) Salary day ----------
-- Day of the month salary is paid. Default = the day of (joining date + 7 days): joins 1 Jan → paid on the 8th.
-- HR can set it when adding someone or edit it later. Short months pay on their last day (31 → 28/29 Feb, 30 Apr…).
alter table employees add column if not exists salary_day smallint check (salary_day between 1 and 31);
create or replace function default_salary_day(p_joining date) returns smallint language sql immutable as $$
  select extract(day from coalesce(p_joining, current_date) + 7)::smallint
$$;
create or replace function set_salary_day() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Only HR / payroll choose a custom day; everyone else gets the default.
    if new.salary_day is null or (auth.uid() is not null and not (has_perm('people.manage') or has_perm('payroll.manage'))) then
      new.salary_day := default_salary_day(new.joining_date);
    end if;
  elsif new.joining_date is distinct from old.joining_date and new.salary_day is not distinct from old.salary_day
        and old.salary_day = default_salary_day(old.joining_date) then
    new.salary_day := default_salary_day(new.joining_date);   -- was on the default: follow the new joining date
  elsif new.salary_day is null then
    new.salary_day := default_salary_day(new.joining_date);
  end if;
  return new;
end $$;
drop trigger if exists employees_salary_day on employees;
create trigger employees_salary_day before insert or update of salary_day, joining_date on employees
  for each row execute function set_salary_day();
update employees set salary_day = default_salary_day(joining_date) where salary_day is null;

-- Next salary date on or after p_from for a pay day (clamped to the month's last day).
create or replace function next_salary_date(p_day int, p_from date default current_date) returns date
language sql immutable as $$
  with m as (select date_trunc('month', p_from)::date as m0),
  c as (select least(p_day, extract(day from (m0 + interval '1 month - 1 day'))::int) as d0,
               least(p_day, extract(day from (m0 + interval '2 month - 1 day'))::int) as d1, m0 from m)
  select case when (m0 + d0 - 1) >= p_from then m0 + d0 - 1
              else (m0 + interval '1 month')::date + d1 - 1 end from c
$$;
grant execute on function default_salary_day(date), next_salary_date(int, date) to authenticated;
