-- =============================================================================
-- 0032 · Block 25 — Performance & growth: OKRs (company → team → personal) with check-ins, KPI definitions per post
-- (auto-calculated from tasks/attendance/CRM/Scholars where possible, manual + verified otherwise), 360° review
-- cycles with anonymous peer feedback, and training records.
-- =============================================================================

-- ---------- OKRs ----------
create table if not exists okr_objectives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 200),
  description text check (length(description) <= 2000),
  level text not null check (level in ('COMPANY','TEAM','PERSONAL')),
  team_id uuid references org_teams(id) on delete cascade,
  owner_id uuid not null references employees(id),
  parent_id uuid references okr_objectives(id) on delete set null,
  period_start date not null, period_end date not null,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','CLOSED')),
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check ((level = 'TEAM') = (team_id is not null))
);
create index if not exists okr_objectives_period on okr_objectives(org_id, period_start, period_end);
create table if not exists okr_key_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  objective_id uuid not null references okr_objectives(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 200),
  metric text not null default 'NUMBER' check (metric in ('NUMBER','PERCENT','CURRENCY','BOOLEAN')),
  start_value numeric(14,2) not null default 0,
  target_value numeric(14,2) not null,
  current_value numeric(14,2) not null default 0,
  unit text check (length(unit) <= 20),
  weight int not null default 1 check (weight between 1 and 10),
  owner_id uuid references employees(id) on delete set null,
  confidence text not null default 'ON_TRACK' check (confidence in ('ON_TRACK','AT_RISK','OFF_TRACK')),
  updated_at timestamptz not null default now(),
  check (target_value <> start_value)
);
create table if not exists okr_checkins (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  key_result_id uuid not null references okr_key_results(id) on delete cascade,
  value numeric(14,2) not null,
  confidence text not null check (confidence in ('ON_TRACK','AT_RISK','OFF_TRACK')),
  note text check (length(note) <= 1000),
  author_id uuid not null references employees(id),
  created_at timestamptz not null default now()
);
drop trigger if exists okr_objectives_touch on okr_objectives;
create trigger okr_objectives_touch before update on okr_objectives for each row execute function touch_updated_at();

-- Progress 0–100 for one key result (works for "lower is better" KRs where target < start).
create or replace function okr_kr_progress(p_start numeric, p_target numeric, p_current numeric) returns numeric
language sql immutable as $$
  select round(greatest(0, least(1, (p_current - p_start) / nullif(p_target - p_start, 0))) * 100, 1)
