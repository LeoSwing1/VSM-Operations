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
update employees set status='PROBATION' where id in (:'e_a',:'e_b');

-- Second, unrelated organization
insert into organizations(name, slug) values ('Other Co','other-co') returning id as org2 \gset
insert into employees(org_id,user_id,employee_code,full_name,official_email,role)
  values (:'org2',:'X','OC-1','Xavier','x@other.test','SUPER_ADMIN');
select id as e_x from employees where user_id=:'X' \gset

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

-- HR completion fixtures: private docs, probation and exit clearance.
insert into employee_documents(id,org_id,employee_id,category,title,storage_path,original_name,mime_type,size_bytes,uploaded_by) values
 ('99999999-0000-0000-0000-000000000001',:'org',:'e_a','IDENTITY','A identity',''||:'org'||'/'||:'e_a'||'/doc-a-pan.pdf','pan.pdf','application/pdf',1200,:'e_h'),
 ('99999999-0000-0000-0000-000000000002',:'org',:'e_b','IDENTITY','B identity',''||:'org'||'/'||:'e_b'||'/doc-b-pan.pdf','pan.pdf','application/pdf',1300,:'e_h');
insert into storage.objects(bucket_id,name) values
 ('employee-private', :'org'||'/'||:'e_a'||'/doc-a-pan.pdf'),
 ('employee-private', :'org'||'/'||:'e_b'||'/doc-b-pan.pdf');
insert into probation_reviews(id,org_id,employee_id,reviewer_id,due_date,comments) values
 ('99999999-0000-0000-0000-000000000011',:'org',:'e_a',:'e_h','2026-12-01','A probation review'),
 ('99999999-0000-0000-0000-000000000012',:'org',:'e_b',:'e_h','2026-12-01','B probation review');
insert into exit_clearance_items(id,org_id,employee_id,category,title) values
 ('99999999-0000-0000-0000-000000000021',:'org',:'e_a','IT','Return laptop'),
 ('99999999-0000-0000-0000-000000000022',:'org',:'e_b','FINANCE','Clear advance');
insert into employee_letters(id,org_id,employee_id,letter_type,reference_no,issued_on,snapshot,issued_by) values
 ('99999999-0000-0000-0000-000000000031',:'org',:'e_a','APPOINTMENT','VSM/APPOINTMENT/2026/TESTA','2026-11-21','{"employee_name":"Aman A"}',:'e_h'),
 ('99999999-0000-0000-0000-000000000032',:'org',:'e_b','APPOINTMENT','VSM/APPOINTMENT/2026/TESTB','2026-11-21','{"employee_name":"Bhavna B"}',:'e_h');

-- Operations and communication fixtures.
insert into projects(id,org_id,name,manager_id,status) values
 ('88888888-0000-0000-0000-000000000001',:'org','Project Alpha',:'e_m','ACTIVE');
insert into project_members(project_id,employee_id) values ('88888888-0000-0000-0000-000000000001',:'e_m'),('88888888-0000-0000-0000-000000000001',:'e_a');
insert into project_milestones(id,org_id,project_id,title,created_by) values
 ('88888888-0000-0000-0000-000000000011',:'org','88888888-0000-0000-0000-000000000001','Alpha launch',:'e_m');
insert into chat_channels(id,org_id,name,channel_type,created_by) values
 ('88888888-0000-0000-0000-000000000021',:'org','Company chat','PUBLIC',:'e_m'),
 ('88888888-0000-0000-0000-000000000022',:'org','Private sales','GROUP',:'e_m'),
 ('88888888-0000-0000-0000-000000000023',:'org','Private no report','GROUP',:'e_m');
insert into chat_channel_members(channel_id,employee_id,member_role) values
 ('88888888-0000-0000-0000-000000000021',:'e_m','OWNER'),
 ('88888888-0000-0000-0000-000000000022',:'e_m','OWNER'),
 ('88888888-0000-0000-0000-000000000022',:'e_b','MEMBER'),
 ('88888888-0000-0000-0000-000000000023',:'e_m','OWNER');
insert into chat_messages(id,org_id,channel_id,author_id,body) values
 ('88888888-0000-0000-0000-000000000031',:'org','88888888-0000-0000-0000-000000000021',:'e_m','Welcome to VSM chat'),
 ('88888888-0000-0000-0000-000000000032',:'org','88888888-0000-0000-0000-000000000022',:'e_b','Private sales message'),
 ('88888888-0000-0000-0000-000000000033',:'org','88888888-0000-0000-0000-000000000023',:'e_m','Unreported private message');
