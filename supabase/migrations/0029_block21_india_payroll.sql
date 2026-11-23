-- =============================================================================
-- 0029 · Block 21 — Indian payroll: statutory settings (PF / ESI / PT / TDS), employee statutory & bank details,
-- statutory columns on payroll entries. Calculation lives in src/lib/engines/statutory.ts (unit-tested).
-- Defaults reflect rules in force in Nov 2026: EPF wage ceiling ₹25,000 (from 17 Sep 2026), ESI ₹21,000 at
-- 0.75% / 3.25%, new-regime slabs FY 2026-27 with ₹75,000 standard deduction and Section 87A rebate up to ₹12 lakh.
-- Every number is editable in Payroll → Statutory settings. Uttar Pradesh levies no professional tax, so PT is off.
-- =============================================================================
create table if not exists payroll_statutory_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  pf_enabled boolean not null default true,
  pf_employee_rate numeric(5,2) not null default 12 check (pf_employee_rate between 0 and 20),
  pf_employer_rate numeric(5,2) not null default 12 check (pf_employer_rate between 0 and 20),
  pf_wage_ceiling numeric(12,2) not null default 25000 check (pf_wage_ceiling >= 0),
  pf_restrict_to_ceiling boolean not null default true,
  esi_enabled boolean not null default true,
  esi_employee_rate numeric(5,2) not null default 0.75 check (esi_employee_rate between 0 and 5),
  esi_employer_rate numeric(5,2) not null default 3.25 check (esi_employer_rate between 0 and 10),
  esi_wage_limit numeric(12,2) not null default 21000 check (esi_wage_limit >= 0),
  pt_enabled boolean not null default false,
  pt_state text not null default 'UP',
  pt_slabs jsonb not null default '[]',            -- [{"upto": 10000, "amount": 0}, {"upto": null, "amount": 200}]
  tds_enabled boolean not null default true,
  standard_deduction numeric(12,2) not null default 75000,
  rebate_limit numeric(12,2) not null default 1200000,
  cess_rate numeric(5,2) not null default 4,
  new_regime_slabs jsonb not null default
    '[{"upto":400000,"rate":0},{"upto":800000,"rate":5},{"upto":1200000,"rate":10},{"upto":1600000,"rate":15},{"upto":2000000,"rate":20},{"upto":2400000,"rate":25},{"upto":null,"rate":30}]',
  bank_format text not null default 'GENERIC' check (bank_format in ('GENERIC','HDFC','ICICI','SBI','AXIS','KOTAK')),
  debit_account_last4 text check (debit_account_last4 ~ '^\d{4}$'),
  updated_by uuid references employees(id), updated_at timestamptz not null default now()
);
insert into payroll_statutory_settings(org_id) select id from organizations on conflict do nothing;

create table if not exists employee_statutory (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  uan text check (uan ~ '^\d{12}$'),
  esic_ip text check (esic_ip ~ '^\d{10}$'),
  pf_opted_out boolean not null default false,
  esi_exempt boolean not null default false,
  tax_regime text not null default 'NEW' check (tax_regime in ('NEW','OLD')),
  tds_monthly_override numeric(12,2) check (tds_monthly_override >= 0),
  bank_account_holder text check (length(bank_account_holder) <= 120),
  bank_account_no text check (bank_account_no ~ '^\d{9,18}$'),
  bank_ifsc text check (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text check (length(bank_name) <= 80),
  updated_by uuid references employees(id), updated_at timestamptz not null default now()
);
alter table payroll_entries add column if not exists statutory jsonb not null default '{}';
alter table payroll_entries add column if not exists employee_statutory_amount numeric(12,2) not null default 0;
alter table payroll_entries add column if not exists employer_contribution_amount numeric(12,2) not null default 0;

alter table payroll_statutory_settings enable row level security;
alter table employee_statutory enable row level security;
drop policy if exists statutory_settings_read on payroll_statutory_settings;
create policy statutory_settings_read on payroll_statutory_settings for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('payroll.manage')));
drop policy if exists statutory_settings_write on payroll_statutory_settings;
create policy statutory_settings_write on payroll_statutory_settings for all to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage')) with check (org_id = current_org_id() and has_perm('payroll.manage'));
-- Bank and tax IDs: the employee sees their own; only payroll managers see or change anyone's.
drop policy if exists emp_statutory_read on employee_statutory;
create policy emp_statutory_read on employee_statutory for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('payroll.manage')));
drop policy if exists emp_statutory_write on employee_statutory;
create policy emp_statutory_write on employee_statutory for all to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id())
  with check (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id());

create or replace function audit_employee_statutory() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- never log the numbers themselves
  perform log_audit('payroll.statutory_details_' || lower(tg_op), 'employee', coalesce(new.employee_id, old.employee_id)::text,
    jsonb_build_object('bank_changed', tg_op = 'UPDATE' and new.bank_account_no is distinct from old.bank_account_no));
  return coalesce(new, old);
end $$;
drop trigger if exists employee_statutory_audit on employee_statutory;
create trigger employee_statutory_audit after insert or update or delete on employee_statutory for each row execute function audit_employee_statutory();