$$;
create or replace function okr_objective_progress(p_objective uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select round(sum(okr_kr_progress(start_value, target_value, current_value) * weight) / nullif(sum(weight), 0), 1)
    from okr_key_results where objective_id = p_objective
$$;
grant execute on function okr_kr_progress(numeric, numeric, numeric), okr_objective_progress(uuid) to authenticated;

-- Who may edit an objective: OKR managers for anything; team leads/managers for their team; the owner and the
-- owner's managers for personal OKRs.
create or replace function can_edit_objective(p_objective uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from okr_objectives o where o.id = p_objective and o.org_id = current_org_id() and (
    has_perm('okr.manage')
    or (o.level = 'TEAM' and exists (select 1 from org_team_members m where m.team_id = o.team_id
          and m.employee_id = current_employee_id() and m.member_role in ('LEAD','MANAGER')))
    or (o.level = 'PERSONAL' and (o.owner_id = current_employee_id() or is_in_my_team(o.owner_id)))))
$$;
grant execute on function can_edit_objective(uuid) to authenticated;

alter table okr_objectives enable row level security;
alter table okr_key_results enable row level security;
alter table okr_checkins enable row level security;
-- Company and team OKRs are visible to everyone in the company (alignment); personal ones to the owner, their managers and HR/performance.
drop policy if exists okr_read on okr_objectives;
create policy okr_read on okr_objectives for select to authenticated using (org_id = current_org_id() and (
  level in ('COMPANY','TEAM') or owner_id = current_employee_id() or is_in_my_team(owner_id)
  or has_perm('performance.view_all') or has_perm('okr.manage')));
drop policy if exists okr_insert on okr_objectives;
create policy okr_insert on okr_objectives for insert to authenticated with check (org_id = current_org_id() and created_by = current_employee_id() and (
  has_perm('okr.manage')
  or (level = 'TEAM' and exists (select 1 from org_team_members m where m.team_id = okr_objectives.team_id
        and m.employee_id = current_employee_id() and m.member_role in ('LEAD','MANAGER')))
  or (level = 'PERSONAL' and (owner_id = current_employee_id() or is_in_my_team(owner_id)))));
drop policy if exists okr_update on okr_objectives;
create policy okr_update on okr_objectives for update to authenticated using (can_edit_objective(id)) with check (org_id = current_org_id());
drop policy if exists okr_delete on okr_objectives;
create policy okr_delete on okr_objectives for delete to authenticated using (can_edit_objective(id) and status = 'DRAFT');
revoke update on okr_objectives from authenticated;
grant update (title, description, parent_id, period_start, period_end, status, owner_id) on okr_objectives to authenticated;

drop policy if exists kr_read on okr_key_results;
create policy kr_read on okr_key_results for select to authenticated
  using (org_id = current_org_id() and exists (select 1 from okr_objectives o where o.id = objective_id));
drop policy if exists kr_write on okr_key_results;
create policy kr_write on okr_key_results for all to authenticated
  using (org_id = current_org_id() and can_edit_objective(objective_id))
  with check (org_id = current_org_id() and can_edit_objective(objective_id));
revoke update on okr_key_results from authenticated;
grant update (title, metric, start_value, target_value, unit, weight, owner_id) on okr_key_results to authenticated;

drop policy if exists checkin_read on okr_checkins;
create policy checkin_read on okr_checkins for select to authenticated
  using (org_id = current_org_id() and exists (select 1 from okr_key_results k where k.id = key_result_id));
revoke insert, update, delete on okr_checkins from authenticated;

-- Check-in: the KR owner or anyone who can edit the objective. Updates the KR's current value.
create or replace function okr_checkin(p_kr uuid, p_value numeric, p_confidence text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k okr_key_results; o okr_objectives;
begin
  select * into k from okr_key_results where id = p_kr and org_id = current_org_id() for update;
  if k.id is null then raise exception 'Unknown key result.' using errcode = '42501'; end if;
  select * into o from okr_objectives where id = k.objective_id;
  if not (k.owner_id = current_employee_id() or can_edit_objective(o.id)) then
    raise exception 'Only the key result owner or the objective''s editors can check in.' using errcode = '42501';
  end if;
  if o.status <> 'ACTIVE' then raise exception 'This objective is not active.'; end if;
  if p_confidence not in ('ON_TRACK','AT_RISK','OFF_TRACK') then raise exception 'Unknown confidence.'; end if;
  if k.metric = 'BOOLEAN' and p_value not in (0, 1) then raise exception 'Use 0 (not done) or 1 (done).'; end if;
  insert into okr_checkins(org_id, key_result_id, value, confidence, note, author_id)
  values (k.org_id, k.id, p_value, p_confidence, nullif(trim(p_note), ''), current_employee_id());
  update okr_key_results set current_value = p_value, confidence = p_confidence, updated_at = now() where id = k.id;
  if o.owner_id <> current_employee_id() then
    perform notify(o.org_id, o.owner_id, 'PERFORMANCE', 'OKR check-in · ' || left(k.title, 80),
      p_confidence || coalesce(' — ' || left(p_note, 100), ''), '/performance/okrs?o=' || o.id, 'okr-ci-' || currval(pg_get_serial_sequence('okr_checkins','id')));
  end if;
end $$;
grant execute on function okr_checkin(uuid, numeric, text, text) to authenticated;

-- ---------- KPIs per post ----------
create table if not exists kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  designation_id uuid references designations(id) on delete cascade,  -- null = applies to everyone
  name text not null check (length(trim(name)) between 2 and 120),
  unit text check (length(unit) <= 20),
  direction text not null default 'HIGHER' check (direction in ('HIGHER','LOWER')),
  target numeric(14,2),
  source text not null default 'MANUAL' check (source in ('MANUAL','TASKS_COMPLETED','TASKS_ON_TIME_PCT','ATTENDANCE_DAYS',
    'DAILY_UPDATES','LEADS_CONTACTED','LEADS_WON','SCHOLAR_ADMISSIONS','PROJECT_HOURS','TASK_QUALITY_AVG')),
  weight int not null default 1 check (weight between 1 and 10),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists kpi_definitions_uq on kpi_definitions(org_id, coalesce(designation_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists kpi_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kpi_id uuid not null references kpi_definitions(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  value numeric(14,2) not null,
  source text not null default 'MANUAL' check (source in ('MANUAL','AUTO')),
  note text check (length(note) <= 500),
  entered_by uuid references employees(id),
  verified_by uuid references employees(id), verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (kpi_id, employee_id, period_month),
  check (verified_by is null or verified_by <> employee_id)
);

-- Auto value for one employee and month. Pure read of existing records; never writes.
create or replace function kpi_auto_value(p_source text, p_emp uuid, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v numeric; tz text;
begin
  select o.timezone into tz from employees e join organizations o on o.id = e.org_id where e.id = p_emp;
  tz := coalesce(tz, 'Asia/Kolkata');
  case p_source
    when 'TASKS_COMPLETED' then
      select count(*) into v from tasks where assignee_id = p_emp and status = 'COMPLETED'
        and (completed_at at time zone tz)::date between p_start and p_end;
    when 'TASKS_ON_TIME_PCT' then
      select round(100.0 * count(*) filter (where deadline is null or completed_at <= deadline) / nullif(count(*), 0), 1) into v
        from tasks where assignee_id = p_emp and status = 'COMPLETED' and (completed_at at time zone tz)::date between p_start and p_end;
    when 'TASK_QUALITY_AVG' then
      select round(avg(quality_score), 1) into v from tasks where assignee_id = p_emp and status = 'COMPLETED'
        and quality_score is not null and (completed_at at time zone tz)::date between p_start and p_end;
    when 'ATTENDANCE_DAYS' then
      select count(distinct (occurred_at at time zone tz)::date) into v from attendance_events
        where employee_id = p_emp and event_type = 'CLOCK_IN' and (occurred_at at time zone tz)::date between p_start and p_end;
    when 'DAILY_UPDATES' then
      select count(*) into v from daily_updates where employee_id = p_emp and work_date between p_start and p_end;
    when 'LEADS_CONTACTED' then
      select count(distinct lead_id) into v from lead_activities where actor_id = p_emp and kind in ('CALL','EMAIL','MEETING','NOTE')
        and (created_at at time zone tz)::date between p_start and p_end;
    when 'LEADS_WON' then
      select count(distinct l.id) into v from leads l join lead_activities a on a.lead_id = l.id and a.kind = 'STATUS'
        where l.assigned_to = p_emp and l.status = 'WON' and (a.created_at at time zone tz)::date between p_start and p_end;
    when 'SCHOLAR_ADMISSIONS' then
      select count(*) into v from scholar_enrollments en join scholar_students s on s.id = en.student_id
        where coalesce(s.counsellor_id, en.created_by) = p_emp and (en.enrolled_at at time zone tz)::date between p_start and p_end;
    when 'PROJECT_HOURS' then
      select coalesce(sum(hours), 0) into v from project_time_entries where employee_id = p_emp and status = 'APPROVED'
        and work_date between p_start and p_end;
    else v := null;
  end case;
  return v;
end $$;
revoke all on function kpi_auto_value(text, uuid, date, date) from public, anon, authenticated;

-- Recalculate AUTO KPI values for a month (default: this month). KPI managers, or the scheduler (service role).
create or replace function kpi_refresh(p_org uuid, p_month date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_start date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
        v_end date := (date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date)) + interval '1 month - 1 day')::date;
        r record; v numeric; n int := 0;
begin
  if auth.uid() is not null and not (p_org = current_org_id() and has_perm('kpi.manage')) then
    raise exception 'Only KPI managers can recalculate KPIs.' using errcode = '42501';
  end if;
  for r in select k.id as kpi_id, k.source, e.id as emp from kpi_definitions k
             join employees e on e.org_id = k.org_id and e.status <> 'EXITED'
              and (k.designation_id is null or exists (select 1 from designations d where d.id = k.designation_id and lower(d.title) = lower(e.designation)))
            where k.org_id = p_org and k.is_active and k.source <> 'MANUAL' loop
    v := kpi_auto_value(r.source, r.emp, v_start, v_end);
    if v is null then continue; end if;
    insert into kpi_values(org_id, kpi_id, employee_id, period_month, value, source)
    values (p_org, r.kpi_id, r.emp, v_start, v, 'AUTO')
    on conflict (kpi_id, employee_id, period_month) do update set value = excluded.value, updated_at = now()
      where kpi_values.source = 'AUTO';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function kpi_refresh(uuid, date) from public, anon;
grant execute on function kpi_refresh(uuid, date) to authenticated;

alter table kpi_definitions enable row level security;
alter table kpi_values enable row level security;
drop policy if exists kpi_def_read on kpi_definitions;
create policy kpi_def_read on kpi_definitions for select to authenticated using (org_id = current_org_id());
drop policy if exists kpi_def_write on kpi_definitions;
create policy kpi_def_write on kpi_definitions for all to authenticated
  using (org_id = current_org_id() and has_perm('kpi.manage')) with check (org_id = current_org_id() and has_perm('kpi.manage'));
drop policy if exists kpi_val_read on kpi_values;
create policy kpi_val_read on kpi_values for select to authenticated using (org_id = current_org_id() and (
  employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('performance.view_all') or has_perm('kpi.manage')));
-- Manual values: the employee (unverified), their managers, or KPI managers. AUTO values only come from kpi_refresh().
drop policy if exists kpi_val_insert on kpi_values;
create policy kpi_val_insert on kpi_values for insert to authenticated with check (org_id = current_org_id() and source = 'MANUAL'
  and entered_by = current_employee_id() and verified_by is null and verified_at is null
  and (employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('kpi.manage'))
  and exists (select 1 from kpi_definitions k where k.id = kpi_id and k.source = 'MANUAL' and k.org_id = current_org_id()));
drop policy if exists kpi_val_update on kpi_values;
create policy kpi_val_update on kpi_values for update to authenticated
  using (org_id = current_org_id() and source = 'MANUAL' and verified_at is null
         and (employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('kpi.manage')))
  with check (org_id = current_org_id() and source = 'MANUAL');
revoke update on kpi_values from authenticated;
grant update (value, note, entered_by) on kpi_values to authenticated;

create or replace function kpi_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v kpi_values;
begin
  select * into v from kpi_values where id = p_id and org_id = current_org_id() for update;
  if v.id is null then raise exception 'Unknown KPI value.' using errcode = '42501'; end if;
  if v.employee_id = current_employee_id() then raise exception 'You can''t verify your own KPI.' using errcode = '42501'; end if;
  if not (is_in_my_team(v.employee_id) or has_perm('kpi.manage')) then raise exception 'Only their manager can verify.' using errcode = '42501'; end if;
  update kpi_values set verified_by = current_employee_id(), verified_at = now() where id = p_id;
end $$;
grant execute on function kpi_verify(uuid) to authenticated;

-- ---------- 360° reviews ----------
create table if not exists review_cycles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 3 and 120),
  period_start date not null, period_end date not null,
  questions jsonb not null default '[{"key":"quality","label":"Quality of work"},{"key":"ownership","label":"Ownership & reliability"},{"key":"communication","label":"Communication"},{"key":"teamwork","label":"Teamwork & helpfulness"},{"key":"growth","label":"Learning & growth"}]',
  anonymous_peers boolean not null default true,
  peers_per_person int not null default 2 check (peers_per_person between 0 and 6),
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','CLOSED')),
  due_on date,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start), check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 12)
);
create table if not exists review_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  cycle_id uuid not null references review_cycles(id) on delete cascade,
  subject_id uuid not null references employees(id) on delete cascade,
  reviewer_id uuid not null references employees(id) on delete cascade,
  relation text not null check (relation in ('SELF','MANAGER','PEER','REPORT')),
  status text not null default 'PENDING' check (status in ('PENDING','SUBMITTED','DECLINED')),
  ratings jsonb, strengths text check (length(strengths) <= 3000), improvements text check (length(improvements) <= 3000),
  submitted_at timestamptz,
  unique (cycle_id, subject_id, reviewer_id),
  check ((relation = 'SELF') = (subject_id = reviewer_id))
);
alter table review_cycles enable row level security;
alter table review_assignments enable row level security;
drop policy if exists cycles_read on review_cycles;
create policy cycles_read on review_cycles for select to authenticated using (org_id = current_org_id() and (status <> 'DRAFT' or has_perm('reviews.manage')));
drop policy if exists cycles_write on review_cycles;
create policy cycles_write on review_cycles for all to authenticated
  using (org_id = current_org_id() and has_perm('reviews.manage'))
  with check (org_id = current_org_id() and has_perm('reviews.manage') and status = 'DRAFT');