insert into company_announcements(id,org_id,title,body,audience,pinned,created_by) values
 ('88888888-0000-0000-0000-000000000041',:'org','Company update','Welcome to the operations portal','ALL',true,:'e_s');

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
select t_ok((select count(*) from employee_documents) = 1, 'A sees only own employee document metadata');
select t_ok((select count(*) from probation_reviews) = 1, 'A sees only own probation reviews');
select t_ok((select count(*) from exit_clearance_items) = 1, 'A sees only own exit clearance');
select t_ok((select count(*) from employee_letters) = 1, 'A sees only own issued letters');
select t_ok((select count(*) from storage.objects where bucket_id='employee-private') = 1, 'A can access only own private storage object');
select t_denied(format($$insert into employee_documents(org_id,employee_id,category,title,storage_path,original_name,mime_type,size_bytes,uploaded_by) values (%L,%L,'IDENTITY','forged','%s','fake.pdf','application/pdf',100,%L)$$, :'org', :'e_a', :'org'||'/'||:'e_a'||'/forged.pdf', :'e_a'), 'A cannot upload employee documents');
select t_denied(format($$update probation_reviews set status='APPROVED', recommendation='CONFIRM', approved_at=now() where employee_id=%L$$, :'e_a'), 'employee cannot forge probation approval');
select t_denied(format($$update employee_letters set status='REVOKED', revoked_at=now() where employee_id=%L$$, :'e_a'), 'employee cannot revoke employment letters');
select t_ok((select count(*) from audit_events) = 0, 'A cannot read audit log');
select t_ok((select count(*) from payroll_runs) = 0, 'A cannot list payroll runs');
select t_ok((select count(*) from projects where id='88888888-0000-0000-0000-000000000001') = 1, 'A sees a project they are a member of');
select t_ok((select count(*) from project_milestones where project_id='88888888-0000-0000-0000-000000000001') = 1, 'A sees project milestones');
select t_ok((select count(*) from chat_channels where id='88888888-0000-0000-0000-000000000021') = 1, 'A can discover public company channels');
select t_ok((select count(*) from chat_channels where id='88888888-0000-0000-0000-000000000022') = 0, 'A cannot discover a private group');
select t_ok((select count(*) from chat_messages where channel_id='88888888-0000-0000-0000-000000000021') = 0, 'A cannot read public channel messages before joining');
insert into chat_channel_members(channel_id,employee_id) values ('88888888-0000-0000-0000-000000000021',:'e_a');
select t_ok((select count(*) from chat_messages where channel_id='88888888-0000-0000-0000-000000000021') = 1, 'A reads public channel messages after joining');
select t_ok((select count(*) from chat_messages where channel_id='88888888-0000-0000-0000-000000000022') = 0, 'A cannot read private group messages');
select t_rows(format($q$insert into chat_messages(org_id,channel_id,author_id,body) values (%L,%L,%L,'Hello team')$q$,:'org','88888888-0000-0000-0000-000000000021',:'e_a'),1,'A can send a message in a joined channel');
select t_rows(format($q$insert into chat_message_reports(org_id,channel_id,message_id,reporter_id,reason,details) values (%L,%L,%L,%L,'SPAM','Test report')$q$,:'org','88888888-0000-0000-0000-000000000021','88888888-0000-0000-0000-000000000031',:'e_a'),1,'A can report another member message in a joined channel');
select t_ok((select count(*)=1 from chat_message_reports where reporter_id=:'e_a'),'A can view own message report');
select t_ok(is_sensitive_permission('communication.moderate') and is_sensitive_permission('communication.channel_manage'),'moderation and channel administration are protected grants');
select t_rows(format($q$insert into storage.objects(bucket_id,name) values ('chat-files',%L)$q$,:'org'||'/88888888-0000-0000-0000-000000000021/'||:'e_a'||'/a-note.txt'),1,'A can upload a private chat attachment to a joined channel');
select t_ok((select count(*) from storage.objects where bucket_id='chat-files')=1,'A can see own chat attachment object');
select t_ok((select count(*) from company_announcements where id='88888888-0000-0000-0000-000000000041')=1,'A can read company-wide announcement');
select t_denied(format($$insert into chat_channel_members(channel_id,employee_id) values (%L,%L)$$,'88888888-0000-0000-0000-000000000022',:'e_a'),'A cannot self-join a private group');
select t_denied(format($$insert into chat_channel_members(channel_id,employee_id) values (%L,%L)$$,'88888888-0000-0000-0000-000000000021',:'e_b'),'A cannot add another employee through direct membership writes');
select t_denied(format($$update chat_channel_members set member_role='OWNER' where channel_id=%L and employee_id=%L$$,'88888888-0000-0000-0000-000000000021',:'e_a'),'A cannot promote themself by changing a membership row');
select t_rows(format($q$insert into project_time_entries(org_id,project_id,employee_id,work_date,hours,notes) values (%L,%L,%L,current_date,2,'Build project module')$q$,:'org','88888888-0000-0000-0000-000000000001',:'e_a'),1,'A submits project time');
select id as time_a from project_time_entries where employee_id=:'e_a' and project_id='88888888-0000-0000-0000-000000000001' \gset
select t_denied(format($$update project_time_entries set status='APPROVED', decided_by=%L, decided_at=now() where id=%L$$, :'e_a', :'time_a'), 'employee cannot self-approve project time');
select t_rows(format($q$insert into project_updates(org_id,project_id,author_id,body) values (%L,%L,%L,'Delivery update')$q$,:'org','88888888-0000-0000-0000-000000000001',:'e_a'),1,'A posts project update');
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
select t_ok((select count(*) from employee_documents) = 1, 'B cannot see A private document');
select t_ok((select count(*) from probation_reviews) = 1, 'B cannot see A probation review');
select t_ok((select count(*) from exit_clearance_items) = 1, 'B cannot see A exit clearance');
select t_ok((select count(*) from employee_letters) = 1, 'B cannot see A issued letter');
select t_ok((select count(*) from storage.objects where bucket_id='employee-private') = 1, 'B cannot access A private storage object');
select t_ok((select count(*) from attendance_events) = 0, 'B cannot see A''s attendance');
select t_ok((select count(*) from chat_channels where id='88888888-0000-0000-0000-000000000022') = 1, 'B sees the private group they belong to');
select t_ok((select count(*) from chat_messages where channel_id='88888888-0000-0000-0000-000000000022') = 1, 'B reads private group messages');
select t_ok((select count(*) from storage.objects where bucket_id='chat-files') = 0, 'B cannot read A private chat attachment');
select t_ok((select count(*) from company_announcements where id='88888888-0000-0000-0000-000000000041') = 1, 'B can read company-wide announcement');
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
select decide_project_time_entry(:'time_a',true,'Approved by team lead');
select t_ok((select status from project_time_entries where id=:'time_a')='APPROVED', 'project time approval persisted');
select t_rows(format($q$insert into chat_message_reports(org_id,channel_id,message_id,reporter_id,reason,details) values (%L,%L,%L,%L,'INAPPROPRIATE','Private channel review test')$q$,:'org','88888888-0000-0000-0000-000000000022','88888888-0000-0000-0000-000000000032',:'e_m'),1,'M can report a message in a private channel they belong to');
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
select t_ok((select count(*) from employee_documents) = 2, 'HR sees employee document metadata');
select t_ok((select count(*) from probation_reviews) = 2, 'HR sees probation review queue');
select t_ok((select count(*) from exit_clearance_items) = 2, 'HR sees exit clearance queue');
select t_ok((select count(*) from employee_letters) = 2, 'HR sees issued employment letters');
select t_denied(format($$insert into employee_documents(org_id,employee_id,category,title,storage_path,original_name,mime_type,size_bytes,uploaded_by) values (%L,%L,'IDENTITY','cross org','%s','bad.pdf','application/pdf',100,%L)$$, :'org', :'e_x', :'org'||'/'||:'e_x'||'/bad.pdf', :'e_h'), 'HR cannot attach a foreign-organization employee document');
select submit_probation_review('99999999-0000-0000-0000-000000000011','Reviewed by HR');
select decide_probation_review('99999999-0000-0000-0000-000000000011','CONFIRM','Confirmed after review',null);
select t_ok((select status='ACTIVE' from employees where id=:'e_a'), 'probation confirmation updates employee status atomically');
select submit_probation_review('99999999-0000-0000-0000-000000000012','Needs further time');
select decide_probation_review('99999999-0000-0000-0000-000000000012','EXTEND','Extend for another cycle','2027-01-15');
select t_ok((select status='PROBATION' from employees where id=:'e_b'), 'probation extension keeps employee on probation');
select t_ok((select next_review_date='2027-01-15' from probation_reviews where id='99999999-0000-0000-0000-000000000012'), 'probation extension stores next review date');
select revoke_employee_letter('99999999-0000-0000-0000-000000000031');
select t_ok((select status='REVOKED' from employee_letters where id='99999999-0000-0000-0000-000000000031'), 'HR revokes an issued letter through controlled RPC');
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


