-- =============================================================================
-- 0031 · Block 23 — VSM Scholars: courses, batches, students & counselling pipeline, enrolments, fees & receipts,
-- class attendance, certificates with public QR verification, referrals. Post-based access (Course Counsellor,
-- Trainer) via designations.grants.
-- =============================================================================
-- Post-based permissions: a post can carry extra (non-sensitive) permissions, e.g. Course Counsellor → scholars.manage.
alter table designations add column if not exists grants text[] not null default '{}';
create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.role = 'SUPER_ADMIN' then true
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'DENY' and (o.expires_at is null or o.expires_at > now())) then false
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'GRANT' and (o.expires_at is null or o.expires_at > now())) then true
      when exists (select 1 from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p) then true
      else not is_sensitive_permission(p) and exists (
        select 1 from designations d where d.org_id = e.org_id and d.is_active and e.designation is not null
          and lower(d.title) = lower(e.designation) and p = any(d.grants))
    end
    from employees e where e.user_id = auth.uid() and e.status <> 'EXITED' limit 1), false)
$$;

create table if not exists scholar_courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}$'),
  name text not null check (length(name) between 3 and 120),
  duration_weeks int check (duration_weeks between 1 and 104),
  fee numeric(12,2) check (fee >= 0),
  description text, is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create table if not exists scholar_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references scholar_courses(id),
  name text not null check (length(name) between 2 and 80),
  trainer_id uuid references employees(id) on delete set null,
  starts_on date not null, ends_on date,
  schedule text check (length(schedule) <= 120),
  mode text not null default 'OFFLINE' check (mode in ('OFFLINE','ONLINE','HYBRID')),
  location text check (length(location) <= 80),
  capacity int not null default 25 check (capacity between 1 and 500),
  status text not null default 'PLANNED' check (status in ('PLANNED','RUNNING','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on), unique (org_id, name)
);
create table if not exists scholar_students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 120),
  phone text not null check (phone ~ '^\+?[0-9]{10,13}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city text check (length(city) <= 80),
  source text not null default 'WALK_IN' check (source in ('WALK_IN','WEBSITE','INSTAGRAM','REFERRAL','AFFILIATE','CAMPAIGN','OTHER')),
  stage text not null default 'ENQUIRY' check (stage in ('ENQUIRY','COUNSELLED','DEMO','ENROLLED','ALUMNI','DROPPED','LOST')),
  counsellor_id uuid references employees(id) on delete set null,
  interested_course_id uuid references scholar_courses(id) on delete set null,
  next_follow_up_at timestamptz,
  notes text check (length(notes) <= 4000),
  referral_code text not null default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  referred_by uuid references scholar_students(id) on delete set null,
  affiliate_code text check (affiliate_code ~ '^[A-Za-z0-9_-]{3,32}$'),
  lost_reason text,
  created_by uuid references employees(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, phone), unique (referral_code)
);
create index if not exists scholar_students_stage_idx on scholar_students(org_id, stage, next_follow_up_at);
create table if not exists scholar_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references scholar_students(id) on delete cascade,
  batch_id uuid not null references scholar_batches(id),
  fee_total numeric(12,2) not null check (fee_total >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','COMPLETED','DROPPED')),
  enrolled_at timestamptz not null default now(), completed_at timestamptz,
  created_by uuid references employees(id),
  check (discount <= fee_total), unique (student_id, batch_id)
);
create sequence if not exists scholar_receipt_seq;
create table if not exists scholar_fee_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  enrollment_id uuid not null references scholar_enrollments(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  due_on date not null,
  status text not null default 'DUE' check (status in ('DUE','PAID','WAIVED')),
  paid_on date, method text check (method in ('CASH','UPI','BANK','RAZORPAY','CARD','OTHER')),
  reference text check (length(reference) <= 120),
  receipt_no text unique,
  recorded_by uuid references employees(id), confirmed_by uuid references employees(id), confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'PAID' or (paid_on is not null and method is not null and receipt_no is not null and confirmed_by is not null))
);
create table if not exists scholar_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references scholar_batches(id) on delete cascade,
  session_date date not null, topic text check (length(topic) <= 200),
  marked_by uuid references employees(id), created_at timestamptz not null default now(),
  unique (batch_id, session_date)
);
create table if not exists scholar_session_attendance (
  session_id uuid not null references scholar_sessions(id) on delete cascade,
  student_id uuid not null references scholar_students(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  present boolean not null,
  primary key (session_id, student_id)
);
create sequence if not exists scholar_certificate_seq;
create table if not exists scholar_certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  enrollment_id uuid not null unique references scholar_enrollments(id) on delete cascade,
  certificate_no text not null unique,
  verify_code text not null unique default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  grade text check (grade in ('A+','A','B','C','PASS')),
  issued_on date not null default current_date,
  issued_by uuid references employees(id),
  revoked_at timestamptz, revoked_reason text check (length(revoked_reason) <= 300)
);
create table if not exists scholar_referral_rewards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  referrer_id uuid not null references scholar_students(id) on delete cascade,
  referred_id uuid not null unique references scholar_students(id) on delete cascade,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PAID','REJECTED')),
  created_at timestamptz not null default now(), decided_by uuid references employees(id)
);

