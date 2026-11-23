-- =============================================================================
-- 0025 — One source of truth for "today's punches".
-- record_attendance() decides with the organisation's timezone; the screens now read through the
-- SAME definition, so the clock can never show "Not clocked in" while the button says "Already clocked in".
-- =============================================================================
create or replace function attendance_day_start(p_org uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select (date_trunc('day', now() at time zone tz)) at time zone tz
  from (select coalesce((select timezone from organizations where id = p_org), 'Asia/Kolkata') tz) x
$$;
grant execute on function attendance_day_start(uuid) to authenticated;

create or replace function my_attendance_today()
returns table(event_type attendance_event_type, occurred_at timestamptz, source text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.event_type, a.occurred_at, a.source from attendance_events a
  where a.employee_id = current_employee_id() and a.occurred_at >= attendance_day_start(current_org_id())
  order by a.occurred_at, a.created_at
$$;
grant execute on function my_attendance_today() to authenticated;

-- Friendlier, state-aware messages (same rules as before).
create or replace function record_attendance(p_type attendance_event_type, p_source text default 'WEB')
returns attendance_events language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_emp uuid := current_employee_id();
  v_org uuid := current_org_id();
  v_last attendance_events;
  v_row attendance_events;
begin
  if v_emp is null then raise exception 'Your login is not linked to an active employee profile.' using errcode='42501'; end if;
  if p_source not in ('WEB','MOBILE') then raise exception 'invalid source'; end if;
  perform pg_advisory_xact_lock(hashtext(v_emp::text));
  select * into v_last from attendance_events
   where employee_id = v_emp and occurred_at >= attendance_day_start(v_org)
   order by occurred_at desc, created_at desc limit 1;

  if v_last.id is not null and now() - v_last.created_at < interval '30 seconds' then
    raise exception 'Saved a moment ago — wait a few seconds before the next punch.' using errcode='P0001';
  end if;
  if p_type = 'CLOCK_IN' and v_last.id is not null and v_last.event_type <> 'CLOCK_OUT' then
    raise exception 'You are already clocked in (since %).', to_char(v_last.occurred_at at time zone
      coalesce((select timezone from organizations where id = v_org), 'Asia/Kolkata'), 'HH24:MI') using errcode='P0001';
  elsif p_type = 'CLOCK_OUT' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    if v_last.event_type = 'BREAK_START' then raise exception 'End your break before clocking out.' using errcode='P0001'; end if;
    raise exception 'You are not clocked in.' using errcode='P0001';
  elsif p_type = 'BREAK_START' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    raise exception 'Clock in before starting a break.' using errcode='P0001';
  elsif p_type = 'BREAK_END' and (v_last.id is null or v_last.event_type <> 'BREAK_START') then
    raise exception 'No break in progress.' using errcode='P0001';
  end if;

  insert into attendance_events(org_id, employee_id, event_type, occurred_at, source, created_by)
  values (v_org, v_emp, p_type, date_trunc('second', now()), p_source, v_emp)
  returning * into v_row;
  return v_row;
end $$;
