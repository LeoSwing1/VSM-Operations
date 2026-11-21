-- Block 07: Executive reporting access. Financial details remain separately gated by finance.view.
insert into role_permissions(org_id, role, permission)
select o.id, r.role, 'executive.view'
from organizations o
cross join (values ('ADMIN'::app_role), ('OPERATIONS_MANAGER'::app_role)) r(role)
on conflict do nothing;

create or replace function seed_executive_permissions(p_org uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role, 'executive.view'
  from (values ('ADMIN'::app_role), ('OPERATIONS_MANAGER'::app_role)) r(role)
  on conflict do nothing;
$$;
revoke all on function seed_executive_permissions(uuid) from public,anon,authenticated;

create or replace function organizations_seed_executive_permissions()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform seed_executive_permissions(new.id);
  return new;
end $$;
create trigger organizations_seed_executive_permissions
  after insert on organizations for each row execute function organizations_seed_executive_permissions();

-- Indexes support date-bounded executive reports without introducing denormalized financial copies.
create index if not exists invoices_org_status_issue_idx on client_invoices(org_id, status, issue_date);
create index if not exists invoice_payments_org_paid_idx on invoice_payments(org_id, paid_on);
create index if not exists finance_expenses_org_paid_idx on finance_expenses(org_id, paid_on) where status='PAID';
create index if not exists tasks_org_created_status_idx on tasks(org_id, created_at, status);
create index if not exists projects_org_deadline_status_idx on projects(org_id, deadline, status);

-- Reporting permission is not an implicit grant to payroll, finance, employee PII, or audit data.
