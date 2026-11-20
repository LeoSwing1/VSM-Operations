-- =============================================================================
-- 0003 Performance & Payroll
-- Salary data is visible ONLY to the employee themself and to roles holding
-- payroll.view_all. Managers do not inherit salary visibility.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------
create or replace function valid_weights(w jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(w) = 'object'
     and not exists (select 1 from jsonb_object_keys(w) k where k not in
         ('task_completion','task_quality','on_time_delivery','productivity','attendance','daily_updates','manager_review','rework'))
     and not exists (select 1 from jsonb_each(w) e where jsonb_typeof(e.value) <> 'number' or (e.value)::numeric < 0)
     and (select coalesce(sum((value)::numeric), 0) from jsonb_each(w)) = 100
$$;

create table performance_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  department_id uuid references departments(id) on delete cascade,
  role app_role,
  weights jsonb not null check (valid_weights(weights)),
  min_coverage numeric(5,2) not null default 60 check (min_coverage between 0 and 100),
  category_thresholds jsonb not null default '{"EXCEPTIONAL":90,"EXCELLENT":80,"GOOD":65,"NEEDS_IMPROVEMENT":50}',
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create type snapshot_status as enum ('DRAFT','APPROVED','SUPERSEDED');

create table performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  policy_id uuid not null references performance_policies(id),
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,          -- raw inputs + source record ids
  components jsonb not null,       -- per-dimension score, weight, contribution
  computed_score numeric(5,2),     -- null = insufficient data
  adjustment numeric(5,2) not null default 0,
  final_score numeric(5,2),
  category text,
  coverage numeric(5,2) not null,
  status snapshot_status not null default 'DRAFT',
  computed_by uuid references employees(id),
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index perf_one_live_snapshot on performance_snapshots(employee_id, period_start, period_end)
  where status <> 'SUPERSEDED';

create table score_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  snapshot_id uuid not null references performance_snapshots(id) on delete cascade,
  delta numeric(5,2) not null check (delta between -20 and 20 and delta <> 0),
  reason text not null check (length(reason) >= 10),
  adjusted_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);