-- ===========================================================================
-- 11. Notification preferences, digest, integration status (0007)
-- ===========================================================================
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_rows(format($$insert into notification_preferences(org_id,employee_id,category,mode) values (%L,%L,'TASKS','MUTED')$$, :'org', :'e_a'), 1, 'A sets own email preference');
select t_denied(format($$insert into notification_preferences(org_id,employee_id,category,mode) values (%L,%L,'TASKS','MUTED')$$, :'org', :'e_b'), 'A cannot set B''s preferences');
select t_denied(format($$insert into notification_preferences(org_id,employee_id,category,mode) values (%L,%L,'SYSTEM','MUTED')$$, :'org', :'e_a'), 'SYSTEM emails can never be muted');
select t_denied($$select enqueue_email(null,'x@y.z',null,'task.assigned','{}','hack')$$, 'employees cannot enqueue arbitrary emails');
select t_ok((select count(*) from integration_status) = 0, 'A cannot read integration status');
select t_denied($$select record_integration_test('email', true)$$, 'A cannot record integration tests');
select t_denied($$select retry_failed_emails()$$, 'A cannot re-queue emails');
reset role;

-- Muted: task assigned to A by M → in-app notification still created, email SKIPPED
select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
insert into tasks(org_id,title,assignee_id) values (:'org','Muted email test',:'e_a') returning id as t_muted \gset
reset role;
select t_ok((select status from email_outbox where dedupe_key = 'task.assigned:' || :'t_muted' || ':' || :'e_a') = 'SKIPPED', 'muted category → email skipped (kept for traceability)');
select t_ok((select count(*) from notifications where dedupe_key = 'task.assigned:' || :'t_muted' || ':' || :'e_a') = 1, 'muted email still leaves the in-app notification');

