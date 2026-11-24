-- =============================================================================
-- 0036 · Say WHO already uses an email / Employee ID when adding someone fails as a duplicate.
-- Only for people allowed to add employees; returns the minimum needed to find the existing record.
-- =============================================================================
create or replace function find_employee_conflict(p_email text, p_code text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name, 'status', e.status,
           'official_email', e.official_email,
           'field', case when lower(e.official_email) = lower(btrim(coalesce(p_email, ''))) then 'email' else 'code' end)
  from employees e
  where e.org_id = current_org_id()
    and (has_perm('people.manage') or has_perm('people.onboard') or has_perm('people.add_team'))
    and (lower(e.official_email) = lower(btrim(coalesce(p_email, '')))
         or (nullif(btrim(coalesce(p_code, '')), '') is not null and upper(e.employee_code) = upper(btrim(p_code))))
  order by (lower(e.official_email) = lower(btrim(coalesce(p_email, '')))) desc
  limit 1
$$;
revoke all on function find_employee_conflict(text, text) from public, anon;
grant execute on function find_employee_conflict(text, text) to authenticated;