create table manager_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  reviewer_id uuid not null references employees(id),
  period_start date not null,
  period_end date not null,
  rating numeric(5,2) not null check (rating between 0 and 100),
  shared_comments text,              -- visible to the employee
  created_at timestamptz not null default now(),
  unique (employee_id, reviewer_id, period_start, period_end),
  check (employee_id <> reviewer_id)
);
-- Confidential notes live in a separate table the employee can never read.
create table manager_review_notes (
  review_id uuid primary key references manager_reviews(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  private_notes text not null
);

create table performance_review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  snapshot_id uuid not null references performance_snapshots(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  message text not null check (length(message) between 10 and 2000),
  status request_status not null default 'PENDING',
  response text,
  responded_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create or replace function can_view_performance(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select target = current_employee_id() or has_perm('performance.view_all')
      or (has_perm('performance.view_team') and is_in_my_team(target))
$$;

create or replace function adjust_snapshot(p_snapshot uuid, p_delta numeric, p_reason text)
returns performance_snapshots language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s performance_snapshots; v_me uuid := current_employee_id(); v_total numeric;
begin
  select * into v_s from performance_snapshots where id = p_snapshot and org_id = current_org_id() for update;
  if v_s.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_s.status <> 'DRAFT' then raise exception 'only draft snapshots can be adjusted' using errcode='P0001'; end if;
  if v_s.employee_id = v_me then raise exception 'cannot adjust your own score' using errcode='42501'; end if;
  if not (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(v_s.employee_id))) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_s.computed_score is null then raise exception 'cannot adjust a score with insufficient data' using errcode='P0001'; end if;
  insert into score_adjustments(org_id, snapshot_id, delta, reason, adjusted_by) values (v_s.org_id, v_s.id, p_delta, p_reason, v_me);
  select coalesce(sum(delta),0) into v_total from score_adjustments where snapshot_id = v_s.id;
  update performance_snapshots set adjustment = v_total,
    final_score = greatest(0, least(100, computed_score + v_total)) where id = v_s.id returning * into v_s;
  perform _audit(v_s.org_id, 'performance.adjusted', 'performance_snapshot', v_s.id::text,
    jsonb_build_object('delta', p_delta, 'reason', p_reason));
  return v_s;
end $$;

create or replace function approve_snapshot(p_snapshot uuid)
returns performance_snapshots language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s performance_snapshots; v_me uuid := current_employee_id();
begin
  select * into v_s from performance_snapshots where id = p_snapshot and org_id = current_org_id() for update;
  if v_s.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_s.status <> 'DRAFT' then raise exception 'already finalised' using errcode='P0001'; end if;
  if v_s.employee_id = v_me then raise exception 'cannot approve your own performance' using errcode='42501'; end if;
  if not (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(v_s.employee_id))) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  update performance_snapshots set status='APPROVED', approved_by=v_me, approved_at=now() where id=v_s.id returning * into v_s;
  perform _audit(v_s.org_id, 'performance.approved', 'performance_snapshot', v_s.id::text,
    jsonb_build_object('final_score', v_s.final_score));
  return v_s;
end $$;

-- ---------------------------------------------------------------------------
-- Compensation
-- ---------------------------------------------------------------------------
create type pay_type as enum ('FIXED','FIXED_PLUS_VARIABLE','INCENTIVE_ONLY');

create table incentive_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  department_id uuid references departments(id) on delete cascade,
  -- [{ "min": 90, "pct": 100 }, { "min": 80, "pct": 75 }, ...]  score >= min → pct of target
  slabs jsonb not null check (jsonb_typeof(slabs) = 'array' and jsonb_array_length(slabs) between 1 and 20),
  cap_amount numeric(12,2) check (cap_amount >= 0),
  prorate boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table salary_structures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  pay_type pay_type not null default 'FIXED',
  base_monthly numeric(12,2) not null default 0 check (base_monthly >= 0),
  allowances jsonb not null default '[]',     -- [{ "name": "Travel", "amount": 2000 }]
  deductions jsonb not null default '[]',     -- approved recurring deductions
  target_incentive numeric(12,2) not null default 0 check (target_incentive >= 0),
  incentive_policy_id uuid references incentive_policies(id),
  attendance_incentive numeric(12,2) not null default 0 check (attendance_incentive >= 0),
  notes text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (pay_type <> 'INCENTIVE_ONLY' or base_monthly = 0)
);
alter table salary_structures add constraint salary_no_overlap exclude using gist (
  employee_id with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
);

create type payroll_status as enum ('DRAFT','REVIEW','APPROVED','PROCESSED','PAID','REJECTED','CANCELLED');

create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status payroll_status not null default 'DRAFT',
  created_by uuid not null references employees(id),
  submitted_by uuid references employees(id),
  submitted_at timestamptz,
  approved_by uuid references employees(id),
  approved_at timestamptz,
  processed_at timestamptz,
  paid_at timestamptz,
  rejection_note text,
  notes text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index payroll_one_live_run on payroll_runs(org_id, period_start, period_end)
  where status not in ('CANCELLED','REJECTED');

create table payroll_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  structure_id uuid not null references salary_structures(id),
  snapshot_id uuid references performance_snapshots(id),
  period_days int not null,
  employed_days int not null,
  lop_days numeric(5,1) not null default 0,
  payable_days numeric(5,1) not null,
  base_amount numeric(12,2) not null,
  allowances_amount numeric(12,2) not null,
  incentive_amount numeric(12,2) not null,
  attendance_incentive_amount numeric(12,2) not null,
  bonus_amount numeric(12,2) not null default 0,
  reimbursement_amount numeric(12,2) not null default 0,
  deductions_amount numeric(12,2) not null,
  gross_amount numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  breakdown jsonb not null,           -- every line + the reason it applied or didn't
  payment_status text not null default 'UNPAID' check (payment_status in ('UNPAID','PAID','FAILED')),
  payment_reference text,
  payment_method text,
  paid_on date,
  payment_confirmed_by uuid references employees(id),
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index payroll_entries_emp_idx on payroll_entries(employee_id);

