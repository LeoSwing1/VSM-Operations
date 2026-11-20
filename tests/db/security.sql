-- =============================================================================
-- Security suite — runs against real Postgres with RLS enforced as `authenticated`.
-- Every check raises on failure; the script stops at the first failing check.
-- =============================================================================
\set S  '11111111-0000-0000-0000-000000000001'
\set H  '11111111-0000-0000-0000-000000000002'
\set M  '11111111-0000-0000-0000-000000000003'
\set O  '11111111-0000-0000-0000-000000000004'
\set A  '11111111-0000-0000-0000-000000000005'
\set B  '11111111-0000-0000-0000-000000000006'
\set X  '11111111-0000-0000-0000-000000000007'

create or replace function t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function t_denied(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS: % (blocked: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', label;
end $$;
create or replace function t_rows(stmt text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count;
  if n <> expected then raise exception 'FAIL: % (affected %, expected %)', label, n, expected; end if;
  raise notice 'PASS: %', label;
end $$;
grant execute on function t_ok(boolean,text), t_denied(text,text), t_rows(text,int,text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres superuser; guards treat auth.uid() = null as system)
-- ---------------------------------------------------------------------------
insert into auth.users(id, email) values
 (:'S','founder@vsm.test'),(:'H','hr@vsm.test'),(:'M','mgr.dev@vsm.test'),(:'O','lead.sales@vsm.test'),
 (:'A','a@vsm.test'),(:'B','b@vsm.test'),(:'X','x@other.test');

select bootstrap_organization('VSM Growth','vsm-growth', :'S', 'Founder', 'founder@vsm.test') as org \gset
insert into departments(org_id, name) values (:'org','Development'), (:'org','Sales');
select id as dev from departments where name='Development' \gset
select id as sales from departments where name='Sales' \gset

insert into employees(org_id,user_id,employee_code,full_name,official_email,role,department_id) values
 (:'org',:'H','VSM-0002','Hema HR','hr@vsm.test','HR_MANAGER',null),
 (:'org',:'M','VSM-0003','Manoj Manager','mgr.dev@vsm.test','TEAM_LEAD',:'dev'),
 (:'org',:'O','VSM-0004','Omkar Other','lead.sales@vsm.test','TEAM_LEAD',:'sales');
select id as e_s from employees where user_id=:'S' \gset
select id as e_h from employees where user_id=:'H' \gset
select id as e_m from employees where user_id=:'M' \gset
select id as e_o from employees where user_id=:'O' \gset
insert into employees(org_id,user_id,employee_code,full_name,official_email,role,department_id,manager_id) values
 (:'org',:'A','VSM-0005','Aman A','a@vsm.test','EMPLOYEE',:'dev',:'e_m'),
 (:'org',:'B','VSM-0006','Bhavna B','b@vsm.test','EMPLOYEE',:'sales',:'e_o');
select id as e_a from employees where user_id=:'A' \gset
select id as e_b from employees where user_id=:'B' \gset

-- Second, unrelated organization
insert into organizations(name, slug) values ('Other Co','other-co') returning id as org2 \gset
insert into employees(org_id,user_id,employee_code,full_name,official_email,role)
  values (:'org2',:'X','OC-1','Xavier','x@other.test','SUPER_ADMIN');

insert into salary_structures(org_id,employee_id,effective_from,base_monthly,target_incentive) values
 (:'org',:'e_a','2026-01-01',30000,5000),(:'org',:'e_b','2026-01-01',42000,6000),(:'org',:'e_h','2026-01-01',55000,0);

insert into performance_policies(org_id,name,weights) values (:'org','Default',
 '{"task_completion":20,"task_quality":25,"on_time_delivery":15,"productivity":15,"attendance":10,"daily_updates":5,"manager_review":10}')
 returning id as pol \gset
insert into performance_snapshots(org_id,employee_id,policy_id,period_start,period_end,metrics,components,computed_score,final_score,coverage)
 values (:'org',:'e_b',:'pol','2026-10-01','2026-10-31','{}','{}',71,71,90) returning id as snap_b \gset
insert into manager_reviews(org_id,employee_id,reviewer_id,period_start,period_end,rating,shared_comments)
 values (:'org',:'e_b',:'e_o','2026-10-01','2026-10-31',72,'Good pipeline discipline') returning id as rev_b \gset
insert into manager_review_notes(review_id, org_id, private_notes) values (:'rev_b', :'org', 'CONFIDENTIAL: discuss PIP risk');

insert into leads(org_id,name,email,source) values (:'org','Website Lead','lead@example.com','WEBSITE');

-- ===========================================================================
-- 1. Logged-out access
-- ===========================================================================
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select t_ok((select count(*) from employees) = 0, 'anon sees no employees');
select t_ok((select count(*) from salary_structures) = 0, 'anon sees no salaries');
select t_ok((select count(*) from leads) = 0, 'anon sees no leads');
select t_denied($$select record_attendance('CLOCK_IN')$$, 'anon cannot punch attendance');
select t_denied($$select ingest_enquiry('vsm-growth','{"name":"spam"}'::jsonb)$$, 'anon cannot call service-only enquiry intake');
reset role;

-- ===========================================================================
-- 2. Employee A — self-service isolation
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t_ok((select count(*) from salary_structures where employee_id = :'e_a') = 1, 'A sees own salary structure');
select t_ok((select count(*) from salary_structures where employee_id <> :'e_a') = 0, 'A cannot see anyone else''s salary');
select t_ok((select count(*) from employees) = 1, 'A sees only own full employee record');
select t_ok((select count(*) from employee_directory) = 6, 'A sees the safe org directory');
select t_ok((select count(*) from performance_snapshots) = 0, 'A cannot see B''s performance snapshot');
select t_ok((select count(*) from manager_reviews) = 0, 'A cannot see B''s manager review');
select t_ok((select count(*) from leads) = 0, 'A (no CRM perm) sees no leads');
select t_ok((select count(*) from audit_events) = 0, 'A cannot read audit log');
select t_ok((select count(*) from payroll_runs) = 0, 'A cannot list payroll runs');
select t_denied(format($$insert into attendance_events(org_id,employee_id,event_type,occurred_at) values (%L,%L,'CLOCK_IN',now())$$, :'org', :'e_a'),
  'A cannot write attendance events directly');
select t_denied(format($$insert into salary_structures(org_id,employee_id,effective_from,base_monthly) values (%L,%L,'2027-01-01',999999)$$, :'org', :'e_a'),
  'A cannot give themself a salary');
select t_rows(format($q$update employees set role='ADMIN' where id = %L$q$, :'e_a'), 0, 'A cannot change own role (update matches nothing)');
select t_rows(format($q$update salary_structures set base_monthly = 1 where employee_id = %L$q$, :'e_b'), 0, 'A cannot modify B''s salary');
select t_denied(format($$insert into employees(org_id,employee_code,full_name,official_email) values (%L,'H4X','Ghost','ghost@x.test')$$, :'org'),
  'A cannot create a hidden employee/admin');

reset role;
insert into projects(org_id, name, manager_id) values (:'org', 'VSM Website', :'e_m') returning id as proj \gset
insert into project_members(project_id, employee_id) values (:'proj', :'e_a');
insert into projects(org_id, name, manager_id) values (:'org', 'Sales Deck', :'e_o');
set role authenticated;
select t_ok((select count(*) from projects) = 1, 'A sees only projects they belong to (no policy recursion)');
select t_ok((select count(*) from project_members) >= 1, 'A reads membership of visible org projects');

-- Attendance state machine
select t_ok((select (record_attendance('CLOCK_IN')).event_type = 'CLOCK_IN'), 'A clocks in');
select t_denied($$select record_attendance('CLOCK_IN')$$, 'duplicate clock-in is rejected');
reset role;
update attendance_events set created_at = now() - interval '1 minute' where employee_id = :'e_a';  -- skip 30s throttle
set role authenticated;
select t_denied($$select record_attendance('BREAK_END')$$, 'cannot end a break that never started');
select t_ok((select (record_attendance('CLOCK_OUT')).event_type = 'CLOCK_OUT'), 'A clocks out');

-- Correction request + self-approval block
insert into attendance_corrections(org_id, employee_id, event_type, requested_time, reason)
  values (:'org', :'e_a', 'CLOCK_IN', now() - interval '1 day', 'Forgot to punch in yesterday morning');
select id as corr from attendance_corrections limit 1 \gset
select t_denied(format($$select decide_attendance_correction(%L, true)$$, :'corr'), 'A cannot approve own correction');
select t_denied(format($$insert into attendance_corrections(org_id,employee_id,event_type,requested_time,reason) values (%L,%L,'CLOCK_IN',now(),'pretend for B')$$, :'org', :'e_b'),
  'A cannot file corrections for B');

-- Tasks: cannot self-grade or self-complete
reset role;
insert into tasks(org_id,title,assignee_id,assigned_by,status) values (:'org','Landing page copy',:'e_a',:'e_m','IN_PROGRESS') returning id as task_a \gset
set role authenticated;
select t_denied(format($$update tasks set quality_score = 100 where id = %L$$, :'task_a'), 'A cannot set own quality score');
select t_denied(format($$update tasks set status = 'COMPLETED' where id = %L$$, :'task_a'), 'A cannot mark own task COMPLETED');
select t_rows(format($q$update tasks set status = 'REVIEW' where id = %L$q$, :'task_a'), 1, 'A submits task for review');
select t_denied(format($$select review_task(%L, true, 95)$$, :'task_a'), 'A cannot review own task');
reset role;

-- ===========================================================================
-- 3. Employee B — cannot read confidential notes about themself
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
select t_ok((select count(*) from performance_snapshots where employee_id = :'e_b') = 1, 'B sees own performance snapshot');
select t_ok((select count(*) from manager_reviews where employee_id = :'e_b') = 1, 'B sees own shared review comments');
select t_ok((select count(*) from manager_review_notes) = 0, 'B cannot read confidential manager notes about self');
select t_ok((select count(*) from salary_structures) = 1, 'B sees only own salary');
select t_ok((select count(*) from attendance_events) = 0, 'B cannot see A''s attendance');
reset role;

-- ===========================================================================
-- 4. Manager M (A's lead, Development) — team scope, NO salary
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'M', false);
set role authenticated;
select t_ok((select count(*) from employees) = 2, 'M sees self + direct report A only');
select t_ok((select count(*) from employees where id = :'e_b') = 0, 'M cannot see employee in unrelated department');
select t_ok((select count(*) from salary_structures) = 0, 'M does NOT see direct report salaries');
select t_ok((select count(*) from performance_snapshots) = 0, 'M cannot see B''s (other team) performance');
select t_ok((select count(*) from attendance_events where employee_id = :'e_a') = 2, 'M sees A''s attendance');
select t_ok((select (decide_attendance_correction(:'corr', true, 'Verified with CCTV log')).status = 'APPROVED'), 'M approves A''s correction');
select t_ok((select count(*) from attendance_events where employee_id = :'e_a' and source = 'CORRECTION') = 1, 'approved correction created an event');
select t_denied(format($$select decide_attendance_correction(%L, false, 'again')$$, :'corr'), 'correction cannot be decided twice');
select t_ok((select (review_task(:'task_a', true, 82, 'Solid, minor typos')).quality_score = 82), 'M reviews A''s task with a quality score');
reset role;
select t_ok((select count(*) from audit_events where action like 'attendance.correction.%') = 1, 'correction decision is audited');

-- ===========================================================================
-- 5. Other-department lead O
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'O', false);
set role authenticated;
select t_ok((select count(*) from employees where id = :'e_a') = 0, 'O cannot see A (unrelated department)');
select t_ok((select count(*) from performance_snapshots where employee_id = :'e_b') = 1, 'O sees own report B''s performance');
select t_ok((select count(*) from manager_review_notes) = 1, 'O (reviewer) reads own confidential note');
select t_ok((select count(*) from salary_structures) = 0, 'O does NOT see B''s salary');
select t_ok((select count(*) from attendance_events where employee_id = :'e_a') = 0, 'O cannot see A''s attendance');
reset role;

-- ===========================================================================
-- 6. HR — payroll preparation, segregation of duties
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'H', false);
set role authenticated;
select t_ok((select count(*) from salary_structures) = 3, 'HR sees all salary structures');
select t_denied(format($$update employees set role = 'ADMIN' where id = %L$$, :'e_h'), 'HR cannot promote self');
select t_denied(format($$update employees set role = 'ADMIN' where id = %L$$, :'e_a'), 'HR cannot grant ADMIN (super admin only)');
select t_rows(format($$update salary_structures set base_monthly = 99999 where employee_id = %L$$, :'e_h'), 0, 'HR cannot edit own salary');
insert into payroll_runs(org_id, period_start, period_end, created_by) values (:'org','2026-10-01','2026-10-31', :'e_h') returning id as run \gset
select id as ss_a from salary_structures where employee_id = :'e_a' \gset
select id as ss_b from salary_structures where employee_id = :'e_b' \gset
select id as ss_h from salary_structures where employee_id = :'e_h' \gset
insert into payroll_entries(org_id,run_id,employee_id,structure_id,period_days,employed_days,payable_days,base_amount,allowances_amount,
  incentive_amount,attendance_incentive_amount,deductions_amount,gross_amount,net_amount,breakdown) values
 (:'org',:'run',:'e_a',:'ss_a',31,31,31,30000,0,2500,0,0,32500,32500,'[]'),
 (:'org',:'run',:'e_b',:'ss_b',31,31,30,40645.16,0,3000,0,0,43645.16,43645.16,'[]');
select t_denied(format($$insert into payroll_entries(org_id,run_id,employee_id,structure_id,period_days,employed_days,payable_days,base_amount,allowances_amount,incentive_amount,attendance_incentive_amount,deductions_amount,gross_amount,net_amount,breakdown) values (%L,%L,%L,%L,31,31,31,55000,0,0,0,0,55000,55000,'[]')$$, :'org', :'run', :'e_h', :'ss_h'),
  'HR cannot write their own payroll entry');
select t_ok((select (payroll_transition(:'run','REVIEW')).status = 'REVIEW'), 'HR submits run for review');
select t_denied(format($$select payroll_transition(%L,'APPROVED')$$, :'run'), 'HR cannot approve a run they prepared');
reset role;

-- A cannot see their entry before approval
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t_ok((select count(*) from payroll_entries) = 0, 'A cannot see payslip before approval');
reset role;

-- ===========================================================================
-- 7. Super Admin approves; entries freeze; paid requires a reference
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t_ok((select count(*) from employees) = 6, 'Super admin sees whole org');
select t_ok((select count(*) from employees where org_id = :'org2') = 0, 'Super admin cannot see another organization');
select t_ok((select (payroll_transition(:'run','APPROVED')).status = 'APPROVED'), 'Super admin approves the run');
select t_rows(format($$update payroll_entries set net_amount = 1 where run_id = %L$$, :'run'), 0, 'approved entries cannot be edited through the API');
reset role;
select t_denied(format($$update payroll_entries set net_amount = 1 where run_id = %L$$, :'run'), 'approved entries locked even with RLS bypassed (trigger)');
set role authenticated;
select t_ok((select (payroll_transition(:'run','PROCESSED')).status = 'PROCESSED'), 'run processed');
select id as pe_a from payroll_entries where employee_id = :'e_a' \gset
select id as pe_b from payroll_entries where employee_id = :'e_b' \gset
select t_denied(format($$select mark_entry_paid(%L, '', 'UPI', current_date)$$, :'pe_a'), 'cannot mark paid without a reference');
select t_ok((select (mark_entry_paid(:'pe_a', 'UTR123456789', 'BANK_TRANSFER', current_date)).payment_status = 'PAID'), 'entry A paid with UTR');
select t_ok((select status from payroll_runs where id = :'run') = 'PROCESSED', 'run not PAID while an entry is unpaid');
select t_ok((select (mark_entry_paid(:'pe_b', 'UTR987654321', 'BANK_TRANSFER', current_date)).payment_status = 'PAID'), 'entry B paid');
select t_ok((select status from payroll_runs where id = :'run') = 'PAID', 'run auto-PAID once all entries confirmed');
select t_denied($$select payroll_transition((select id from payroll_runs limit 1),'PAID')$$, 'PAID cannot be forced manually');
reset role;

-- A now sees exactly their own entry
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t_ok((select count(*) from payroll_entries) = 1 and (select employee_id from payroll_entries) = :'e_a', 'A sees only own approved payslip');
select t_ok((select count(*) from notifications where category = 'PAYROLL') = 1, 'A got a payslip notification');
reset role;
select t_ok((select count(*) from email_outbox where template = 'payroll.payslip_available' and payload ? 'net_amount') = 0,
  'payslip emails carry no salary amounts');

-- Self-inclusion block: a run containing the approver's own salary
select set_config('request.jwt.claim.sub', :'H', false);
set role authenticated;
insert into payroll_runs(org_id, period_start, period_end, created_by) values (:'org','2026-11-01','2026-11-30', :'e_h') returning id as run2 \gset
reset role;
insert into salary_structures(org_id,employee_id,effective_from,base_monthly) values (:'org',:'e_s','2026-01-01',100000) returning id as ss_s \gset
insert into payroll_entries(org_id,run_id,employee_id,structure_id,period_days,employed_days,payable_days,base_amount,allowances_amount,
  incentive_amount,attendance_incentive_amount,deductions_amount,gross_amount,net_amount,breakdown)
  values (:'org',:'run2',:'e_s',:'ss_s',30,30,30,100000,0,0,0,0,100000,100000,'[]');
select set_config('request.jwt.claim.sub', :'H', false);
set role authenticated;
select payroll_transition(:'run2','REVIEW');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t_denied(format($$select payroll_transition(%L,'APPROVED')$$, :'run2'), 'approver cannot approve a run with their own salary');
reset role;

-- ===========================================================================
-- 8. Organization isolation
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'X', false);
set role authenticated;
select t_ok((select count(*) from employees) = 1, 'other org admin sees only their own org');
select t_ok((select count(*) from salary_structures) = 0, 'other org admin sees no VSM salaries');
select t_ok((select count(*) from leads) = 0, 'other org admin sees no VSM leads');
reset role;