-- Digest: switch to DIGEST → no outbox row, a digest item instead; build sends one email
update notification_preferences set mode = 'DIGEST' where employee_id = :'e_a' and category = 'TASKS';
select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
insert into tasks(org_id,title,assignee_id) values (:'org','Digest test 1',:'e_a') returning id as t_d1 \gset
insert into tasks(org_id,title,assignee_id) values (:'org','Digest test 2',:'e_a') returning id as t_d2 \gset
reset role;
select t_ok((select count(*) from email_outbox where dedupe_key in ('task.assigned:' || :'t_d1' || ':' || :'e_a', 'task.assigned:' || :'t_d2' || ':' || :'e_a')) = 0, 'digest mode → no immediate email');
select t_ok((select count(*) from notification_digest_items where employee_id = :'e_a' and sent_at is null) = 2, 'digest mode → items collected');
select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select t_ok((select count(*) from notification_digest_items) = 0, 'B cannot see A''s digest items');
reset role;
set role service_role;
select t_ok(build_daily_digests() >= 1, 'digest builder runs (service role)');
reset role;
select t_ok((select jsonb_array_length(payload->'items') from email_outbox where template = 'digest.daily' and recipient_employee_id = :'e_a') = 2, 'one digest email carrying both items');
select t_ok((select count(*) from notification_digest_items where employee_id = :'e_a' and sent_at is null) = 0, 'digest items marked sent');
set role service_role;
select t_ok(build_daily_digests() = 0, 'running the builder again sends nothing twice');
reset role;
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_denied($$select build_daily_digests()$$, 'employees cannot trigger digests');
reset role;

