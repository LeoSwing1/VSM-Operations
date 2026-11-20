-- =============================================================================
-- 0005 One-off payroll adjustments (bonus / reimbursement / deduction) per run.
-- =============================================================================
create table payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('BONUS','REIMBURSEMENT','DEDUCTION')),
  label text not null check (length(label) between 2 and 120),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (length(reason) >= 5),
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);
create index payroll_adj_run_idx on payroll_adjustments(run_id, employee_id);

create or replace function payroll_adjustments_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select status from payroll_runs where id = coalesce(new.run_id, old.run_id)) <> 'DRAFT' then
    raise exception 'adjustments are locked once the run leaves DRAFT' using errcode='42501';
  end if;
  if tg_op <> 'DELETE' then
    perform _audit(new.org_id, 'payroll.adjustment_added', 'payroll_run', new.run_id::text,
      jsonb_build_object('employee_id', new.employee_id, 'kind', new.kind, 'reason', new.reason));
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_adjustments_guard_trg before insert or update or delete on payroll_adjustments
  for each row execute function payroll_adjustments_guard();

alter table payroll_adjustments enable row level security;
create policy padj_read on payroll_adjustments for select to authenticated
  using (org_id = current_org_id() and (has_perm('payroll.view_all') or has_perm('payroll.approve')
         or (employee_id = current_employee_id() and payroll_run_released(run_id))));
create policy padj_write on payroll_adjustments for insert to authenticated
  with check (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id()
              and created_by = current_employee_id());
create policy padj_delete on payroll_adjustments for delete to authenticated
  using (org_id = current_org_id() and has_perm('payroll.manage') and employee_id <> current_employee_id());