-- ===========================================================================
-- 9. Public enquiry intake (service role): persisted + deduped + queued
-- ===========================================================================
set role service_role;
select ingest_enquiry('vsm-growth', '{"name":"Rohit","email":"Lead@Example.com","service":"SEO","message":"Need SEO"}'::jsonb, 'alerts@vsm.test');
reset role;
select t_ok((select count(*) from leads where name='Rohit' and duplicate_of is not null) = 1, 'repeat enquiry flagged as duplicate');
select t_ok((select count(*) from email_outbox where template in ('lead.new_internal','lead.acknowledgement')) = 2, 'intake queued internal alert + acknowledgement');
select t_ok((select count(*) from notifications where category='CRM') >= 1, 'CRM notification created for assigners');

-- Performance weights must total 100
select t_denied(format($$insert into performance_policies(org_id,name,weights) values (%L,'Bad','{"task_quality":60}')$$, :'org'), 'weights not totalling 100 are rejected');

\echo '✔ security suite complete'

-- ===========================================================================
-- 10. Hierarchy & permission administration (0006)
-- ===========================================================================
\set D  '11111111-0000-0000-0000-000000000008'
insert into auth.users(id, email) values (:'D','admin@vsm.test');
insert into employees(org_id,user_id,employee_code,full_name,official_email,role)
  values (:'org',:'D','VSM-0008','Divya Admin','admin@vsm.test','ADMIN');
