-- =============================================================================
-- 0038 · Find an existing Supabase login by email (service role only), so a welcome email can re-use a login left
-- over from an earlier attempt instead of failing with "already registered". Never callable from the browser.
-- =============================================================================
create or replace function auth_login_for_email(p_email text) returns jsonb
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object('user_id', u.id,
           'employee_id', e.id, 'employee_name', e.full_name, 'employee_org', e.org_id, 'is_super_admin', coalesce(e.role = 'SUPER_ADMIN', false))
  from auth.users u left join public.employees e on e.user_id = u.id
  where lower(u.email) = lower(btrim(p_email))
  limit 1
$$;
revoke all on function auth_login_for_email(text) from public, anon, authenticated;