-- Integration status: admin records a real test; failures count up, success resets
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select record_integration_test('email', false, 'Brevo 401: key not valid');
select record_integration_test('email', false, 'Brevo 401: key not valid');
select t_ok((select failure_count from integration_status where key = 'email') = 2, 'failed tests are counted');
select record_integration_test('email', true);
select t_ok((select failure_count = 0 and last_test_ok from integration_status where key = 'email'), 'a passing test resets the failure count');
select t_ok((select count(*) from audit_events where action = 'integration.tested') = 3, 'integration tests are audited');
reset role;
update email_outbox set status = 'FAILED', next_attempt_at = 'infinity' where template = 'digest.daily';
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select t_ok(retry_failed_emails() >= 1, 'admin re-queues failed emails');
reset role;
select t_ok((select count(*) from email_outbox where status = 'FAILED') = 0, 'failed emails are queued again');


-- ==========================================================================
-- 12. Recruitment + employee lifecycle (0008)
-- ==========================================================================
select set_config('request.jwt.claim.sub', :'H', false); set role authenticated;
insert into candidates(org_id,full_name,email,role_applied,department_id,created_by,owner_id)
values (:'org','Candidate One','candidate.one@vsm.test','SEO Executive',:'dev',:'e_h',:'e_h')
returning id as candidate1 \gset
select t_ok((select count(*) from candidates where id=:'candidate1')=1,'HR can create and read recruitment candidates');
insert into candidate_interviews(org_id,candidate_id,interviewer_id,scheduled_at,interview_type)
values (:'org',:'candidate1',:'e_m',now()+interval '1 day','TECHNICAL');
select t_ok((select count(*) from candidate_interviews where candidate_id=:'candidate1')=1,'HR can schedule candidate interviews');
select t_denied(format($$select hire_candidate(%L,'VSM-0098',current_date,'FULL_TIME')$$, :'candidate1'),'candidate cannot be hired before offer stage');
update candidates set stage='OFFER' where id=:'candidate1';
select hire_candidate(:'candidate1','VSM-0099',current_date,'FULL_TIME') as hired_employee \gset
select t_ok((select stage='HIRED' and converted_employee_id=:'hired_employee'::uuid from candidates where id=:'candidate1'),'candidate conversion is atomic and marks candidate hired');
select t_ok((select count(*)=5 from onboarding_checklist_items where employee_id=:'hired_employee'::uuid),'hiring creates onboarding checklist items');
select t_ok((select count(*)=1 from employment_events where employee_id=:'hired_employee'::uuid and event_type='JOINED'),'new employee joining event is recorded');
select t_ok((select count(*)=1 from employment_events where employee_id=:'hired_employee'::uuid and event_type='PROBATION_STARTED'),'new employee probation event is recorded');
select id as onboarding_item from onboarding_checklist_items where employee_id=:'hired_employee'::uuid limit 1 \gset
select t_rows(format($$update onboarding_checklist_items set completed_at=now(),completed_by=%L where id=%L$$, :'e_h', :'onboarding_item'),1,'HR can complete an onboarding checklist item');
select t_denied(format($$update onboarding_checklist_items set title='Forged task' where id=%L$$, :'onboarding_item'),'HR cannot edit checklist content through completion permission');
select t_denied(format($$select hire_candidate(%L,'VSM-0100',current_date,'FULL_TIME')$$, :'candidate1'),'candidate cannot be hired twice');
reset role;
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_ok((select count(*) from candidates)=0,'ordinary employee cannot read recruitment records');
select t_ok((select count(*) from candidate_interviews)=0,'ordinary employee cannot read interview feedback');
reset role;
select set_config('request.jwt.claim.sub', :'H', false); set role authenticated;
insert into candidates(org_id,full_name,email,role_applied,created_by) values (:'org','Candidate Two','candidate.two@vsm.test','Web Designer',:'e_h') returning id as candidate2 \gset
select t_denied(format($$insert into candidate_interviews(org_id,candidate_id,interviewer_id,scheduled_at) values (%L,%L,%L,now())$$, :'org', :'candidate2', :'e_x'),'interview cannot reference an employee in another organization');
reset role;

-- ===========================================================================
-- 13. Finance ERP (0010): employee isolation, approval chain, payment & bank match
-- ===========================================================================
insert into role_permissions(org_id,role,permission) values
 (:'org','TEAM_LEAD','finance.approve_manager'),
 (:'org','HR_MANAGER','finance.view'),(:'org','HR_MANAGER','finance.manage'),(:'org','HR_MANAGER','finance.approve'),(:'org','HR_MANAGER','finance.pay'),(:'org','HR_MANAGER','finance.export')
