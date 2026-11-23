-- =============================================================================
-- 0028 · Block 20 — field attendance: office geofences, selfie-on-punch, offline punches, review of flagged punches.
-- =============================================================================
create table if not exists attendance_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  geofence_mode text not null default 'WARN' check (geofence_mode in ('OFF','WARN','ENFORCE')),
  selfie_mode text not null default 'OFF' check (selfie_mode in ('OFF','OPTIONAL','REQUIRED')),
  require_location boolean not null default false,
  allow_offline boolean not null default true,
  offline_max_hours int not null default 12 check (offline_max_hours between 1 and 48),
  updated_by uuid references employees(id), updated_at timestamptz not null default now()
);
create table if not exists office_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  address text check (length(address) <= 300),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  radius_m int not null default 150 check (radius_m between 30 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table employees add column if not exists remote_allowed boolean not null default false;
alter table attendance_events add column if not exists latitude numeric(9,6);
alter table attendance_events add column if not exists longitude numeric(9,6);
alter table attendance_events add column if not exists accuracy_m int;
alter table attendance_events add column if not exists office_id uuid references office_locations(id) on delete set null;
alter table attendance_events add column if not exists distance_m int;
alter table attendance_events add column if not exists inside_geofence boolean;
alter table attendance_events add column if not exists selfie_path text;
alter table attendance_events add column if not exists offline boolean not null default false;
alter table attendance_events add column if not exists client_occurred_at timestamptz;
alter table attendance_events add column if not exists flag text;
alter table attendance_events add column if not exists reviewed_by uuid references employees(id);
alter table attendance_events add column if not exists reviewed_at timestamptz;
alter table attendance_events add column if not exists review_note text;
create index if not exists attendance_flagged_idx on attendance_events(org_id, occurred_at desc) where flag is not null and reviewed_at is null;

alter table attendance_settings enable row level security;
alter table office_locations enable row level security;
drop policy if exists attendance_settings_read on attendance_settings;
create policy attendance_settings_read on attendance_settings for select to authenticated using (org_id = current_org_id());
drop policy if exists attendance_settings_write on attendance_settings;
create policy attendance_settings_write on attendance_settings for all to authenticated
  using (org_id = current_org_id() and has_perm('attendance.manage')) with check (org_id = current_org_id() and has_perm('attendance.manage'));
drop policy if exists offices_read on office_locations;
create policy offices_read on office_locations for select to authenticated using (org_id = current_org_id());
drop policy if exists offices_write on office_locations;
create policy offices_write on office_locations for all to authenticated
  using (org_id = current_org_id() and has_perm('attendance.manage')) with check (org_id = current_org_id() and has_perm('attendance.manage'));

insert into attendance_settings(org_id) select id from organizations on conflict do nothing;

-- Great-circle distance in metres.
create or replace function distance_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns int
language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lon2 - lon1) / 2)), 2))))::int
$$;

create or replace function record_attendance_v2(
  p_type attendance_event_type, p_source text default 'WEB',
  p_lat numeric default null, p_lng numeric default null, p_accuracy int default null,
  p_selfie_path text default null, p_offline_at timestamptz default null
) returns attendance_events language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_emp employees; v_org uuid := current_org_id();
  s attendance_settings; v_last attendance_events; v_row attendance_events;
  v_office office_locations; v_dist int; v_inside boolean; v_flag text; v_at timestamptz := date_trunc('second', now());
  v_offline boolean := false; v_tz text;