select id as e_d from employees where user_id=:'D' \gset

select set_config('request.jwt.claim.sub', :'H', false); set role authenticated;
select t_denied(format($$insert into role_permissions(org_id,role,permission) values (%L,'EMPLOYEE','crm.view_all')$$, :'org'), 'HR (no roles.manage) cannot edit the permission matrix');
select t_denied(format($$update employees set designation='x' where id = %L$$, :'e_d'), 'HR cannot edit someone above their level (Admin)');
reset role;

select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select t_rows(format($$insert into role_permissions(org_id,role,permission) values (%L,'EMPLOYEE','tasks.view_all')$$, :'org'), 1, 'Admin grants a permission they hold to a lower role');
select t_denied(format($$insert into role_permissions(org_id,role,permission) values (%L,'EMPLOYEE','payroll.view_all')$$, :'org'), 'Admin cannot grant sensitive payroll permission');
select t_denied(format($$insert into role_permissions(org_id,role,permission) values (%L,'EMPLOYEE','tasks.view_team')$$, :'org'), 'Admin cannot grant a permission they do not hold (no escalation)');
select t_denied(format($$insert into role_permissions(org_id,role,permission) values (%L,'ADMIN','crm.assign')$$, :'org'), 'Admin cannot change their own role''s permissions');
select t_denied(format($$insert into role_permissions(org_id,role,permission) values (%L,'SUPER_ADMIN','crm.assign')$$, :'org'), 'nobody edits Super Admin permissions');
select t_denied(format($$update employees set role='ADMIN' where id = %L$$, :'e_a'), 'Admin cannot create another Admin (same level)');
select t_rows(format($$update employees set role='TEAM_LEAD' where id = %L$$, :'e_a'), 1, 'Admin can promote an employee to a lower role');
select t_rows(format($$update employees set role='EMPLOYEE' where id = %L$$, :'e_a'), 1, 'Admin can demote back');
select t_denied(format($$insert into employee_permission_overrides(org_id,employee_id,permission,effect,reason,granted_by) values (%L,%L,'crm.view_all','GRANT','helping sales',%L)$$, :'org', :'e_a', :'e_d'), 'only Super Admin sets per-person overrides');
select t_ok((select count(*) from permission_holders('crm.assign')) >= 2, 'Admin can see who holds a permission');
select t_rows(format($$update role_settings set level = 85 where role = 'TEAM_LEAD' and org_id = %L$$, :'org'), 0, 'Admin cannot change role levels');
reset role;
delete from role_permissions where role='EMPLOYEE' and permission='tasks.view_all';

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_denied($$select * from permission_holders('payroll.view_all')$$, 'employee cannot list permission holders');
select t_denied(format($$select * from effective_permissions(%L)$$, :'e_b'), 'employee cannot inspect someone else''s access');
select t_ok((select count(*) from leads) = 0, 'before override: A sees no leads');
reset role;