on conflict do nothing;
insert into clients(org_id,name) values (:'org','Finance Test Client') returning id as finance_client \gset
insert into vendors(org_id,name,created_by) values (:'org','Finance Test Vendor',:'e_h') returning id as finance_vendor \gset
insert into vendors(org_id,name,created_by) values (:'org2','Other Org Vendor',:'e_x') returning id as other_vendor \gset
insert into storage.objects(bucket_id,name) values ('finance-receipts',:'org'||'/'||:'e_a'||'/receipt-a.pdf'),('finance-receipts',:'org'||'/'||:'e_b'||'/receipt-b.pdf');
insert into finance_expenses(id,org_id,expense_code,expense_type,employee_id,vendor_id,project_id,department_id,category,description,amount,expense_date,receipt_path,receipt_name,receipt_mime,receipt_size,status)
 values
 ('88888888-0000-0000-0000-000000000001',:'org','EXP-TEST-A','REIMBURSEMENT',:'e_a',:'finance_vendor',:'proj',:'dev','Travel','Client meeting travel',200,'2026-11-20',:'org'||'/'||:'e_a'||'/receipt-a.pdf','receipt-a.pdf','application/pdf',1000,'SUBMITTED'),
 ('88888888-0000-0000-0000-000000000002',:'org','EXP-TEST-B','REIMBURSEMENT',:'e_b',null,null,:'sales','Meals','Sales meeting meal',300,'2026-11-20',:'org'||'/'||:'e_b'||'/receipt-b.pdf','receipt-b.pdf','application/pdf',1000,'SUBMITTED');
insert into client_invoices(id,org_id,invoice_number,client_id,issue_date,due_date,subtotal,tax_amount,status,issued_by)
 values ('88888888-0000-0000-0000-000000000011',:'org','VSM-TEST-INV',:'finance_client','2026-11-20','2026-12-20',200,0,'DRAFT',:'e_h');
insert into invoice_lines(org_id,invoice_id,description,quantity,unit_price) values (:'org','88888888-0000-0000-0000-000000000011','Test service',1,200);

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select t_ok((select count(*) from finance_expenses)=1,'employee sees only own expense claims');
select t_ok((select count(*) from storage.objects where bucket_id='finance-receipts')=1,'employee sees only own private receipts');
select t_denied(format($$update finance_expenses set status='APPROVED' where id=%L$$,'88888888-0000-0000-0000-000000000001'),'employee cannot update expense approval state directly');
select t_denied(format($$insert into finance_expenses(org_id,expense_code,expense_type,employee_id,category,description,amount,expense_date) values (%L,'EXP-FORGE','REIMBURSEMENT',%L,'Travel','Claim for colleague',100,current_date)$$,:'org',:'e_b'),'employee cannot submit claim for another employee');
reset role;

select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
select t_ok((select count(*) from finance_expenses)=1,'team lead sees direct report expense but not other department');
select t_ok((select count(*) from storage.objects where bucket_id='finance-receipts')=1,'team lead sees receipt for direct report only');
select finance_expense_decide('88888888-0000-0000-0000-000000000001','APPROVE','Manager checked receipt');
select t_ok((select status='MANAGER_APPROVED' from finance_expenses where id='88888888-0000-0000-0000-000000000001'),'manager approval advances claim one stage');
select t_denied($$select finance_expense_decide('88888888-0000-0000-0000-000000000001','APPROVE','second stage')$$,'manager cannot self-approve finance stage');
reset role;