-- RLS
alter table scholar_courses enable row level security;
alter table scholar_batches enable row level security;
alter table scholar_students enable row level security;
alter table scholar_enrollments enable row level security;
alter table scholar_fee_payments enable row level security;
alter table scholar_sessions enable row level security;
alter table scholar_session_attendance enable row level security;
alter table scholar_certificates enable row level security;
alter table scholar_referral_rewards enable row level security;

create or replace function is_my_batch(p_batch uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from scholar_batches b where b.id = p_batch and b.trainer_id = current_employee_id())
$$;

do $$ declare t text;
begin
  foreach t in array array['scholar_courses','scholar_batches','scholar_students','scholar_enrollments','scholar_fee_payments',
                           'scholar_sessions','scholar_session_attendance','scholar_certificates','scholar_referral_rewards'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
  end loop;
end $$;
create policy scholar_courses_read on scholar_courses for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.view') or has_perm('scholars.teach')));
create policy scholar_courses_write on scholar_courses for all to authenticated using (org_id = current_org_id() and has_perm('scholars.admin')) with check (org_id = current_org_id() and has_perm('scholars.admin'));
create policy scholar_batches_read on scholar_batches for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.view') or trainer_id = current_employee_id()));
create policy scholar_batches_write on scholar_batches for all to authenticated using (org_id = current_org_id() and has_perm('scholars.admin')) with check (org_id = current_org_id() and has_perm('scholars.admin'));
create policy scholar_students_read on scholar_students for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.view')
  or exists (select 1 from scholar_enrollments en join scholar_batches b on b.id = en.batch_id where en.student_id = scholar_students.id and b.trainer_id = current_employee_id())));
create policy scholar_students_write on scholar_students for all to authenticated using (org_id = current_org_id() and has_perm('scholars.manage')) with check (org_id = current_org_id() and has_perm('scholars.manage'));
create policy scholar_enrollments_read on scholar_enrollments for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.view') or is_my_batch(batch_id)));
create policy scholar_enrollments_write on scholar_enrollments for all to authenticated using (org_id = current_org_id() and has_perm('scholars.manage')) with check (org_id = current_org_id() and has_perm('scholars.manage'));
create policy scholar_fee_payments_read on scholar_fee_payments for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.fees') or has_perm('scholars.manage')));
create policy scholar_fee_payments_write on scholar_fee_payments for insert to authenticated with check (org_id = current_org_id() and has_perm('scholars.manage') and status = 'DUE');
create policy scholar_sessions_read on scholar_sessions for select to authenticated using (org_id = current_org_id() and (has_perm('scholars.view') or is_my_batch(batch_id)));
create policy scholar_sessions_write on scholar_sessions for all to authenticated using (org_id = current_org_id() and (has_perm('scholars.admin') or is_my_batch(batch_id))) with check (org_id = current_org_id() and (has_perm('scholars.admin') or is_my_batch(batch_id)));
create policy scholar_session_attendance_read on scholar_session_attendance for select to authenticated using (org_id = current_org_id() and exists (select 1 from scholar_sessions s where s.id = session_id));
create policy scholar_session_attendance_write on scholar_session_attendance for all to authenticated
  using (org_id = current_org_id() and exists (select 1 from scholar_sessions s where s.id = session_id and (has_perm('scholars.admin') or is_my_batch(s.batch_id))))
  with check (org_id = current_org_id() and exists (select 1 from scholar_sessions s where s.id = session_id and (has_perm('scholars.admin') or is_my_batch(s.batch_id))));
create policy scholar_certificates_read on scholar_certificates for select to authenticated using (org_id = current_org_id() and has_perm('scholars.view'));
create policy scholar_referral_rewards_read on scholar_referral_rewards for select to authenticated using (org_id = current_org_id() and has_perm('scholars.view'));
revoke insert, update, delete on scholar_certificates, scholar_referral_rewards from authenticated;
revoke update, delete on scholar_fee_payments from authenticated;