-- Entries are frozen once the run leaves DRAFT, except the payment fields via mark_entry_paid().
create or replace function payroll_entries_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status payroll_status;
begin
  select status into v_status from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if coalesce(current_setting('app.payroll_payment', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'payroll entries are locked once the run leaves DRAFT' using errcode='42501';
  end if;
  if tg_op <> 'DELETE' then
    new.payment_status := 'UNPAID'; new.payment_reference := null; new.paid_on := null; new.payment_confirmed_by := null;
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_entries_guard_trg before insert or update or delete on payroll_entries
  for each row execute function payroll_entries_guard();

create or replace function payroll_transition(p_run uuid, p_to payroll_status, p_note text default null)
returns payroll_runs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r payroll_runs; v_me uuid := current_employee_id(); v_count int;
begin
  select * into v_r from payroll_runs where id = p_run and org_id = current_org_id() for update;
  if v_r.id is null then raise exception 'not found' using errcode='P0002'; end if;

  if p_to = 'REVIEW' then
    if v_r.status not in ('DRAFT') then raise exception 'only drafts can be submitted' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    select count(*) into v_count from payroll_entries where run_id = p_run;
    if v_count = 0 then raise exception 'run has no entries' using errcode='P0001'; end if;
    update payroll_runs set status='REVIEW', submitted_by=v_me, submitted_at=now() where id=p_run returning * into v_r;

  elsif p_to = 'DRAFT' then
    if v_r.status <> 'REVIEW' then raise exception 'only runs in review can return to draft' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    update payroll_runs set status='DRAFT', submitted_by=null, submitted_at=null where id=p_run returning * into v_r;

  elsif p_to in ('APPROVED','REJECTED') then
    if v_r.status <> 'REVIEW' then raise exception 'run must be in REVIEW' using errcode='P0001'; end if;
    if not has_perm('payroll.approve') then raise exception 'payroll.approve required' using errcode='42501'; end if;
    -- Segregation of duties: the preparer/submitter cannot approve, nor can anyone paid in this run.
    if v_me in (v_r.created_by, v_r.submitted_by) then
      raise exception 'the person who prepared or submitted a run cannot approve it' using errcode='42501';
    end if;
    if exists (select 1 from payroll_entries where run_id = p_run and employee_id = v_me) then
      raise exception 'you cannot approve a payroll run that includes your own salary' using errcode='42501';
    end if;
    if p_to = 'REJECTED' and coalesce(length(trim(p_note)),0) < 3 then
      raise exception 'rejection needs a note' using errcode='P0001';
    end if;
    update payroll_runs set status=p_to, approved_by=case when p_to='APPROVED' then v_me end,
      approved_at=case when p_to='APPROVED' then now() end, rejection_note=case when p_to='REJECTED' then p_note end
    where id=p_run returning * into v_r;

  elsif p_to = 'PROCESSED' then
    if v_r.status <> 'APPROVED' then raise exception 'run must be APPROVED' using errcode='P0001'; end if;
    if not has_perm('payroll.pay') and current_role_name() <> 'SUPER_ADMIN' then
      raise exception 'payroll.pay required' using errcode='42501'; end if;
    update payroll_runs set status='PROCESSED', processed_at=now() where id=p_run returning * into v_r;

  elsif p_to = 'CANCELLED' then
    if v_r.status in ('PROCESSED','PAID') then raise exception 'processed runs cannot be cancelled' using errcode='P0001'; end if;
    if not has_perm('payroll.manage') then raise exception 'payroll.manage required' using errcode='42501'; end if;
    update payroll_runs set status='CANCELLED', notes=coalesce(p_note, notes) where id=p_run returning * into v_r;

  elsif p_to = 'PAID' then
    raise exception 'runs become PAID automatically once every entry has a confirmed payment' using errcode='P0001';
  else
    raise exception 'unsupported transition' using errcode='P0001';
  end if;

  perform _audit(v_r.org_id, 'payroll.' || lower(p_to::text), 'payroll_run', v_r.id::text,
    jsonb_build_object('period', v_r.period_start || '..' || v_r.period_end, 'note', p_note));
  return v_r;
end $$;

-- Never "paid" without a payment reference recorded by an authorised person.
create or replace function mark_entry_paid(p_entry uuid, p_reference text, p_method text, p_paid_on date)
returns payroll_entries language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e payroll_entries; v_r payroll_runs; v_me uuid := current_employee_id();
begin
  if coalesce(length(trim(p_reference)),0) < 4 then raise exception 'a payment reference (UTR / txn id) is required' using errcode='P0001'; end if;
  if p_method not in ('BANK_TRANSFER','UPI','CHEQUE','CASH') then raise exception 'invalid payment method' using errcode='P0001'; end if;
  select * into v_e from payroll_entries where id = p_entry and org_id = current_org_id() for update;
  if v_e.id is null then raise exception 'not found' using errcode='P0002'; end if;
  select * into v_r from payroll_runs where id = v_e.run_id for update;
  if v_r.status <> 'PROCESSED' then raise exception 'run must be PROCESSED before recording payments' using errcode='P0001'; end if;
  if not has_perm('payroll.pay') and current_role_name() <> 'SUPER_ADMIN' then raise exception 'payroll.pay required' using errcode='42501'; end if;
  if v_e.employee_id = v_me then raise exception 'cannot confirm your own salary payment' using errcode='42501'; end if;
  if v_e.payment_status = 'PAID' then raise exception 'already paid' using errcode='P0001'; end if;
  perform set_config('app.payroll_payment', 'on', true);
  update payroll_entries set payment_status='PAID', payment_reference=trim(p_reference), payment_method=p_method,
    paid_on=p_paid_on, payment_confirmed_by=v_me where id=p_entry returning * into v_e;
  perform set_config('app.payroll_payment', 'off', true);
  if not exists (select 1 from payroll_entries where run_id = v_r.id and payment_status <> 'PAID') then
    update payroll_runs set status='PAID', paid_at=now() where id=v_r.id;
  end if;
  perform _audit(v_e.org_id, 'payroll.entry_paid', 'payroll_entry', v_e.id::text,
    jsonb_build_object('run_id', v_r.id, 'method', p_method));
  return v_e;
end $$;

-- Sensitive-read log (called by the app whenever salary data is rendered/exported).
create or replace function log_salary_access(p_entity text, p_entity_id text, p_subject uuid, p_purpose text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform log_audit('salary.viewed', p_entity, p_entity_id, jsonb_build_object('subject', p_subject, 'purpose', p_purpose));
end $$;

create or replace function salary_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(coalesce(new.org_id, old.org_id), 'salary_structure.' || lower(tg_op), 'salary_structure',
    coalesce(new.id, old.id)::text, jsonb_build_object('employee_id', coalesce(new.employee_id, old.employee_id)));
  return coalesce(new, old);
end $$;
create trigger salary_audit_trg after insert or update or delete on salary_structures
  for each row execute function salary_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table performance_policies enable row level security;
alter table performance_snapshots enable row level security;
alter table score_adjustments enable row level security;
alter table manager_reviews enable row level security;
alter table manager_review_notes enable row level security;
alter table performance_review_requests enable row level security;
alter table incentive_policies enable row level security;
alter table salary_structures enable row level security;
alter table payroll_runs enable row level security;
alter table payroll_entries enable row level security;

create policy pp_read on performance_policies for select to authenticated using (org_id = current_org_id());
create policy pp_write on performance_policies for all to authenticated
  using (org_id = current_org_id() and has_perm('performance.configure'))
  with check (org_id = current_org_id() and has_perm('performance.configure'));

create policy ps_read on performance_snapshots for select to authenticated
  using (org_id = current_org_id() and can_view_performance(employee_id));
create policy ps_insert on performance_snapshots for insert to authenticated
  with check (org_id = current_org_id() and status = 'DRAFT' and employee_id <> current_employee_id()
              and (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(employee_id))));
create policy ps_supersede on performance_snapshots for update to authenticated
  using (org_id = current_org_id() and status = 'DRAFT' and employee_id <> current_employee_id()
         and (has_perm('performance.configure') or (has_perm('performance.review') and is_in_my_team(employee_id))))
  with check (status = 'SUPERSEDED');

create policy sa_read on score_adjustments for select to authenticated
  using (exists (select 1 from performance_snapshots s where s.id = snapshot_id and s.org_id = current_org_id()
                 and can_view_performance(s.employee_id)));

create policy mr_read on manager_reviews for select to authenticated
  using (org_id = current_org_id() and can_view_performance(employee_id));
create policy mr_write on manager_reviews for insert to authenticated
  with check (org_id = current_org_id() and reviewer_id = current_employee_id() and employee_id <> current_employee_id()
              and has_perm('performance.review') and (is_in_my_team(employee_id) or has_perm('performance.view_all')));

-- Employees can NEVER read confidential notes — not even about themselves.
create policy mrn_read on manager_review_notes for select to authenticated
  using (org_id = current_org_id() and exists (
    select 1 from manager_reviews r where r.id = review_id and r.employee_id <> current_employee_id()
      and (r.reviewer_id = current_employee_id() or has_perm('performance.view_all'))));
create policy mrn_write on manager_review_notes for insert to authenticated
  with check (org_id = current_org_id() and exists (
    select 1 from manager_reviews r where r.id = review_id and r.reviewer_id = current_employee_id()));

create policy prr_read on performance_review_requests for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id()
         or has_perm('performance.view_all') or (has_perm('performance.review') and is_in_my_team(employee_id))));