select set_config('request.jwt.claim.sub', :'H', false); set role authenticated;
select t_ok((select count(*)>=2 from chat_message_reports where status='OPEN'),'HR moderator can review reports from multiple channels');
select t_ok((select count(*)=1 from chat_messages where channel_id='88888888-0000-0000-0000-000000000022'),'HR moderator can inspect a reported private conversation without joining it');
select t_ok((select count(*)=0 from chat_messages where channel_id='88888888-0000-0000-0000-000000000023'),'HR moderator cannot read an unreported private conversation');
select moderate_chat_message('88888888-0000-0000-0000-000000000031','HIDE','Spam content');
select t_ok((select deleted_at is not null from chat_messages where id='88888888-0000-0000-0000-000000000031'),'authorized moderator can hide a reported message');
select t_ok((select status='ACTIONED' and reviewed_by=:'e_h' from chat_message_reports where reporter_id=:'e_a'),'moderation resolves linked reports with reviewer audit');
select t_ok((select count(*) from finance_expenses)=2,'finance can view company expense register');
select t_ok(is_sensitive_permission('finance.manage') and is_sensitive_permission('finance.pay'),'finance permissions are protected by the SQL sensitive-grant guard');
select t_ok((select count(*)=7 from role_permissions where org_id=:'org' and role='ADMIN' and permission like 'finance.%'),'default Admin role receives the documented finance permission set');
select finance_expense_decide('88888888-0000-0000-0000-000000000001','APPROVE','Finance verified');
select t_ok((select status='APPROVED' from finance_expenses where id='88888888-0000-0000-0000-000000000001'),'finance approval completes two-person chain');
select finance_mark_expense_paid('88888888-0000-0000-0000-000000000001','BANK-EXP-TEST','BANK_TRANSFER','2026-11-21');
select t_ok((select status='PAID' and paid_on='2026-11-21' from finance_expenses where id='88888888-0000-0000-0000-000000000001'),'approved expense payment is recorded');
select finance_issue_invoice('88888888-0000-0000-0000-000000000011');
select t_ok((select status='ISSUED' from client_invoices where id='88888888-0000-0000-0000-000000000011'),'draft invoice can be issued through controlled RPC');
select finance_record_invoice_payment('88888888-0000-0000-0000-000000000011',200,'2026-11-21','BANK_TRANSFER','BANK-INV-TEST','Test collection');
select t_ok((select status='PAID' from client_invoices where id='88888888-0000-0000-0000-000000000011'),'invoice payment marks invoice paid at exact balance');
select finance_create_invoice(:'finance_client',null,'VSM-CREATED-RPC','2026-11-21','2026-12-21','Monthly SEO services',1,500,90,'RPC-created draft') as rpc_invoice \gset
select t_ok((select status='DRAFT' from client_invoices where id=:'rpc_invoice') and (select count(*)=1 from invoice_lines where invoice_id=:'rpc_invoice'),'invoice RPC creates header and line atomically');
select t_denied($$insert into client_invoices(org_id,invoice_number,client_id,issue_date,due_date,subtotal,issued_by) values ('11111111-0000-0000-0000-000000000000','FORGED','11111111-0000-0000-0000-000000000000',current_date,current_date,10,'11111111-0000-0000-0000-000000000000')$$,'finance user cannot bypass invoice creation RPC');
insert into bank_reconciliations(id,org_id,statement_date,bank_account_label,opening_balance,closing_balance,created_by)
 values ('88888888-0000-0000-0000-000000000021',:'org','2026-11-21','Test current account',1000,1200,:'e_h');
insert into bank_statement_lines(id,org_id,reconciliation_id,transaction_date,description,reference,debit,credit)
 values ('88888888-0000-0000-0000-000000000022',:'org','88888888-0000-0000-0000-000000000021','2026-11-21','Client receipt','BANK-INV-TEST',0,200);
select finance_match_statement_line('88888888-0000-0000-0000-000000000022','INVOICE_PAYMENT',(select id from invoice_payments where reference='BANK-INV-TEST'));
select t_ok((select matched_id is not null from bank_statement_lines where id='88888888-0000-0000-0000-000000000022'),'bank statement line matched to invoice receipt');
select finance_close_reconciliation('88888888-0000-0000-0000-000000000021');
select t_ok((select status='RECONCILED' from bank_reconciliations where id='88888888-0000-0000-0000-000000000021'),'reconciliation closes only after amount and match checks');
select t_denied(format($$insert into bank_statement_lines(org_id,reconciliation_id,transaction_date,description,debit,credit) values (%L,%L,current_date,'Late line',1,0)$$,:'org','88888888-0000-0000-0000-000000000021'),'closed reconciliation rejects additional statement lines');
select t_denied(format($$insert into finance_expenses(org_id,expense_code,expense_type,employee_id,vendor_id,category,description,amount,expense_date) values (%L,'EXP-CROSS-VENDOR','COMPANY_EXPENSE',%L,%L,'Other','Cross-org vendor attempt',100,current_date)$$,:'org',:'e_h',:'other_vendor'),'finance expense cannot reference another organisation vendor');
reset role;

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