-- Fees are confirmed only by someone with scholars.fees, with a method + reference; receipt numbers are sequential.
create or replace function scholar_confirm_payment(p_payment uuid, p_method text, p_reference text, p_paid_on date default current_date)
returns scholar_fee_payments language plpgsql security definer set search_path = public, pg_temp as $$
declare v scholar_fee_payments; y text := to_char(coalesce(p_paid_on, current_date), 'YYYY');
begin
  if not has_perm('scholars.fees') then raise exception 'scholars.fees required' using errcode='42501'; end if;
  if p_method not in ('CASH','UPI','BANK','RAZORPAY','CARD','OTHER') then raise exception 'invalid method'; end if;
  if p_method <> 'CASH' and coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the UPI / bank / Razorpay reference.' using errcode='P0001'; end if;
  if p_paid_on > current_date then raise exception 'Payment date cannot be in the future.' using errcode='P0001'; end if;
  update scholar_fee_payments set status = 'PAID', method = p_method, reference = nullif(btrim(p_reference), ''), paid_on = p_paid_on,
         receipt_no = 'VSMS-' || y || '-' || lpad(nextval('scholar_receipt_seq')::text, 5, '0'),
         confirmed_by = current_employee_id(), confirmed_at = now()
   where id = p_payment and org_id = current_org_id() and status = 'DUE' returning * into v;
  if v.id is null then raise exception 'Payment not found or already settled.' using errcode='P0001'; end if;
  perform log_audit('scholars.fee_confirmed', 'scholar_fee_payment', v.id::text, jsonb_build_object('receipt', v.receipt_no, 'method', p_method));
  return v;
end $$;
grant execute on function scholar_confirm_payment(uuid, text, text, date) to authenticated;

create or replace function scholar_waive_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_perm('scholars.fees') then raise exception 'scholars.fees required' using errcode='42501'; end if;
  if length(coalesce(p_reason, '')) < 5 then raise exception 'Give a reason (5+ characters).' using errcode='P0001'; end if;
  update scholar_fee_payments set status = 'WAIVED', confirmed_by = current_employee_id(), confirmed_at = now()
   where id = p_payment and org_id = current_org_id() and status = 'DUE';
  if not found then raise exception 'Payment not found or already settled.' using errcode='P0001'; end if;
  perform log_audit('scholars.fee_waived', 'scholar_fee_payment', p_payment::text, jsonb_build_object('reason', left(p_reason, 200)));
end $$;
grant execute on function scholar_waive_payment(uuid, text) to authenticated;

-- Certificates: only for an enrolment whose fees are settled and attendance ≥ the threshold (default 75%).
create or replace function scholar_issue_certificate(p_enrollment uuid, p_grade text default 'PASS', p_min_attendance int default 75)
returns scholar_certificates language plpgsql security definer set search_path = public, pg_temp as $$
declare en scholar_enrollments; c scholar_certificates; v_total int; v_present int; v_due int;
begin
  if not has_perm('scholars.certify') then raise exception 'scholars.certify required' using errcode='42501'; end if;
  select * into en from scholar_enrollments where id = p_enrollment and org_id = current_org_id();
  if en.id is null then raise exception 'Enrolment not found.'; end if;
  select count(*) into v_due from scholar_fee_payments where enrollment_id = en.id and status = 'DUE';
  if v_due > 0 then raise exception 'Fees are still due (% instalment(s)). Settle or waive them first.', v_due using errcode='P0001'; end if;
  select count(*), count(*) filter (where a.present) into v_total, v_present
    from scholar_sessions s left join scholar_session_attendance a on a.session_id = s.id and a.student_id = en.student_id
   where s.batch_id = en.batch_id;
  if v_total > 0 and v_present * 100 < v_total * greatest(0, least(p_min_attendance, 100)) then
    raise exception 'Attendance is % (needs %).', round(v_present * 100.0 / v_total) || '%', p_min_attendance || '%' using errcode='P0001';
  end if;
  insert into scholar_certificates(org_id, enrollment_id, certificate_no, grade, issued_by)
  values (en.org_id, en.id, 'VSMS-C-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('scholar_certificate_seq')::text, 4, '0'),
          p_grade, current_employee_id())
  on conflict (enrollment_id) do nothing returning * into c;
  if c.id is null then select * into c from scholar_certificates where enrollment_id = en.id; return c; end if;
  update scholar_enrollments set status = 'COMPLETED', completed_at = coalesce(completed_at, now()) where id = en.id;
  update scholar_students set stage = 'ALUMNI', updated_at = now() where id = en.student_id;
  perform log_audit('scholars.certificate_issued', 'scholar_certificate', c.id::text, jsonb_build_object('no', c.certificate_no));
  return c;
end $$;
grant execute on function scholar_issue_certificate(uuid, text, int) to authenticated;