revoke update on review_cycles from authenticated;
grant update (name, period_start, period_end, questions, anonymous_peers, peers_per_person, due_on) on review_cycles to authenticated;
-- Reviewers see only their own forms. Subjects never read raw rows — they get review_summary(), which hides peers.
drop policy if exists assignments_read on review_assignments;
create policy assignments_read on review_assignments for select to authenticated
  using (org_id = current_org_id() and (reviewer_id = current_employee_id() or has_perm('reviews.manage')));
revoke insert, update, delete on review_assignments from authenticated;

create or replace function review_cycle_open(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare c review_cycles; e record; p record; n int := 0;
begin
  select * into c from review_cycles where id = p_cycle and org_id = current_org_id() for update;
  if c.id is null or not has_perm('reviews.manage') then raise exception 'Only HR can open review cycles.' using errcode = '42501'; end if;
  if c.status <> 'DRAFT' then raise exception 'This cycle is already open.'; end if;
  for e in select id, manager_id from employees where org_id = c.org_id and status <> 'EXITED' and role <> 'SUPER_ADMIN' loop
    insert into review_assignments(org_id, cycle_id, subject_id, reviewer_id, relation) values (c.org_id, c.id, e.id, e.id, 'SELF') on conflict do nothing;
    if e.manager_id is not null then
      insert into review_assignments(org_id, cycle_id, subject_id, reviewer_id, relation) values (c.org_id, c.id, e.id, e.manager_id, 'MANAGER') on conflict do nothing;
    end if;
    insert into review_assignments(org_id, cycle_id, subject_id, reviewer_id, relation)
      select c.org_id, c.id, e.id, r.id, 'REPORT' from employees r where r.manager_id = e.id and r.status <> 'EXITED' on conflict do nothing;
    for p in select distinct m2.employee_id as id from org_team_members m1 join org_team_members m2 on m2.team_id = m1.team_id
               join employees pe on pe.id = m2.employee_id and pe.status <> 'EXITED'
              where m1.employee_id = e.id and m2.employee_id <> e.id
                and m2.employee_id is distinct from e.manager_id
                and not exists (select 1 from employees r where r.id = m2.employee_id and r.manager_id = e.id)
              order by 1 limit c.peers_per_person loop
      insert into review_assignments(org_id, cycle_id, subject_id, reviewer_id, relation) values (c.org_id, c.id, e.id, p.id, 'PEER') on conflict do nothing;
    end loop;
  end loop;
  update review_cycles set status = 'OPEN' where id = c.id;
  for e in select reviewer_id, count(*) as k from review_assignments where cycle_id = c.id group by reviewer_id loop
    perform notify(c.org_id, e.reviewer_id, 'PERFORMANCE', '360° review open · ' || c.name,
      e.k || ' form' || case when e.k > 1 then 's' else '' end || ' to fill' || coalesce(' by ' || to_char(c.due_on, 'DD Mon'), ''),
      '/performance/reviews', 'rev-open-' || c.id);
    n := n + e.k;
  end loop;
  perform log_audit('reviews.cycle_opened', 'review_cycle', c.id::text, jsonb_build_object('forms', n));
  return n;
end $$;

create or replace function review_cycle_close(p_cycle uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_perm('reviews.manage') then raise exception 'Only HR can close review cycles.' using errcode = '42501'; end if;
  update review_cycles set status = 'CLOSED' where id = p_cycle and org_id = current_org_id() and status = 'OPEN';
  if not found then raise exception 'Only open cycles can be closed.'; end if;
  perform log_audit('reviews.cycle_closed', 'review_cycle', p_cycle::text, '{}');
end $$;

create or replace function review_submit(p_assignment uuid, p_ratings jsonb, p_strengths text, p_improvements text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a review_assignments; c review_cycles; q jsonb; v numeric;
begin
  select * into a from review_assignments where id = p_assignment and reviewer_id = current_employee_id() for update;
  if a.id is null then raise exception 'This review form is not yours.' using errcode = '42501'; end if;
  select * into c from review_cycles where id = a.cycle_id;
  if c.status <> 'OPEN' then raise exception 'This review cycle is closed.'; end if;
  if jsonb_typeof(p_ratings) <> 'object' then raise exception 'Ratings missing.'; end if;
  for q in select * from jsonb_array_elements(c.questions) loop
    v := (p_ratings ->> (q ->> 'key'))::numeric;
    if v is null or v < 1 or v > 5 or v <> trunc(v) then raise exception 'Rate "%" from 1 to 5.', q ->> 'label'; end if;
  end loop;
  if length(trim(coalesce(p_strengths, ''))) < 3 then raise exception 'Write at least one strength.'; end if;
  update review_assignments set ratings = (select jsonb_object_agg(q2 ->> 'key', (p_ratings ->> (q2 ->> 'key'))::int) from jsonb_array_elements(c.questions) q2),
         strengths = trim(p_strengths), improvements = nullif(trim(p_improvements), ''), status = 'SUBMITTED', submitted_at = now()
   where id = a.id;
end $$;

-- Summary for one person. The subject sees it only after the cycle closes; peers and reports are anonymous
-- (and their comments are shown only when at least 2 such reviewers responded). Managers in the reporting line
-- and HR can see it any time; HR (reviews.manage) also sees who wrote what.
create or replace function review_summary(p_cycle uuid, p_subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c review_cycles; v_hr boolean := has_perm('reviews.manage'); v_anon_n int; v_out jsonb;
begin
  select * into c from review_cycles where id = p_cycle and org_id = current_org_id();
  if c.id is null then return null; end if;
  if not (v_hr or is_in_my_team(p_subject) or (p_subject = current_employee_id() and c.status = 'CLOSED')) then
    raise exception 'You can''t see this review yet.' using errcode = '42501';
  end if;
  select count(*) into v_anon_n from review_assignments where cycle_id = c.id and subject_id = p_subject
     and relation in ('PEER','REPORT') and status = 'SUBMITTED';
  select jsonb_build_object(
    'cycle', c.name, 'status', c.status, 'questions', c.questions,
    'by_relation', coalesce((select jsonb_object_agg(rel, avgs) from (
        select relation as rel, jsonb_object_agg(k, round(av, 2)) as avgs from (
          select a.relation, r.key as k, avg(r.value::numeric) as av
            from review_assignments a, jsonb_each_text(a.ratings) r
           where a.cycle_id = c.id and a.subject_id = p_subject and a.status = 'SUBMITTED'
             and (a.relation not in ('PEER','REPORT') or v_anon_n >= 2 or v_hr)
           group by a.relation, r.key) s group by relation) t), '{}'),
    'responses', (select count(*) from review_assignments where cycle_id = c.id and subject_id = p_subject and status = 'SUBMITTED'),
    'expected', (select count(*) from review_assignments where cycle_id = c.id and subject_id = p_subject),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('relation', a.relation, 'strengths', a.strengths, 'improvements', a.improvements,
                  'by', case when v_hr or not c.anonymous_peers or a.relation in ('SELF','MANAGER')
                             then (select full_name from employees where id = a.reviewer_id) end)
                  order by a.relation, md5(a.id::text))
                  from review_assignments a where a.cycle_id = c.id and a.subject_id = p_subject and a.status = 'SUBMITTED'
                   and (a.relation not in ('PEER','REPORT') or v_anon_n >= 2 or v_hr)), '[]')
  ) into v_out;
  return v_out;
end $$;
grant execute on function review_cycle_open(uuid), review_cycle_close(uuid), review_submit(uuid, jsonb, text, text), review_summary(uuid, uuid) to authenticated;

-- ---------- Training records ----------
create table if not exists training_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 160),
  provider text check (length(provider) <= 120),
  kind text not null default 'COURSE' check (kind in ('COURSE','WORKSHOP','CERTIFICATION','INTERNAL','ON_THE_JOB')),
  status text not null default 'PLANNED' check (status in ('PLANNED','IN_PROGRESS','COMPLETED','DROPPED')),
  started_on date, completed_on date,
  hours numeric(6,1) check (hours between 0 and 2000),
  certificate_url text check (certificate_url is null or certificate_url ~ '^https://'),
  notes text check (length(notes) <= 1000),
  assigned_by uuid references employees(id),
  verified_by uuid references employees(id), verified_at timestamptz,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  check (completed_on is null or started_on is null or completed_on >= started_on),
  check (status <> 'COMPLETED' or completed_on is not null),
  check (verified_by is null or verified_by <> employee_id)
);
alter table training_records enable row level security;
drop policy if exists training_read on training_records;
create policy training_read on training_records for select to authenticated using (org_id = current_org_id() and (
  employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('training.manage') or has_perm('performance.view_all')));
