-- =============================================================================
-- 0034 · Block 27 — Reports & BI: report catalogue with one permission per report, on-demand and scheduled runs
-- (daily / weekly / monthly in IST), files kept in a private bucket, recipients told by in-app notification and an
-- email that carries ONLY a link (never figures), and a monthly accountant pack.
-- =============================================================================

-- Client GST details for the accountant's sales register.
alter table clients add column if not exists gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');
alter table clients add column if not exists state_code text check (state_code is null or state_code ~ '^[0-9]{2}$');

-- Same rules as has_perm(), for an arbitrary employee (used to re-check recipients at delivery time). Keep in sync.
create or replace function employee_has_perm(p_emp uuid, p text) returns boolean
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
    from employees e where e.id = p_emp and e.status <> 'EXITED'), false)
$$;
revoke all on function employee_has_perm(uuid, text) from public, anon, authenticated;

create or replace function report_types() returns text[] language sql immutable as $$
  select array['ATTENDANCE_SUMMARY','TASK_DELIVERY','CRM_FUNNEL','PNL_MONTHLY','SCHOLARS_ADMISSIONS','KPI_SUMMARY']
$$;
-- The permission a person needs to see each report (and to receive it).
create or replace function report_type_perm(p_type text) returns text language sql immutable as $$
  select case p_type
    when 'ATTENDANCE_SUMMARY' then 'attendance.manage' when 'TASK_DELIVERY' then 'reports.view_org'
    when 'CRM_FUNNEL' then 'crm.view_all' when 'PNL_MONTHLY' then 'finance.view'
    when 'SCHOLARS_ADMISSIONS' then 'scholars.view' when 'KPI_SUMMARY' then 'performance.view_all' end
$$;
grant execute on function report_types(), report_type_perm(text) to authenticated;

create table if not exists report_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 3 and 120),
  report_type text not null check (report_type = any (report_types())),
  format text not null default 'XLSX' check (format in ('XLSX','PDF','CSV')),
  frequency text not null check (frequency in ('DAILY','WEEKLY','MONTHLY')),
  weekday int check (weekday between 1 and 7),        -- ISO: 1 = Monday
  month_day int check (month_day between 1 and 28),
  hour_local int not null default 9 check (hour_local between 0 and 23),
  recipients uuid[] not null default '{}' check (cardinality(recipients) between 1 and 30),
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  check (frequency <> 'WEEKLY' or weekday is not null),
  check (frequency <> 'MONTHLY' or month_day is not null)
);
create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  schedule_id uuid references report_schedules(id) on delete set null,
  report_type text not null check (report_type = any (report_types())),
  format text not null check (format in ('XLSX','PDF','CSV')),
  period_start date not null, period_end date not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','READY','FAILED')),
  file_path text, row_count int, error text,
  requested_by uuid references employees(id) on delete set null,
  attempts int not null default 0,
  created_at timestamptz not null default now(), finished_at timestamptz,
  check (period_end >= period_start)
);
create index if not exists report_runs_queue on report_runs(status, created_at) where status in ('QUEUED','RUNNING');