create policy prr_insert on performance_review_requests for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id() and status = 'PENDING'
              and exists (select 1 from performance_snapshots s where s.id = snapshot_id and s.employee_id = current_employee_id()));
create policy prr_respond on performance_review_requests for update to authenticated
  using (org_id = current_org_id() and employee_id <> current_employee_id()
         and (has_perm('performance.view_all') or (has_perm('performance.review') and is_in_my_team(employee_id))))
  with check (org_id = current_org_id());

create policy ip_read on incentive_policies for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('salary.manage')));
create policy ip_write on incentive_policies for all to authenticated
  using (org_id = current_org_id() and has_perm('salary.manage'))
  with check (org_id = current_org_id() and has_perm('salary.manage'));

-- Salary: self or payroll roles. Managers deliberately excluded.
create policy ss_read on salary_structures for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('payroll.view_all')));
create policy ss_write on salary_structures for insert to authenticated
  with check (org_id = current_org_id() and has_perm('salary.manage') and employee_id <> current_employee_id());
create policy ss_update on salary_structures for update to authenticated
  using (org_id = current_org_id() and has_perm('salary.manage') and employee_id <> current_employee_id())
  with check (org_id = current_org_id() and employee_id <> current_employee_id());

create policy pr_read on payroll_runs for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('payroll.approve')));
create policy pr_insert on payroll_runs for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and status = 'DRAFT' and created_by = current_employee_id());

-- Narrow definer helper: employees can't read payroll_runs, but may learn whether their own run is released.
create or replace function payroll_run_released(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payroll_runs r where r.id = p_run and r.org_id = current_org_id()
                 and r.status in ('APPROVED','PROCESSED','PAID'))
$$;

create policy pe_read on payroll_entries for select to authenticated
  using (org_id = current_org_id() and (
    (employee_id = current_employee_id() and payroll_run_released(run_id))
    or has_perm('payroll.view_all') or has_perm('payroll.approve')));
create policy pe_write on payroll_entries for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id()
              and exists (select 1 from payroll_runs r where r.id = run_id and r.org_id = current_org_id() and r.status = 'DRAFT'));
create policy pe_delete on payroll_entries for delete to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage')
         and exists (select 1 from payroll_runs r where r.id = run_id and r.status = 'DRAFT'));

-- SUPER_ADMIN gets payroll.approve + payroll.pay implicitly via has_perm(). Give HR the explicit grants
-- by configuration in /settings/roles if your policy wants HR to approve (default: Super Admin approves).
