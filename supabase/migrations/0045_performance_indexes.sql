-- =============================================================================
-- VSM Growth Operations — 0045 Speed: indexes for the lookups the app makes most
-- Foreign keys that pages filter or join on had no index, so Postgres scanned whole tables (and RLS checks
-- like "is this in my team" repeated those scans per row). Each index below backs a real filter/join.
-- Unread notifications get a partial index for the bell/badge counts that every page asks for.
-- =============================================================================

do $$ begin if to_regclass('public.chat_attachments') is not null then execute 'create index if not exists chat_attachments_message_id_fk_idx on public.chat_attachments(message_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_messages') is not null then execute 'create index if not exists chat_messages_author_id_fk_idx on public.chat_messages(author_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_messages') is not null then execute 'create index if not exists chat_messages_parent_message_id_fk_idx on public.chat_messages(parent_message_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_message_reports') is not null then execute 'create index if not exists chat_message_reports_channel_id_fk_idx on public.chat_message_reports(channel_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_channels') is not null then execute 'create index if not exists chat_channels_project_id_fk_idx on public.chat_channels(project_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_channels') is not null then execute 'create index if not exists chat_channels_department_id_fk_idx on public.chat_channels(department_id)'; end if; end $$;
do $$ begin if to_regclass('public.chat_reactions') is not null then execute 'create index if not exists chat_reactions_employee_id_fk_idx on public.chat_reactions(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.leads') is not null then execute 'create index if not exists leads_assigned_to_fk_idx on public.leads(assigned_to)'; end if; end $$;
do $$ begin if to_regclass('public.lead_activities') is not null then execute 'create index if not exists lead_activities_lead_id_fk_idx on public.lead_activities(lead_id)'; end if; end $$;
do $$ begin if to_regclass('public.leave_requests') is not null then execute 'create index if not exists leave_requests_leave_type_id_fk_idx on public.leave_requests(leave_type_id)'; end if; end $$;
do $$ begin if to_regclass('public.invoice_lines') is not null then execute 'create index if not exists invoice_lines_invoice_id_fk_idx on public.invoice_lines(invoice_id)'; end if; end $$;
do $$ begin if to_regclass('public.client_invoices') is not null then execute 'create index if not exists client_invoices_client_id_fk_idx on public.client_invoices(client_id)'; end if; end $$;
do $$ begin if to_regclass('public.client_invoices') is not null then execute 'create index if not exists client_invoices_project_id_fk_idx on public.client_invoices(project_id)'; end if; end $$;
do $$ begin if to_regclass('public.projects') is not null then execute 'create index if not exists projects_client_id_fk_idx on public.projects(client_id)'; end if; end $$;
do $$ begin if to_regclass('public.projects') is not null then execute 'create index if not exists projects_manager_id_fk_idx on public.projects(manager_id)'; end if; end $$;
do $$ begin if to_regclass('public.project_members') is not null then execute 'create index if not exists project_members_employee_id_fk_idx on public.project_members(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.project_time_entries') is not null then execute 'create index if not exists project_time_entries_task_id_fk_idx on public.project_time_entries(task_id)'; end if; end $$;
do $$ begin if to_regclass('public.employee_documents') is not null then execute 'create index if not exists employee_documents_employee_id_fk_idx on public.employee_documents(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.employee_letters') is not null then execute 'create index if not exists employee_letters_employee_id_fk_idx on public.employee_letters(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.payroll_adjustments') is not null then execute 'create index if not exists payroll_adjustments_employee_id_fk_idx on public.payroll_adjustments(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.payroll_entries') is not null then execute 'create index if not exists payroll_entries_structure_id_fk_idx on public.payroll_entries(structure_id)'; end if; end $$;
do $$ begin if to_regclass('public.performance_review_requests') is not null then execute 'create index if not exists performance_review_requests_employee_id_fk_idx on public.performance_review_requests(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.probation_reviews') is not null then execute 'create index if not exists probation_reviews_employee_id_fk_idx on public.probation_reviews(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.okr_key_results') is not null then execute 'create index if not exists okr_key_results_objective_id_fk_idx on public.okr_key_results(objective_id)'; end if; end $$;
do $$ begin if to_regclass('public.okr_checkins') is not null then execute 'create index if not exists okr_checkins_key_result_id_fk_idx on public.okr_checkins(key_result_id)'; end if; end $$;
do $$ begin if to_regclass('public.okr_objectives') is not null then execute 'create index if not exists okr_objectives_owner_id_fk_idx on public.okr_objectives(owner_id)'; end if; end $$;
do $$ begin if to_regclass('public.okr_objectives') is not null then execute 'create index if not exists okr_objectives_parent_id_fk_idx on public.okr_objectives(parent_id)'; end if; end $$;
do $$ begin if to_regclass('public.okr_key_results') is not null then execute 'create index if not exists okr_key_results_owner_id_fk_idx on public.okr_key_results(owner_id)'; end if; end $$;
do $$ begin if to_regclass('public.org_team_members') is not null then execute 'create index if not exists org_team_members_employee_id_fk_idx on public.org_team_members(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.org_teams') is not null then execute 'create index if not exists org_teams_lead_employee_id_fk_idx on public.org_teams(lead_employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.calendar_attendees') is not null then execute 'create index if not exists calendar_attendees_employee_id_fk_idx on public.calendar_attendees(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.calendar_events') is not null then execute 'create index if not exists calendar_events_organizer_id_fk_idx on public.calendar_events(organizer_id)'; end if; end $$;
do $$ begin if to_regclass('public.calendar_events') is not null then execute 'create index if not exists calendar_events_project_id_fk_idx on public.calendar_events(project_id)'; end if; end $$;
do $$ begin if to_regclass('public.kpi_values') is not null then execute 'create index if not exists kpi_values_employee_id_fk_idx on public.kpi_values(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.quality_assessments') is not null then execute 'create index if not exists quality_assessments_employee_id_fk_idx on public.quality_assessments(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.quality_assessments') is not null then execute 'create index if not exists quality_assessments_task_id_fk_idx on public.quality_assessments(task_id)'; end if; end $$;
do $$ begin if to_regclass('public.quality_assessments') is not null then execute 'create index if not exists quality_assessments_project_id_fk_idx on public.quality_assessments(project_id)'; end if; end $$;
do $$ begin if to_regclass('public.employees') is not null then execute 'create index if not exists employees_shift_id_fk_idx on public.employees(shift_id)'; end if; end $$;
do $$ begin if to_regclass('public.departments') is not null then execute 'create index if not exists departments_head_employee_id_fk_idx on public.departments(head_employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.review_assignments') is not null then execute 'create index if not exists review_assignments_reviewer_id_fk_idx on public.review_assignments(reviewer_id)'; end if; end $$;
do $$ begin if to_regclass('public.review_assignments') is not null then execute 'create index if not exists review_assignments_subject_id_fk_idx on public.review_assignments(subject_id)'; end if; end $$;
do $$ begin if to_regclass('public.exit_clearance_items') is not null then execute 'create index if not exists exit_clearance_items_owner_id_fk_idx on public.exit_clearance_items(owner_id)'; end if; end $$;
do $$ begin if to_regclass('public.task_events') is not null then execute 'create index if not exists task_events_task_id_fk_idx on public.task_events(task_id)'; end if; end $$;
do $$ begin if to_regclass('public.task_time_entries') is not null then execute 'create index if not exists task_time_entries_task_id_fk_idx on public.task_time_entries(task_id)'; end if; end $$;
do $$ begin if to_regclass('public.task_time_entries') is not null then execute 'create index if not exists task_time_entries_employee_id_fk_idx on public.task_time_entries(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.training_records') is not null then execute 'create index if not exists training_records_employee_id_fk_idx on public.training_records(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.scholar_batches') is not null then execute 'create index if not exists scholar_batches_course_id_fk_idx on public.scholar_batches(course_id)'; end if; end $$;
do $$ begin if to_regclass('public.scholar_enrollments') is not null then execute 'create index if not exists scholar_enrollments_batch_id_fk_idx on public.scholar_enrollments(batch_id)'; end if; end $$;
do $$ begin if to_regclass('public.scholar_fee_payments') is not null then execute 'create index if not exists scholar_fee_payments_enrollment_id_fk_idx on public.scholar_fee_payments(enrollment_id)'; end if; end $$;
do $$ begin if to_regclass('public.scholar_session_attendance') is not null then execute 'create index if not exists scholar_session_attendance_student_id_fk_idx on public.scholar_session_attendance(student_id)'; end if; end $$;
do $$ begin if to_regclass('public.scholar_students') is not null then execute 'create index if not exists scholar_students_counsellor_id_fk_idx on public.scholar_students(counsellor_id)'; end if; end $$;
do $$ begin if to_regclass('public.vendor_payments') is not null then execute 'create index if not exists vendor_payments_vendor_id_fk_idx on public.vendor_payments(vendor_id)'; end if; end $$;
do $$ begin if to_regclass('public.vendor_payments') is not null then execute 'create index if not exists vendor_payments_expense_id_fk_idx on public.vendor_payments(expense_id)'; end if; end $$;
do $$ begin if to_regclass('public.finance_expenses') is not null then execute 'create index if not exists finance_expenses_vendor_id_fk_idx on public.finance_expenses(vendor_id)'; end if; end $$;
do $$ begin if to_regclass('public.finance_expenses') is not null then execute 'create index if not exists finance_expenses_project_id_fk_idx on public.finance_expenses(project_id)'; end if; end $$;
do $$ begin if to_regclass('public.work_group_members') is not null then execute 'create index if not exists work_group_members_employee_id_fk_idx on public.work_group_members(employee_id)'; end if; end $$;
do $$ begin if to_regclass('public.workflow_approval_cases') is not null then execute 'create index if not exists workflow_approval_cases_approver_id_fk_idx on public.workflow_approval_cases(approver_id)'; end if; end $$;
do $$ begin if to_regclass('public.workflow_approval_cases') is not null then execute 'create index if not exists workflow_approval_cases_requester_id_fk_idx on public.workflow_approval_cases(requester_id)'; end if; end $$;
do $$ begin if to_regclass('public.schedule_assignments') is not null then execute 'create index if not exists schedule_assignments_shift_id_fk_idx on public.schedule_assignments(shift_id)'; end if; end $$;
do $$ begin if to_regclass('public.salary_structures') is not null then execute 'create index if not exists salary_structures_incentive_policy_id_fk_idx on public.salary_structures(incentive_policy_id)'; end if; end $$;
do $$ begin if to_regclass('public.candidates') is not null then execute 'create index if not exists candidates_department_id_fk_idx on public.candidates(department_id)'; end if; end $$;
do $$ begin if to_regclass('public.candidate_interviews') is not null then execute 'create index if not exists candidate_interviews_interviewer_id_fk_idx on public.candidate_interviews(interviewer_id)'; end if; end $$;
do $$ begin if to_regclass('public.company_announcements') is not null then execute 'create index if not exists company_announcements_department_id_fk_idx on public.company_announcements(department_id)'; end if; end $$;
do $$ begin if to_regclass('public.designations') is not null then execute 'create index if not exists designations_department_id_fk_idx on public.designations(department_id)'; end if; end $$;
do $$ begin if to_regclass('public.asset_maintenance') is not null then execute 'create index if not exists asset_maintenance_reported_by_fk_idx on public.asset_maintenance(reported_by)'; end if; end $$;

