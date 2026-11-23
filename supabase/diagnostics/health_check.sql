-- =============================================================================
-- VSM Ops health check — paste the whole file into Supabase → SQL Editor → Run.
-- Read-only: creates a TEMPORARY function, runs every check, changes nothing.
-- Send back the result table (it contains no passwords or keys).
-- =============================================================================
create or replace function pg_temp.vsm_diag() returns table(area text, check_name text, result text)
language plpgsql as $$
declare v_sa uuid; v_emp uuid; v_tz text; v_n int; v_txt text; r record;
begin
  -- 1. Which migrations are present (by objects they create)
  for r in select * from (values
      ('0001-0006 core', 'public.role_settings'), ('0007 notifications', 'public.notification_preferences'),
      ('0010 finance', 'public.client_invoices'), ('0011 chat', 'public.chat_messages'), ('0014 teams', 'public.org_teams'),
      ('0016 workflows', 'public.workflow_runs'), ('0018 integrations', 'public.integration_check_runs'),
      ('0021 approvals', 'public.workflow_approval_cases'), ('0023 channels', 'public.delivery_outbox'),
      ('0024 posts/teams', 'public.designations'), ('0027 hardening', 'public.app_errors'),
      ('0028 field attendance', 'public.office_locations'), ('0029 India payroll', 'public.payroll_statutory_settings'),
      ('0030 Google Workspace', 'public.google_workspace_settings'), ('0031 VSM Scholars', 'public.scholar_students')) as t(label, obj) loop
    area := 'migrations'; check_name := r.label; result := case when to_regclass(r.obj) is null then 'MISSING ✗' else 'ok' end; return next;
  end loop;
  area := 'migrations'; check_name := '0022 repair';
  result := case when exists(select 1 from pg_proc where proname='finance_create_invoice') then 'ok' else 'MISSING ✗' end; return next;
  area := 'migrations'; check_name := '0024 super admin guard';
  result := case when exists(select 1 from pg_trigger where tgname='employees_protect_sa') then 'ok' else 'MISSING ✗' end; return next;

  -- 2. Organisation, Super Admin, time
  select timezone into v_tz from organizations limit 1;
  area := 'org'; check_name := 'organisations'; result := (select count(*) from organizations)::text; return next;
  area := 'org'; check_name := 'timezone'; result := coalesce(v_tz, 'none'); return next;
  area := 'org'; check_name := 'db now (org time)'; result := to_char(now() at time zone coalesce(v_tz,'Asia/Kolkata'), 'YYYY-MM-DD HH24:MI:SS'); return next;
  select id, user_id into v_emp, v_sa from employees where role = 'SUPER_ADMIN' and status <> 'EXITED' order by created_at limit 1;
  area := 'org'; check_name := 'active super admins'; result := (select count(*) from employees where role='SUPER_ADMIN' and status<>'EXITED')::text; return next;
  area := 'org'; check_name := 'super admin login linked'; result := case when v_sa is null then 'NO ✗ (employees.user_id is empty)' else 'yes' end; return next;
  area := 'org'; check_name := 'employees (active)'; result := (select count(*) from employees where status<>'EXITED')::text; return next;

  -- 3. Super Admin attendance as the database sees it (today in org time)
  for r in select event_type, to_char(occurred_at at time zone coalesce(v_tz,'Asia/Kolkata'), 'DD Mon HH24:MI:SS') t, source
           from attendance_events where employee_id = v_emp order by occurred_at desc limit 6 loop
    area := 'attendance (super admin)'; check_name := r.t || ' · ' || r.source; result := r.event_type::text; return next;
  end loop;
  area := 'attendance (super admin)'; check_name := 'events since local midnight';
  result := (select count(*) from attendance_events where employee_id = v_emp
             and occurred_at >= (date_trunc('day', now() at time zone coalesce(v_tz,'Asia/Kolkata'))) at time zone coalesce(v_tz,'Asia/Kolkata'))::text; return next;

  -- 4. Same reads AS the Super Admin through RLS (this is what the app does)
  if v_sa is not null then
    perform set_config('request.jwt.claim.sub', v_sa::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    foreach v_txt in array array['employees','attendance_events','tasks','notifications','leave_requests','chat_channels','org_teams','designations','role_permissions',
                                 'office_locations','payroll_statutory_settings','scholar_courses','scholar_students','google_workspace_settings'] loop
      begin
        execute format('select count(*) from public.%I', v_txt) into v_n;
        area := 'app reads (RLS as super admin)'; check_name := v_txt; result := v_n || ' rows'; return next;
      exception when others then
        area := 'app reads (RLS as super admin)'; check_name := v_txt; result := 'ERROR ✗ ' || sqlerrm; return next;
      end;
    end loop;
    begin
      select count(*) into v_n from public.attendance_events where employee_id = v_emp
        and occurred_at >= (date_trunc('day', now() at time zone coalesce(v_tz,'Asia/Kolkata'))) at time zone coalesce(v_tz,'Asia/Kolkata');
      area := 'app reads (RLS as super admin)'; check_name := 'my events today'; result := v_n::text; return next;
    exception when others then
      area := 'app reads (RLS as super admin)'; check_name := 'my events today'; result := 'ERROR ✗ ' || sqlerrm; return next;
    end;
    begin
      area := 'app reads (RLS as super admin)'; check_name := 'current_employee_id() matches';
      result := case when current_employee_id() = v_emp then 'yes' else 'NO ✗' end; return next;
    exception when others then result := 'ERROR ✗ ' || sqlerrm; return next;
    end;
    perform set_config('role', 'none', true);
  end if;
end $$;
select * from pg_temp.vsm_diag();
