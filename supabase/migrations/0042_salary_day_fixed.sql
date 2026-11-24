-- =============================================================================
-- VSM Growth Operations — 0042 Salary date fixed per person
-- The salary day is suggested from joining date + 7 when someone is added, then saved for that person and
-- never moves on its own. Only HR (post), HR Manager, owners and admins (plus the Super Admin) may set or
-- change it — the new permission people.salary_day.
-- =============================================================================

create or replace function seed_salary_day_perm(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  values (p_org, 'ADMIN', 'people.salary_day'), (p_org, 'HR_MANAGER', 'people.salary_day')
  on conflict do nothing
$$;
revoke all on function seed_salary_day_perm(uuid) from public, anon, authenticated;
select seed_salary_day_perm(id) from organizations;
create or replace function seed_salary_day_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_salary_day_perm(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_z_salary_day on employees;
create trigger employees_seed_z_salary_day after insert on employees for each row execute function seed_salary_day_on_sa();

-- The HR post gets it too (same posts that can onboard).
update designations set grants = (select array_agg(distinct g) from unnest(grants || array['people.salary_day']) g)
 where lower(title) in ('hr executive','hr', 'hr generalist', 'hr associate') and not ('people.salary_day' = any(grants));

create or replace function set_salary_day() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_allowed boolean := auth.uid() is null or has_perm('people.salary_day');
begin
  if tg_op = 'INSERT' then
    if new.salary_day is null or not v_allowed then
      new.salary_day := default_salary_day(new.joining_date);
    end if;
  else
    if new.salary_day is null then
      new.salary_day := coalesce(old.salary_day, default_salary_day(new.joining_date));
    end if;
    if new.salary_day is distinct from old.salary_day and not v_allowed then
      raise exception 'Only HR, the HR Manager, owners and admins can change the salary date' using errcode = '42501';
    end if;
    -- A changed joining date no longer moves the salary date: it stays what was saved for this person.
  end if;
  return new;
end $$;