begin
  select * into v_emp from employees where id = current_employee_id() and status <> 'EXITED';
  if v_emp.id is null then raise exception 'Your login is not linked to an active employee profile.' using errcode='42501'; end if;
  if p_source not in ('WEB','MOBILE') then raise exception 'invalid source'; end if;
  select * into s from attendance_settings where org_id = v_org;
  if s.org_id is null then s.geofence_mode := 'WARN'; s.selfie_mode := 'OFF'; s.require_location := false; s.allow_offline := true; s.offline_max_hours := 12; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from organizations where id = v_org;
  perform pg_advisory_xact_lock(hashtext(v_emp.id::text));

  -- Offline punch: the phone saved it while there was no internet. Accepted within the window, always flagged.
  if p_offline_at is not null then
    if not s.allow_offline then raise exception 'Offline punches are switched off. Punch again now.' using errcode='P0001'; end if;
    if p_offline_at > now() + interval '2 minutes' or p_offline_at < now() - make_interval(hours => s.offline_max_hours) then
      raise exception 'That offline punch is too old to accept. Ask your manager for a correction.' using errcode='P0001';
    end if;
    v_at := date_trunc('second', p_offline_at); v_offline := true; v_flag := 'Offline punch';
  end if;

  select * into v_last from attendance_events
   where employee_id = v_emp.id and occurred_at >= attendance_day_start(v_org)
   order by occurred_at desc, created_at desc limit 1;
  if v_offline and v_last.id is not null and v_at <= v_last.occurred_at then
    raise exception 'That offline punch is older than your last punch.' using errcode='P0001';
  end if;
  if not v_offline and v_last.id is not null and now() - v_last.created_at < interval '30 seconds' then
    raise exception 'Saved a moment ago — wait a few seconds before the next punch.' using errcode='P0001';
  end if;
  if p_type = 'CLOCK_IN' and v_last.id is not null and v_last.event_type <> 'CLOCK_OUT' then
    raise exception 'You are already clocked in (since %).', to_char(v_last.occurred_at at time zone v_tz, 'HH24:MI') using errcode='P0001';
  elsif p_type = 'CLOCK_OUT' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    if v_last.event_type = 'BREAK_START' then raise exception 'End your break before clocking out.' using errcode='P0001'; end if;
    raise exception 'You are not clocked in.' using errcode='P0001';
  elsif p_type = 'BREAK_START' and (v_last.id is null or v_last.event_type not in ('CLOCK_IN','BREAK_END')) then
    raise exception 'Clock in before starting a break.' using errcode='P0001';
  elsif p_type = 'BREAK_END' and (v_last.id is null or v_last.event_type <> 'BREAK_START') then
    raise exception 'No break in progress.' using errcode='P0001';
  end if;

  -- Location & geofence (only for clock-in / clock-out).
  if p_lat is not null and p_lng is not null then
    if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'invalid location'; end if;
    select o.* into v_office from office_locations o where o.org_id = v_org and o.is_active
     order by distance_m(p_lat, p_lng, o.latitude, o.longitude) limit 1;
    if v_office.id is not null then
      v_dist := distance_m(p_lat, p_lng, v_office.latitude, v_office.longitude);
      v_inside := v_dist <= v_office.radius_m + least(coalesce(p_accuracy, 0), 100);
    end if;
  elsif s.require_location and p_type in ('CLOCK_IN','CLOCK_OUT') and not v_offline then
    raise exception 'Location is required to punch. Allow location access in your browser and try again.' using errcode='P0001';
  end if;
  if p_type in ('CLOCK_IN','CLOCK_OUT') and v_office.id is not null and not coalesce(v_inside, false) and not v_emp.remote_allowed then
    if s.geofence_mode = 'ENFORCE' and not v_offline then
      raise exception 'You are % m from %. Punch from the office, or ask your manager for a remote-work correction.', v_dist, v_office.name using errcode='P0001';
    elsif s.geofence_mode <> 'OFF' then
      v_flag := concat_ws(' · ', v_flag, format('Outside %s (%s m)', v_office.name, v_dist));
    end if;
  end if;
  if p_type in ('CLOCK_IN','CLOCK_OUT') and v_office.id is null and s.geofence_mode <> 'OFF' and p_lat is null
     and exists (select 1 from office_locations where org_id = v_org and is_active) and not v_emp.remote_allowed then
    v_flag := concat_ws(' · ', v_flag, 'No location shared');
  end if;

  -- Selfie (stored privately in attendance-selfies/<org>/<employee>/…).
  if p_selfie_path is not null and p_selfie_path not like v_org::text || '/' || v_emp.id::text || '/%' then
    raise exception 'invalid selfie path' using errcode='42501';
  end if;
  if s.selfie_mode = 'REQUIRED' and p_type = 'CLOCK_IN' and p_selfie_path is null and not v_offline then
    raise exception 'A selfie is required to clock in.' using errcode='P0001';
  end if;

  insert into attendance_events(org_id, employee_id, event_type, occurred_at, source, created_by, latitude, longitude, accuracy_m,
                                office_id, distance_m, inside_geofence, selfie_path, offline, client_occurred_at, flag)
  values (v_org, v_emp.id, p_type, v_at, p_source, v_emp.id, p_lat, p_lng, p_accuracy,
          v_office.id, v_dist, v_inside, p_selfie_path, v_offline, p_offline_at, v_flag)
  returning * into v_row;
  return v_row;
end $$;
grant execute on function record_attendance_v2(attendance_event_type, text, numeric, numeric, int, text, timestamptz) to authenticated;

-- The old entry point keeps working and follows the same rules.
create or replace function record_attendance(p_type attendance_event_type, p_source text default 'WEB')
returns attendance_events language sql security definer set search_path = public, pg_temp as $$
  select * from record_attendance_v2(p_type, p_source)
$$;

create or replace function review_punch(p_event uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v attendance_events;
begin
  select * into v from attendance_events where id = p_event and org_id = current_org_id();
  if v.id is null then raise exception 'not found'; end if;
  if v.employee_id = current_employee_id() then raise exception 'You cannot review your own punch.' using errcode='42501'; end if;
  if not (has_perm('attendance.manage') or (has_perm('attendance.approve') and is_in_my_team(v.employee_id))) then
    raise exception 'attendance.approve required' using errcode='42501';
  end if;
  update attendance_events set reviewed_by = current_employee_id(), reviewed_at = now(), review_note = left(p_note, 300) where id = p_event;
  perform log_audit('attendance.punch_reviewed', 'attendance_event', p_event::text, jsonb_build_object('flag', v.flag));
end $$;
grant execute on function review_punch(uuid, text) to authenticated;

-- Private selfie bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-selfies', 'attendance-selfies', false, 2097152, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;
drop policy if exists selfies_insert_own on storage.objects;
create policy selfies_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-selfies' and (storage.foldername(name))[1] = current_org_id()::text
              and (storage.foldername(name))[2] = current_employee_id()::text);
drop policy if exists selfies_read on storage.objects;
create policy selfies_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-selfies' and (storage.foldername(name))[1] = current_org_id()::text
         and ((storage.foldername(name))[2] = current_employee_id()::text or has_perm('attendance.manage')
              or (has_perm('attendance.approve') and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
                   and is_in_my_team(((storage.foldername(name))[2])::uuid))));