select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select t_rows(format($$insert into employee_permission_overrides(org_id,employee_id,permission,effect,reason,granted_by) values (%L,%L,'crm.view_all','GRANT','covering sales this week',%L)$$, :'org', :'e_a', :'e_s'), 1, 'Super Admin grants A a personal override');
select t_rows(format($$insert into employee_permission_overrides(org_id,employee_id,permission,effect,reason,granted_by) values (%L,%L,'attendance.view_team','DENY','under review',%L)$$, :'org', :'e_m', :'e_s'), 1, 'Super Admin denies M a role permission');
select t_denied(format($$insert into employee_permission_overrides(org_id,employee_id,permission,effect,reason,granted_by) values (%L,%L,'crm.view_all','DENY','test test',%L)$$, :'org', :'e_s', :'e_s'), 'cannot override yourself / a Super Admin');
select t_rows(format($$update role_settings set label = 'Content Lead' where role = 'TEAM_LEAD' and org_id = %L$$, :'org'), 1, 'Super Admin renames a role label');
select t_denied(format($$update role_settings set level = 100 where role = 'ADMIN' and org_id = %L$$, :'org'), 'no role can be raised to Super Admin level');
select t_denied(format($$update employees set role = 'ADMIN' where id = %L$$, :'e_s'), 'Super Admin cannot demote themselves');
reset role;

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_ok((select count(*) from leads) > 0, 'GRANT override takes effect (A now sees leads)');
select t_ok((select (my_context()->'permissions') ? 'crm.view_all'), 'override shows in A''s effective permissions');
reset role;
select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
select t_ok((select count(*) from attendance_events where employee_id = :'e_a') = 0, 'DENY override beats role permission (M loses team attendance)');
reset role;
select t_ok((select count(*) from audit_events where action like 'permission.override.%') = 2, 'overrides are audited');
select t_denied(format($$update employees set status = 'EXITED' where id = %L$$, :'e_s'), 'the last Super Admin can never be exited (even by the system)');


-- Smoke: every public table is readable (subject to RLS) by every persona without policy errors.
create or replace function t_sweep(label text) returns void language plpgsql as $$
declare t record; n int;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('select count(*) from public.%I', t.tablename) into n;
  end loop;
  raise notice 'PASS: sweep as % (all tables readable under RLS)', label;
end $$;
grant execute on function t_sweep(text) to authenticated;
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated; select t_sweep('employee'); reset role;
select set_config('request.jwt.claim.sub', :'M', false); set role authenticated; select t_sweep('team lead'); reset role;
select set_config('request.jwt.claim.sub', :'H', false); set role authenticated; select t_sweep('hr'); reset role;
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated; select t_sweep('super admin'); reset role;
\echo '✔ sweep complete'