-- Next run time for a schedule (all schedules are in the organisation's local time, IST by default).
create or replace function report_next_run(p_freq text, p_weekday int, p_month_day int, p_hour int, p_tz text, p_after timestamptz)
returns timestamptz language plpgsql stable as $$
declare v_local timestamp := (p_after at time zone p_tz); v_day date := v_local::date; v_try timestamp; i int;
begin
  for i in 0..62 loop
    v_try := (v_day + i) + make_interval(hours => p_hour);
    if v_try <= v_local then continue; end if;
    if p_freq = 'DAILY'
       or (p_freq = 'WEEKLY' and extract(isodow from v_try) = p_weekday)
       or (p_freq = 'MONTHLY' and extract(day from v_try) = p_month_day) then
      return v_try at time zone p_tz;
    end if;
  end loop;
  return null;
end $$;

-- The period a scheduled run covers: yesterday (daily), last Mon–Sun (weekly), last calendar month (monthly).
create or replace function report_period(p_freq text, p_at timestamptz, p_tz text, out p_start date, out p_end date)
language plpgsql stable as $$
declare d date := (p_at at time zone p_tz)::date;
begin
  if p_freq = 'DAILY' then p_start := d - 1; p_end := d - 1;
  elsif p_freq = 'WEEKLY' then p_end := d - extract(isodow from d)::int; p_start := p_end - 6;
  else p_start := (date_trunc('month', d) - interval '1 month')::date; p_end := (date_trunc('month', d) - interval '1 day')::date;
  end if;
end $$;

create or replace function report_schedule_defaults() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tz text; r uuid;
begin
  -- The creator must be allowed to see this report; recipients must belong to the same organisation.
  if auth.uid() is not null and not has_perm(report_type_perm(new.report_type)) then
    raise exception 'You don''t have access to this report, so you can''t schedule it.' using errcode = '42501';
  end if;
  foreach r in array new.recipients loop
    if not exists (select 1 from employees where id = r and org_id = new.org_id and status <> 'EXITED') then
      raise exception 'Unknown recipient.';
    end if;
  end loop;
  select timezone into v_tz from organizations where id = new.org_id;
  if tg_op = 'INSERT' or new.frequency is distinct from old.frequency or new.weekday is distinct from old.weekday
     or new.month_day is distinct from old.month_day or new.hour_local is distinct from old.hour_local
     or (new.active and not old.active) then
    new.next_run_at := report_next_run(new.frequency, new.weekday, new.month_day, new.hour_local, coalesce(v_tz, 'Asia/Kolkata'), now());
  end if;
  return new;
end $$;
drop trigger if exists report_schedules_defaults on report_schedules;
create trigger report_schedules_defaults before insert or update on report_schedules for each row execute function report_schedule_defaults();

alter table report_schedules enable row level security;
alter table report_runs enable row level security;
drop policy if exists schedules_read on report_schedules;
create policy schedules_read on report_schedules for select to authenticated
  using (org_id = current_org_id() and (has_perm('reports.schedule') or current_employee_id() = any(recipients)));
drop policy if exists schedules_write on report_schedules;
create policy schedules_write on report_schedules for all to authenticated
  using (org_id = current_org_id() and has_perm('reports.schedule') and has_perm(report_type_perm(report_type)))
  with check (org_id = current_org_id() and has_perm('reports.schedule') and has_perm(report_type_perm(report_type)));
revoke update on report_schedules from authenticated;
grant update (name, format, frequency, weekday, month_day, hour_local, recipients, active) on report_schedules to authenticated;
-- A report file is readable by anyone who holds that report's permission.
drop policy if exists runs_read on report_runs;
create policy runs_read on report_runs for select to authenticated
  using (org_id = current_org_id() and has_perm(report_type_perm(report_type)));
revoke insert, update, delete on report_runs from authenticated;

-- On-demand run from the app.
create or replace function report_request(p_type text, p_format text, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not has_perm(report_type_perm(p_type)) then raise exception 'You don''t have access to this report.' using errcode = '42501'; end if;
  if p_end < p_start or p_end - p_start > 400 then raise exception 'Pick a period of up to about 13 months.'; end if;
  if not hit_rate_limit('report-req:' || current_employee_id(), 30, 3600) then raise exception 'Too many reports in an hour.'; end if;
  insert into report_runs(org_id, report_type, format, period_start, period_end, requested_by)
  values (current_org_id(), p_type, coalesce(p_format, 'XLSX'), p_start, p_end, current_employee_id()) returning id into v_id;
  return v_id;
end $$;
grant execute on function report_request(text, text, date, date) to authenticated;

-- Scheduler (service role): queue due schedules and move their next run forward.
create or replace function claim_due_reports(p_limit int default 10) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_tz text; per record; n int := 0;
begin
  for s in select * from report_schedules where active and next_run_at is not null and next_run_at <= now()
            order by next_run_at limit p_limit for update skip locked loop
    select timezone into v_tz from organizations where id = s.org_id;
    select * into per from report_period(s.frequency, s.next_run_at, coalesce(v_tz, 'Asia/Kolkata'));
    insert into report_runs(org_id, schedule_id, report_type, format, period_start, period_end)
    values (s.org_id, s.id, s.report_type, s.format, per.p_start, per.p_end);
    update report_schedules set last_run_at = now(),
      next_run_at = report_next_run(s.frequency, s.weekday, s.month_day, s.hour_local, coalesce(v_tz, 'Asia/Kolkata'), now())
     where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function claim_report_runs(p_limit int default 5) returns setof report_runs
language sql security definer set search_path = public, pg_temp as $$
  update report_runs set status = 'RUNNING', attempts = attempts + 1
   where id in (select id from report_runs
                 where (status = 'QUEUED' or (status = 'RUNNING' and created_at < now() - interval '15 minutes' and attempts < 3))
                 order by created_at limit p_limit for update skip locked)
  returning *
$$;
-- Tell recipients the file is ready: in-app + an email with a link only. Recipients who lost the permission are skipped.
create or replace function report_run_finished(p_run uuid, p_ok boolean, p_path text, p_rows int, p_error text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r report_runs; s report_schedules; v_emp record; n int := 0; v_label text;
begin
  update report_runs set status = case when p_ok then 'READY' else 'FAILED' end, file_path = p_path, row_count = p_rows,
         error = left(p_error, 500), finished_at = now() where id = p_run returning * into r;
  if r.id is null or not p_ok then return 0; end if;
  v_label := initcap(replace(r.report_type, '_', ' ')) || ' · ' || to_char(r.period_start, 'DD Mon') ||
             case when r.period_end <> r.period_start then ' – ' || to_char(r.period_end, 'DD Mon YYYY') else to_char(r.period_start, ' YYYY') end;
  if r.schedule_id is not null then
    select * into s from report_schedules where id = r.schedule_id;
    for v_emp in select e.id, e.full_name, e.official_email from employees e
                  where e.id = any(s.recipients) and e.status <> 'EXITED' and employee_has_perm(e.id, report_type_perm(r.report_type)) loop
      perform notify(r.org_id, v_emp.id, 'SYSTEM', 'Report ready · ' || s.name, v_label, '/reports?run=' || r.id, 'report-' || r.id);
      perform enqueue_email(r.org_id, v_emp.official_email, v_emp.id, 'report.ready',
        jsonb_build_object('name', split_part(v_emp.full_name, ' ', 1), 'report', s.name, 'period', v_label, 'run_id', r.id),
        'report-' || r.id || '-' || v_emp.id);
      n := n + 1;
    end loop;
  elsif r.requested_by is not null then
    perform notify(r.org_id, r.requested_by, 'SYSTEM', 'Report ready', v_label, '/reports?run=' || r.id, 'report-' || r.id);
  end if;
  return n;
end $$;
revoke all on function claim_due_reports(int), claim_report_runs(int), report_run_finished(uuid, boolean, text, int, text) from public, anon, authenticated;

-- ---------- Report data ----------
-- Returns {"title", "columns": [...], "rows": [[...]], "notes": [...]}. Aggregates only; never per-person salaries.
-- Callable by the service role (scheduler) or by a signed-in person who holds the report's permission.
create or replace function report_data(p_org uuid, p_type text, p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz text; v jsonb; v_notes jsonb := '[]';
begin
  if auth.uid() is not null and not (p_org = current_org_id() and has_perm(report_type_perm(p_type))) then
    raise exception 'You don''t have access to this report.' using errcode = '42501';
  end if;
  select timezone into tz from organizations where id = p_org;
  tz := coalesce(tz, 'Asia/Kolkata');
  if p_type = 'ATTENDANCE_SUMMARY' then
    with ev as (
      select a.employee_id, a.event_type, a.occurred_at, (a.occurred_at at time zone tz)::date as d,
             lead(a.event_type) over w as next_type, lead(a.occurred_at) over w as next_at
        from attendance_events a where a.org_id = p_org and (a.occurred_at at time zone tz)::date between p_start and p_end
      window w as (partition by a.employee_id, (a.occurred_at at time zone tz)::date order by a.occurred_at)),
    agg as (
      select employee_id, count(distinct d) filter (where event_type = 'CLOCK_IN') as days,
             round(sum(extract(epoch from (next_at - occurred_at)) / 3600) filter (where event_type in ('CLOCK_IN','BREAK_END') and next_type in ('CLOCK_OUT','BREAK_START'))::numeric, 1) as hours,
             count(distinct d) filter (where event_type = 'CLOCK_IN' and not exists (select 1 from ev e2 where e2.employee_id = ev.employee_id and e2.d = ev.d and e2.event_type = 'CLOCK_OUT')) as no_clockout
        from ev group by employee_id)
    select jsonb_build_object('title', 'Attendance summary',
      'columns', jsonb_build_array('Employee ID','Name','Department','Days present','Hours worked','Days without clock-out','Leave days (approved)','Corrections pending'),
      'rows', coalesce(jsonb_agg(jsonb_build_array(e.employee_code, e.full_name, dp.name, coalesce(a.days, 0), coalesce(a.hours, 0), coalesce(a.no_clockout, 0),
          (select coalesce(sum(case when l.half_day then 0.5 else (least(l.end_date, p_end) - greatest(l.start_date, p_start) + 1) end), 0)
             from leave_requests l where l.employee_id = e.id and l.status = 'APPROVED' and l.start_date <= p_end and l.end_date >= p_start),
          (select count(*) from attendance_corrections c where c.employee_id = e.id and c.status = 'PENDING'))
          order by dp.name nulls last, e.full_name), '[]'))
      into v
      from employees e left join departments dp on dp.id = e.department_id left join agg a on a.employee_id = e.id
     where e.org_id = p_org and e.status <> 'EXITED';
  elsif p_type = 'TASK_DELIVERY' then
    select jsonb_build_object('title', 'Task delivery',
      'columns', jsonb_build_array('Employee ID','Name','Post','Completed','On time %','Avg quality','Reopened','Open & overdue'),
      'rows', coalesce(jsonb_agg(jsonb_build_array(e.employee_code, e.full_name, e.designation,
          (select count(*) from tasks t where t.assignee_id = e.id and t.status = 'COMPLETED' and (t.completed_at at time zone tz)::date between p_start and p_end),
          (select round(100.0 * count(*) filter (where t.deadline is null or t.completed_at <= t.deadline) / nullif(count(*), 0), 1)
             from tasks t where t.assignee_id = e.id and t.status = 'COMPLETED' and (t.completed_at at time zone tz)::date between p_start and p_end),
          (select round(avg(t.quality_score), 1) from tasks t where t.assignee_id = e.id and t.status = 'COMPLETED' and (t.completed_at at time zone tz)::date between p_start and p_end),
          (select coalesce(sum(t.reopen_count), 0) from tasks t where t.assignee_id = e.id and (t.completed_at at time zone tz)::date between p_start and p_end),
          (select count(*) from tasks t where t.assignee_id = e.id and t.status not in ('COMPLETED','CANCELLED') and t.deadline < now()))
          order by e.full_name), '[]'))
      into v from employees e where e.org_id = p_org and e.status <> 'EXITED';
  elsif p_type = 'CRM_FUNNEL' then
    select jsonb_build_object('title', 'CRM funnel',
      'columns', jsonb_build_array('Source','New leads','Contacted','Qualified','Proposal','Negotiation','Won','Lost','Win rate %'),
      'rows', coalesce(jsonb_agg(jsonb_build_array(src, n, contacted, qualified, proposal, negotiation, won, lost,
                round(100.0 * won / nullif(won + lost, 0), 1)) order by n desc), '[]'))
      into v from (
        select source::text as src, count(*) as n,
               count(*) filter (where status not in ('NEW')) as contacted,
               count(*) filter (where status in ('QUALIFIED','PROPOSAL','NEGOTIATION','WON')) as qualified,
               count(*) filter (where status in ('PROPOSAL','NEGOTIATION','WON')) as proposal,
               count(*) filter (where status in ('NEGOTIATION','WON')) as negotiation,
               count(*) filter (where status = 'WON') as won, count(*) filter (where status = 'LOST') as lost
          from leads where org_id = p_org and duplicate_of is null and (created_at at time zone tz)::date between p_start and p_end
         group by source) f;
    v_notes := jsonb_build_array('Leads created in the period, by where they came from, and how far each has got (as of today). Duplicates excluded.');
  elsif p_type = 'PNL_MONTHLY' then
    with lines as (
      select 1 as o, 'Income' as section, 'Invoiced (taxable value)' as item,
             coalesce(sum(subtotal), 0) as amount from client_invoices
        where org_id = p_org and status not in ('DRAFT','VOID') and issue_date between p_start and p_end
      union all select 2, 'Income', 'GST on invoices (not income)', coalesce(sum(tax_amount), 0) from client_invoices
        where org_id = p_org and status not in ('DRAFT','VOID') and issue_date between p_start and p_end
      union all select 3, 'Cash', 'Client payments received', coalesce(sum(amount), 0) from invoice_payments
        where org_id = p_org and paid_on between p_start and p_end
      union all select 4, 'Income', 'VSM Scholars fees collected', coalesce(sum(amount), 0) from scholar_fee_payments
        where org_id = p_org and status = 'PAID' and paid_on between p_start and p_end
      union all select 10, 'Expenses', 'Expense: ' || category, sum(amount) from finance_expenses
        where org_id = p_org and status in ('APPROVED','PAID') and expense_date between p_start and p_end group by category
      union all select 20, 'Expenses', 'Payroll cost (gross + employer PF/ESI, approved runs, company total)',
             coalesce(sum(pe.gross_amount + pe.employer_contribution_amount), 0)
        from payroll_entries pe join payroll_runs pr on pr.id = pe.run_id
       where pr.org_id = p_org and pr.status in ('APPROVED','PROCESSED','PAID') and pr.period_start >= p_start and pr.period_end <= p_end
      union all select 30, 'Cash', 'Vendor payments made', coalesce(sum(amount), 0) from vendor_payments
        where org_id = p_org and paid_on between p_start and p_end)
    select jsonb_build_object('title', 'Profit & loss (management view)', 'columns', jsonb_build_array('Section','Item','Amount (Rs.)'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_array(section, item, round(amount, 2)) order by o, item), '[]') from lines)
              || jsonb_build_array(jsonb_build_array('Result', 'Operating profit (invoiced + Scholars fees − expenses − payroll)',
                   (select round(coalesce(sum(case when o in (1, 4) then amount when o in (10, 20) then -amount else 0 end), 0), 2) from lines))))
      into v;
    v_notes := jsonb_build_array('Management view on accrual for invoices and cash for fees; not a statutory P&L. Payroll is a single company total — no individual salaries.');
  elsif p_type = 'SCHOLARS_ADMISSIONS' then
    select jsonb_build_object('title', 'VSM Scholars admissions',
      'columns', jsonb_build_array('Course','New enquiries','Enrolled','Conversion %','Fees collected (Rs.)','Fees outstanding (Rs.)'),
      'rows', coalesce(jsonb_agg(jsonb_build_array(c.name, x.enq, x.enr, round(100.0 * x.enr / nullif(x.enq, 0), 1), x.paid, x.due) order by c.code), '[]'))
      into v from scholar_courses c cross join lateral (select
        (select count(*) from scholar_students s where s.org_id = p_org and s.interested_course_id = c.id and (s.created_at at time zone tz)::date between p_start and p_end) as enq,
        (select count(*) from scholar_enrollments en join scholar_batches b on b.id = en.batch_id where b.course_id = c.id and (en.enrolled_at at time zone tz)::date between p_start and p_end) as enr,
        (select coalesce(sum(f.amount), 0) from scholar_fee_payments f join scholar_enrollments en on en.id = f.enrollment_id join scholar_batches b on b.id = en.batch_id
          where b.course_id = c.id and f.status = 'PAID' and f.paid_on between p_start and p_end) as paid,
        (select coalesce(sum(f.amount), 0) from scholar_fee_payments f join scholar_enrollments en on en.id = f.enrollment_id join scholar_batches b on b.id = en.batch_id
          where b.course_id = c.id and f.status = 'DUE' and f.due_on <= p_end) as due) x
     where c.org_id = p_org;
  elsif p_type = 'KPI_SUMMARY' then
    select jsonb_build_object('title', 'KPI summary',
      'columns', jsonb_build_array('Employee ID','Name','Post','KPI','Month','Value','Target','Status','Source','Verified'),
      'rows', coalesce(jsonb_agg(jsonb_build_array(e.employee_code, e.full_name, e.designation, k.name, to_char(kv.period_month, 'Mon YYYY'), kv.value, k.target,
          case when k.target is null then '-' when (k.direction = 'HIGHER' and kv.value >= k.target) or (k.direction = 'LOWER' and kv.value <= k.target) then 'Met' else 'Below' end,
          kv.source, case when kv.source = 'AUTO' or kv.verified_at is not null then 'Yes' else 'No' end)
          order by e.full_name, k.name, kv.period_month), '[]'))
      into v from kpi_values kv join kpi_definitions k on k.id = kv.kpi_id join employees e on e.id = kv.employee_id
     where kv.org_id = p_org and kv.period_month between date_trunc('month', p_start)::date and p_end;
  else
    raise exception 'Unknown report.';
  end if;
  return v || jsonb_build_object('notes', v_notes, 'period_start', p_start, 'period_end', p_end, 'type', p_type);
end $$;
revoke all on function report_data(uuid, text, date, date) from public, anon;
grant execute on function report_data(uuid, text, date, date) to authenticated;

-- ---------- Accountant pack (one month, multi-sheet) ----------
create or replace function accountant_pack(p_org uuid, p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_payroll boolean;
begin
  if auth.uid() is not null and not (p_org = current_org_id() and has_perm('finance.export')) then
    raise exception 'Only people with finance export rights can download the accountant pack.' using errcode = '42501';
  end if;
  v_payroll := auth.uid() is null or has_perm('payroll.export');
  return jsonb_build_object(
    'Sales register', jsonb_build_array(jsonb_build_array('Invoice no','Date','Client','Client GSTIN','State','Taxable value','GST','Total','Status'))
      || coalesce((select jsonb_agg(jsonb_build_array(i.invoice_number, i.issue_date, c.name, c.gstin, c.state_code, i.subtotal, i.tax_amount, i.total_amount, i.status)
           order by i.issue_date, i.invoice_number) from client_invoices i join clients c on c.id = i.client_id
           where i.org_id = p_org and i.status not in ('DRAFT') and i.issue_date between p_start and p_end), '[]'),
    'Receipts', jsonb_build_array(jsonb_build_array('Date','Invoice no','Client','Amount','Method','Reference'))
      || coalesce((select jsonb_agg(jsonb_build_array(p.paid_on, i.invoice_number, c.name, p.amount, p.method, p.reference) order by p.paid_on)
           from invoice_payments p join client_invoices i on i.id = p.invoice_id join clients c on c.id = i.client_id
           where p.org_id = p_org and p.paid_on between p_start and p_end), '[]'),
    'Expenses', jsonb_build_array(jsonb_build_array('Code','Date','Type','Category','Description','Vendor','Amount','Status','Paid on','Reference'))
      || coalesce((select jsonb_agg(jsonb_build_array(x.expense_code, x.expense_date, x.expense_type, x.category, x.description,
             (select name from vendors where id = x.vendor_id), x.amount, x.status, x.paid_on, x.payment_reference) order by x.expense_date)
           from finance_expenses x where x.org_id = p_org and x.status in ('APPROVED','PAID') and x.expense_date between p_start and p_end), '[]'),
    'Vendor payments', jsonb_build_array(jsonb_build_array('Date','Vendor','Amount','Method','Reference'))
      || coalesce((select jsonb_agg(jsonb_build_array(vp.paid_on, v.name, vp.amount, vp.method, vp.reference) order by vp.paid_on)
           from vendor_payments vp join vendors v on v.id = vp.vendor_id where vp.org_id = p_org and vp.paid_on between p_start and p_end), '[]'),
    'Scholars fees', jsonb_build_array(jsonb_build_array('Receipt no','Paid on','Amount','Method','Reference'))
      || coalesce((select jsonb_agg(jsonb_build_array(f.receipt_no, f.paid_on, f.amount, f.method, f.reference) order by f.paid_on)
           from scholar_fee_payments f where f.org_id = p_org and f.status = 'PAID' and f.paid_on between p_start and p_end), '[]'),
    'Payroll totals', case when v_payroll then
         jsonb_build_array(jsonb_build_array('Run period','Status','Employees','Gross','Employee PF','Employee ESI','PT','TDS','Other deductions','Net pay','Employer PF','Employer ESI'))
      || coalesce((select jsonb_agg(jsonb_build_array(to_char(pr.period_start, 'DD Mon') || ' - ' || to_char(pr.period_end, 'DD Mon YYYY'), pr.status, x.n, x.gross,
             x.pf, x.esi, x.pt, x.tds, x.other, x.net, x.epf, x.eesi) order by pr.period_start)
           from payroll_runs pr cross join lateral (select count(*) as n, sum(gross_amount) as gross,
             sum(coalesce((statutory->>'pfEmployee')::numeric, 0)) as pf, sum(coalesce((statutory->>'esiEmployee')::numeric, 0)) as esi,
             sum(coalesce((statutory->>'pt')::numeric, 0)) as pt, sum(coalesce((statutory->>'tds')::numeric, 0)) as tds,
             sum(deductions_amount - employee_statutory_amount) as other, sum(net_amount) as net,
             sum(coalesce((statutory->>'pfEmployer')::numeric, 0)) as epf, sum(coalesce((statutory->>'esiEmployer')::numeric, 0)) as eesi
             from payroll_entries where run_id = pr.id) x
           where pr.org_id = p_org and pr.status in ('APPROVED','PROCESSED','PAID') and pr.period_start <= p_end and pr.period_end >= p_start), '[]')
      else jsonb_build_array(jsonb_build_array('Payroll totals need payroll export rights.')) end
  );
end $$;
revoke all on function accountant_pack(uuid, date, date) from public, anon;
grant execute on function accountant_pack(uuid, date, date) to authenticated;

-- Private bucket for generated files (read only through the app's signed links).
insert into storage.buckets(id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;

insert into role_permissions(org_id, role, permission)
select o.id, r.role::app_role, 'reports.schedule' from organizations o cross join (values ('ADMIN'),('OPERATIONS_MANAGER'),('HR_MANAGER')) r(role)
on conflict do nothing;
create or replace function seed_reports_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then
    insert into role_permissions(org_id, role, permission)
    select new.org_id, r.role::app_role, 'reports.schedule' from (values ('ADMIN'),('OPERATIONS_MANAGER'),('HR_MANAGER')) r(role) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists employees_seed_v_reports on employees;
create trigger employees_seed_v_reports after insert on employees for each row execute function seed_reports_on_sa();