drop policy if exists training_insert on training_records;
create policy training_insert on training_records for insert to authenticated with check (org_id = current_org_id()
  and created_by = current_employee_id() and verified_by is null and verified_at is null
  and (employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('training.manage')));
drop policy if exists training_update on training_records;
create policy training_update on training_records for update to authenticated
  using (org_id = current_org_id() and verified_at is null
         and (employee_id = current_employee_id() or is_in_my_team(employee_id) or has_perm('training.manage')))
  with check (org_id = current_org_id());
revoke update on training_records from authenticated;
grant update (title, provider, kind, status, started_on, completed_on, hours, certificate_url, notes) on training_records to authenticated;

create or replace function training_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t training_records;
begin
  select * into t from training_records where id = p_id and org_id = current_org_id() for update;
  if t.id is null then raise exception 'Unknown training record.' using errcode = '42501'; end if;
  if t.employee_id = current_employee_id() then raise exception 'You can''t verify your own training.' using errcode = '42501'; end if;
  if not (is_in_my_team(t.employee_id) or has_perm('training.manage')) then raise exception 'Only their manager or HR can verify.' using errcode = '42501'; end if;
  if t.status <> 'COMPLETED' then raise exception 'Only completed training can be verified.'; end if;
  update training_records set verified_by = current_employee_id(), verified_at = now() where id = p_id;