create index if not exists notifications_unread_idx on notifications(recipient_id, created_at desc) where read_at is null;
create index if not exists chat_members_employee_idx on chat_channel_members(employee_id, channel_id);
create index if not exists employees_user_active_idx on employees(user_id) where status <> 'EXITED';
create index if not exists employees_manager_active_idx on employees(manager_id) where status <> 'EXITED';

analyze;

-- ---------------------------------------------------------------------------
-- RLS: evaluate "who am I" / "my org" / "do I have permission X" once per query, not once per row.
-- (Supabase performance advisor: wrap stable auth helpers in a sub-select so Postgres caches them as an initplan.)
-- Only argument-free / literal-argument calls are wrapped; row-dependent checks are left exactly as they were.
-- ---------------------------------------------------------------------------
create or replace function rls_wrap_expr(e text) returns text language plpgsql immutable as $$
begin
  if e is null then return null; end if;
  e := regexp_replace(e, '(\(\s*SELECT\s+)?current_org_id\(\)(\s+AS\s+current_org_id\s*\))?', '(SELECT current_org_id())', 'gi');
  e := regexp_replace(e, '(\(\s*SELECT\s+)?current_employee_id\(\)(\s+AS\s+current_employee_id\s*\))?', '(SELECT current_employee_id())', 'gi');
  e := regexp_replace(e, '(\(\s*SELECT\s+)?auth\.uid\(\)(\s+AS\s+uid\s*\))?', '(SELECT auth.uid())', 'gi');
  e := regexp_replace(e, '(\(\s*SELECT\s+)?has_perm\((''[^'']*''(::text)?)\)(\s+AS\s+has_perm\s*\))?', '(SELECT has_perm(\2))', 'gi');
  return e;
end $$;

-- Tables that another policy looks into (… FROM x / JOIN x) are skipped: giving their policies a sub-select makes
-- Postgres treat the chain as recursive ("infinite recursion detected in policy").
do $$
declare p record; v_using text; v_check text; v_sql text; v_skip text[];
begin
  select coalesce(array_agg(distinct lower(m[1])), '{}') into v_skip
    from pg_policies pp,
         regexp_matches(coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, ''), '(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'gi') m
   where pp.schemaname = 'public';
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and not (tablename = any (v_skip)) loop
    v_using := rls_wrap_expr(p.qual);
    v_check := rls_wrap_expr(p.with_check);
    if v_using is not distinct from p.qual and v_check is not distinct from p.with_check then continue; end if;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;
end $$;
drop function rls_wrap_expr(text);