create or replace function scholar_revoke_certificate(p_certificate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_perm('scholars.certify') then raise exception 'scholars.certify required' using errcode='42501'; end if;
  update scholar_certificates set revoked_at = now(), revoked_reason = left(p_reason, 300)
   where id = p_certificate and org_id = current_org_id() and revoked_at is null;
  perform log_audit('scholars.certificate_revoked', 'scholar_certificate', p_certificate::text, '{}');
end $$;
grant execute on function scholar_revoke_certificate(uuid, text) to authenticated;

-- Public verification (anyone with the QR link). Returns only what is printed on the certificate.
create or replace function verify_certificate(p_code text)
returns table(certificate_no text, student_name text, course text, batch text, starts_on date, ends_on date, issued_on date, grade text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.certificate_no, s.full_name, co.name, b.name, b.starts_on, b.ends_on, c.issued_on, c.grade,
         case when c.revoked_at is null then 'VALID' else 'REVOKED' end
  from scholar_certificates c
  join scholar_enrollments en on en.id = c.enrollment_id
  join scholar_students s on s.id = en.student_id
  join scholar_batches b on b.id = en.batch_id
  join scholar_courses co on co.id = b.course_id
  where c.verify_code = lower(btrim(p_code)) and p_code ~* '^[0-9a-f]{12}$'
$$;
grant execute on function verify_certificate(text) to anon, authenticated;

-- Referral reward row when a referred student enrols (amount set later by an admin).
create or replace function scholar_referral_on_enrol() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ref uuid;
begin
  select referred_by into v_ref from scholar_students where id = new.student_id;
  if v_ref is not null then
    insert into scholar_referral_rewards(org_id, referrer_id, referred_id) values (new.org_id, v_ref, new.student_id) on conflict do nothing;
  end if;
  update scholar_students set stage = 'ENROLLED', updated_at = now() where id = new.student_id and stage in ('ENQUIRY','COUNSELLED','DEMO');
  return new;
end $$;
drop trigger if exists scholar_enrollment_referral on scholar_enrollments;
create trigger scholar_enrollment_referral after insert on scholar_enrollments for each row execute function scholar_referral_on_enrol();

-- Seed: courses (fees left blank on purpose — set them in VSM Scholars → Courses), permissions, post grants.
create or replace function seed_scholars(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform seed_vsm_structure(p_org);  -- posts must exist before their grants are set (trigger order is alphabetical)
  insert into scholar_courses(org_id, code, name, duration_weeks, description) values
    (p_org, 'DM', 'Digital Marketing', 12, 'SEO, social media, Meta & Google Ads, content and analytics'),
    (p_org, 'GD', 'Graphic Design', 12, 'Design principles, Photoshop, Illustrator, Canva and brand creatives'),
    (p_org, 'VE', 'Video Editing', 10, 'Premiere Pro, After Effects basics, reels, YouTube and motion graphics')
  on conflict (org_id, code) do nothing;
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role::app_role, r.perm from (values
    ('ADMIN','scholars.view'),('ADMIN','scholars.manage'),('ADMIN','scholars.admin'),('ADMIN','scholars.fees'),('ADMIN','scholars.certify'),
    ('OPERATIONS_MANAGER','scholars.view'),('OPERATIONS_MANAGER','scholars.manage'),('OPERATIONS_MANAGER','scholars.admin'),
    ('OPERATIONS_MANAGER','scholars.fees'),('OPERATIONS_MANAGER','scholars.certify'),
    ('DEPARTMENT_MANAGER','scholars.view')) r(role, perm)
  on conflict do nothing;
  update designations set grants = array(select distinct unnest(grants || array['scholars.view','scholars.manage']))
   where org_id = p_org and title = 'Course Counsellor';
  update designations set grants = array(select distinct unnest(grants || array['scholars.teach']))
   where org_id = p_org and title = 'Trainer';
  update designations set grants = array(select distinct unnest(grants || array['scholars.view','scholars.fees']))
   where org_id = p_org and title = 'Accounts Executive';
end $$;
revoke all on function seed_scholars(uuid) from public, anon, authenticated;
do $$ declare o record; begin for o in select id from organizations loop perform seed_scholars(o.id); end loop; end $$;

create or replace function seed_scholars_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then
    perform seed_scholars(new.org_id);
    insert into attendance_settings(org_id) values (new.org_id) on conflict do nothing;
    insert into payroll_statutory_settings(org_id) values (new.org_id) on conflict do nothing;
    insert into google_workspace_settings(org_id) values (new.org_id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists employees_seed_scholars on employees;
create trigger employees_seed_scholars after insert on employees for each row execute function seed_scholars_on_sa();

-- Audit trail for the money and student records.
drop trigger if exists scholar_students_touch on scholar_students;
create trigger scholar_students_touch before update on scholar_students for each row execute function touch_updated_at();