end $$;
grant execute on function training_verify(uuid) to authenticated;

create or replace function notify_training_assigned() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.employee_id <> new.created_by then
    update training_records set assigned_by = new.created_by where id = new.id;
    perform notify(new.org_id, new.employee_id, 'TRAINING', 'Training assigned · ' || left(new.title, 90),
      coalesce(new.provider, 'Internal'), '/performance/training', 'training-' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists training_records_assigned on training_records;
create trigger training_records_assigned after insert on training_records for each row execute function notify_training_assigned();

-- ---------- Permissions & seeds ----------
create or replace function seed_growth(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; k text; v_src text; v_unit text; v_dir text;
begin
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role::app_role, r.perm from (values
    ('ADMIN','okr.manage'),('ADMIN','kpi.manage'),('ADMIN','reviews.manage'),('ADMIN','training.manage'),
    ('OPERATIONS_MANAGER','okr.manage'),('OPERATIONS_MANAGER','kpi.manage'),
    ('HR_MANAGER','reviews.manage'),('HR_MANAGER','training.manage'),('HR_MANAGER','kpi.manage')) r(role, perm)
  on conflict do nothing;
  -- KPIs from each post's KPI list; known ones are calculated automatically from the app's own records.
  for d in select id, kpis from designations where org_id = p_org and is_active loop
    foreach k in array d.kpis loop
      v_src := case lower(k)
        when 'tasks closed on time' then 'TASKS_ON_TIME_PCT' when 'on-time delivery' then 'TASKS_ON_TIME_PCT'
        when 'delivery on time' then 'TASKS_ON_TIME_PCT' when 'report on time' then 'TASKS_ON_TIME_PCT'
        when 'tickets closed' then 'TASKS_COMPLETED' when 'release on time' then 'TASKS_ON_TIME_PCT'
        when 'leads contacted' then 'LEADS_CONTACTED' when 'conversions' then 'LEADS_WON'
        when 'admissions' then 'SCHOLAR_ADMISSIONS' when 'overdue tasks' then 'MANUAL'
        else 'MANUAL' end;
      v_unit := case when v_src = 'TASKS_ON_TIME_PCT' or k ilike '%rate%' or k ilike '%compliance%' then '%' end;
      v_dir := case when k ilike 'revisions%' or k ilike '%incidents%' or k ilike '%breaches%' or k ilike 'overdue%'
                      or k ilike 'time to%' or k ilike '%follow-up time%' then 'LOWER' else 'HIGHER' end;
      insert into kpi_definitions(org_id, designation_id, name, unit, direction, source)
      values (p_org, d.id, k, v_unit, v_dir, v_src) on conflict do nothing;
    end loop;
  end loop;
  -- Everyone: attendance days and daily updates.
  insert into kpi_definitions(org_id, designation_id, name, unit, source) values
    (p_org, null, 'Days present', 'days', 'ATTENDANCE_DAYS'), (p_org, null, 'Daily updates submitted', 'updates', 'DAILY_UPDATES')
  on conflict do nothing;
end $$;
revoke all on function seed_growth(uuid) from public, anon, authenticated;
do $$ declare o record; begin for o in select id from organizations loop perform seed_growth(o.id); end loop; end $$;

create or replace function seed_growth_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_growth(new.org_id); end if;
  return new;
end $$;
-- "employees_seed_t…" sorts after "employees_seed_scholars", so posts exist before their KPIs are copied.
drop trigger if exists employees_seed_training_growth on employees;
create trigger employees_seed_training_growth after insert on employees for each row execute function seed_growth_on_sa();

-- People in the signed-in person's reporting line (for pickers; RLS still decides what data is visible).
create or replace function my_team_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(e.id), '{}') from employees e
   where e.org_id = current_org_id() and e.status <> 'EXITED' and e.id <> current_employee_id() and is_in_my_team(e.id)
$$;
revoke all on function my_team_ids() from public, anon;
grant execute on function my_team_ids() to authenticated;
