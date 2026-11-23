-- Block 04: Finance ERP. All monetary values are stored as numeric(14,2) in org currency.
create table vendors (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160), contact_name text, email text, phone text,
  tax_id text, address text, payment_terms text, bank_details jsonb not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ON_HOLD','ARCHIVED')),
  notes text, created_by uuid references employees(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,name), unique(org_id,tax_id)
);
create index vendors_org_status_idx on vendors(org_id,status);

create table finance_expenses (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  expense_code text not null, expense_type text not null check (expense_type in ('COMPANY_EXPENSE','REIMBURSEMENT')),
  employee_id uuid not null references employees(id), vendor_id uuid references vendors(id), project_id uuid references projects(id), department_id uuid references departments(id),
  category text not null check (length(trim(category)) between 2 and 80), description text not null check (length(trim(description)) between 3 and 1000),
  amount numeric(14,2) not null check (amount > 0), currency text not null default 'INR', expense_date date not null,
  receipt_path text, receipt_name text, receipt_mime text, receipt_size bigint check (receipt_size is null or receipt_size between 1 and 10485760),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','MANAGER_APPROVED','APPROVED','REJECTED','PAID','CANCELLED')),
  manager_id uuid references employees(id), manager_decision_at timestamptz, manager_note text,
  finance_decided_by uuid references employees(id), finance_decision_at timestamptz, finance_note text,
  paid_by uuid references employees(id), paid_at timestamptz, payment_reference text, payment_method text, paid_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,expense_code), check ((status <> 'PAID') or (paid_at is not null and paid_by is not null and paid_on is not null and payment_reference is not null and payment_method is not null))
);
create index finance_expenses_org_date_idx on finance_expenses(org_id,expense_date desc);
create index finance_expenses_employee_idx on finance_expenses(employee_id,created_at desc);
create index finance_expenses_status_idx on finance_expenses(org_id,status);

create table client_invoices (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  invoice_number text not null, client_id uuid not null references clients(id), project_id uuid references projects(id),
  issue_date date not null, due_date date not null, currency text not null default 'INR',
  subtotal numeric(14,2) not null check (subtotal >= 0), tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) generated always as (subtotal + tax_amount) stored,
  status text not null default 'DRAFT' check (status in ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOID','OVERDUE')),
  notes text, terms text, issued_by uuid references employees(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,invoice_number), check(due_date >= issue_date)
);
create table invoice_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references client_invoices(id) on delete cascade, description text not null,
  quantity numeric(12,3) not null check(quantity > 0), unit_price numeric(14,2) not null check(unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price,2)) stored
);
create index invoices_org_dates_idx on client_invoices(org_id,issue_date desc);

create table invoice_payments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references client_invoices(id), amount numeric(14,2) not null check(amount > 0),
  paid_on date not null, method text not null check(method in ('BANK_TRANSFER','UPI','CASH','CARD','CHEQUE','OTHER')),
  reference text not null, notes text, recorded_by uuid not null references employees(id), created_at timestamptz not null default now(),
  unique(org_id,reference)
);
create index invoice_payments_invoice_idx on invoice_payments(invoice_id,paid_on);

create table vendor_payments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  vendor_id uuid not null references vendors(id), expense_id uuid references finance_expenses(id), amount numeric(14,2) not null check(amount > 0),
  paid_on date not null, method text not null check(method in ('BANK_TRANSFER','UPI','CASH','CARD','CHEQUE','OTHER')),
  reference text not null, notes text, recorded_by uuid not null references employees(id), created_at timestamptz not null default now(), unique(org_id,reference)
);

create table department_budgets (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  department_id uuid references departments(id), project_id uuid references projects(id), period_start date not null, period_end date not null,
  category text not null default 'GENERAL', amount numeric(14,2) not null check(amount >= 0), currency text not null default 'INR',
  created_by uuid not null references employees(id), created_at timestamptz not null default now(),
  check(period_end >= period_start), check(department_id is not null or project_id is not null),
  unique(org_id,department_id,project_id,period_start,category)
);
create index finance_budgets_period_idx on department_budgets(org_id,period_start,period_end);

create table bank_reconciliations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  statement_date date not null, bank_account_label text not null, opening_balance numeric(14,2) not null default 0,
  closing_balance numeric(14,2) not null, status text not null default 'OPEN' check(status in ('OPEN','IN_REVIEW','RECONCILED','CLOSED')),
  notes text, created_by uuid not null references employees(id), reconciled_by uuid references employees(id), reconciled_at timestamptz, created_at timestamptz not null default now()
);
create table bank_statement_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  reconciliation_id uuid not null references bank_reconciliations(id) on delete cascade, transaction_date date not null,
  description text not null, reference text, debit numeric(14,2) not null default 0 check(debit >= 0), credit numeric(14,2) not null default 0 check(credit >= 0),
  matched_type text check(matched_type in ('EXPENSE','VENDOR_PAYMENT','INVOICE_PAYMENT')), matched_id uuid, matched_at timestamptz, matched_by uuid references employees(id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index bank_lines_recon_idx on bank_statement_lines(reconciliation_id,transaction_date);

-- Cross-tenant and relation guard. FK ids alone are not sufficient to establish tenant ownership.
create or replace function finance_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name = 'vendors' then
    if new.created_by is not null and not exists(select 1 from employees where id=new.created_by and org_id=new.org_id) then raise exception 'cross-organisation vendor creator' using errcode='23514'; end if;
  elsif tg_table_name = 'finance_expenses' then
    if not exists(select 1 from employees where id=new.employee_id and org_id=new.org_id) then raise exception 'expense employee must belong to organisation' using errcode='23514'; end if;
    if new.vendor_id is not null and not exists(select 1 from vendors where id=new.vendor_id and org_id=new.org_id) then raise exception 'vendor organisation mismatch' using errcode='23514'; end if;
    if new.project_id is not null and not exists(select 1 from projects where id=new.project_id and org_id=new.org_id) then raise exception 'project organisation mismatch' using errcode='23514'; end if;
    if new.department_id is not null and not exists(select 1 from departments where id=new.department_id and org_id=new.org_id) then raise exception 'department organisation mismatch' using errcode='23514'; end if;
    if new.manager_id is not null and not exists(select 1 from employees where id=new.manager_id and org_id=new.org_id) then raise exception 'manager organisation mismatch' using errcode='23514'; end if;
    if new.finance_decided_by is not null and not exists(select 1 from employees where id=new.finance_decided_by and org_id=new.org_id) then raise exception 'finance approver organisation mismatch' using errcode='23514'; end if;
    if new.paid_by is not null and not exists(select 1 from employees where id=new.paid_by and org_id=new.org_id) then raise exception 'payer organisation mismatch' using errcode='23514'; end if;
    if new.receipt_path is not null and (new.receipt_path not like new.org_id::text||'/'||new.employee_id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='finance-receipts' and name=new.receipt_path)) then raise exception 'receipt path must be a private object uploaded for this employee' using errcode='23514'; end if;
    if (new.receipt_path is null and (new.receipt_name is not null or new.receipt_mime is not null or new.receipt_size is not null)) or (new.receipt_path is not null and (new.receipt_name is null or new.receipt_mime is null or new.receipt_size is null)) then raise exception 'receipt metadata is incomplete' using errcode='23514'; end if;
    if new.receipt_mime is not null and new.receipt_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception 'unsupported receipt type' using errcode='23514'; end if;
  elsif tg_table_name = 'client_invoices' then
    if not exists(select 1 from clients where id=new.client_id and org_id=new.org_id) then raise exception 'client organisation mismatch' using errcode='23514'; end if;
    if new.project_id is not null and not exists(select 1 from projects where id=new.project_id and org_id=new.org_id) then raise exception 'project organisation mismatch' using errcode='23514'; end if;
    if new.issued_by is not null and not exists(select 1 from employees where id=new.issued_by and org_id=new.org_id) then raise exception 'issuer organisation mismatch' using errcode='23514'; end if;
  elsif tg_table_name = 'invoice_lines' then
    if not exists(select 1 from client_invoices where id=new.invoice_id and org_id=new.org_id) then raise exception 'invoice organisation mismatch' using errcode='23514'; end if;
  elsif tg_table_name = 'invoice_payments' then
    if not exists(select 1 from client_invoices where id=new.invoice_id and org_id=new.org_id) then raise exception 'invoice organisation mismatch' using errcode='23514'; end if;
  elsif tg_table_name = 'vendor_payments' then
    if not exists(select 1 from vendors where id=new.vendor_id and org_id=new.org_id) then raise exception 'vendor organisation mismatch' using errcode='23514'; end if;
    if new.expense_id is not null and not exists(select 1 from finance_expenses where id=new.expense_id and org_id=new.org_id) then raise exception 'expense organisation mismatch' using errcode='23514'; end if;
  elsif tg_table_name = 'department_budgets' then
    if new.department_id is not null and not exists(select 1 from departments where id=new.department_id and org_id=new.org_id) then raise exception 'department organisation mismatch' using errcode='23514'; end if;
    if new.project_id is not null and not exists(select 1 from projects where id=new.project_id and org_id=new.org_id) then raise exception 'project organisation mismatch' using errcode='23514'; end if;
    if not exists(select 1 from employees where id=new.created_by and org_id=new.org_id) then raise exception 'budget creator organisation mismatch' using errcode='23514'; end if;
  elsif tg_table_name = 'bank_statement_lines' then
    if not exists(select 1 from bank_reconciliations where id=new.reconciliation_id and org_id=new.org_id and status='OPEN') then raise exception 'statement lines can only be added to an open reconciliation' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger vendors_org_guard before insert or update on vendors for each row execute function finance_org_guard();
create trigger finance_expenses_org_guard before insert or update on finance_expenses for each row execute function finance_org_guard();
create trigger client_invoices_org_guard before insert or update on client_invoices for each row execute function finance_org_guard();
create trigger invoice_lines_org_guard before insert or update on invoice_lines for each row execute function finance_org_guard();
create trigger invoice_payments_org_guard before insert or update on invoice_payments for each row execute function finance_org_guard();
create trigger vendor_payments_org_guard before insert or update on vendor_payments for each row execute function finance_org_guard();
create trigger department_budgets_org_guard before insert or update on department_budgets for each row execute function finance_org_guard();
create trigger bank_statement_lines_org_guard before insert or update on bank_statement_lines for each row execute function finance_org_guard();

-- RPCs enforce a two-step approval chain and immutable payment evidence.
create or replace function finance_expense_decide(p_expense uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e finance_expenses;
begin
 select * into e from finance_expenses where id=p_expense and org_id=current_org_id() for update;
 if e.id is null then raise exception 'expense not found'; end if;
 if p_decision not in ('APPROVE','REJECT') then raise exception 'invalid decision'; end if;
 if e.status not in ('SUBMITTED','MANAGER_APPROVED') then raise exception 'expense is not awaiting this decision'; end if;
 if e.status='SUBMITTED' then
   if e.employee_id=current_employee_id() or not (has_perm('finance.approve_manager') and (has_perm('finance.approve_all') or is_in_my_team(e.employee_id))) then raise exception 'manager approval permission required' using errcode='42501'; end if;
   if p_decision='REJECT' then update finance_expenses set status='REJECTED',manager_id=current_employee_id(),manager_decision_at=now(),manager_note=p_note,updated_at=now() where id=e.id;
   else update finance_expenses set status='MANAGER_APPROVED',manager_id=current_employee_id(),manager_decision_at=now(),manager_note=p_note,updated_at=now() where id=e.id; end if;
 else
   if e.employee_id=current_employee_id() or not has_perm('finance.approve') then raise exception 'finance approval permission required' using errcode='42501'; end if;
   if e.manager_id=current_employee_id() then raise exception 'manager and finance approval must be different people' using errcode='42501'; end if;
   if p_decision='REJECT' then update finance_expenses set status='REJECTED',finance_decided_by=current_employee_id(),finance_decision_at=now(),finance_note=p_note,updated_at=now() where id=e.id;
   else update finance_expenses set status='APPROVED',finance_decided_by=current_employee_id(),finance_decision_at=now(),finance_note=p_note,updated_at=now() where id=e.id; end if;
 end if;
 perform log_audit('finance.expense_'||lower(p_decision),'finance_expense',e.id::text,jsonb_build_object('stage',e.status,'amount',e.amount,'note',p_note));
end $$;
revoke all on function finance_expense_decide(uuid,text,text) from public,anon;
grant execute on function finance_expense_decide(uuid,text,text) to authenticated;

create or replace function finance_mark_expense_paid(p_expense uuid,p_reference text,p_method text,p_paid_on date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e finance_expenses;
begin
 if not has_perm('finance.pay') then raise exception 'finance.pay required' using errcode='42501'; end if;
 select * into e from finance_expenses where id=p_expense and org_id=current_org_id() for update;
 if e.id is null or e.status <> 'APPROVED' then raise exception 'only approved expenses can be paid'; end if;
 if p_paid_on is null or length(trim(p_reference))<3 or p_method not in ('BANK_TRANSFER','UPI','CASH','CARD','CHEQUE','OTHER') then raise exception 'valid payment reference and method required'; end if;
 update finance_expenses set status='PAID',payment_reference=trim(p_reference),payment_method=p_method,paid_on=p_paid_on,paid_by=current_employee_id(),paid_at=now(),updated_at=now() where id=e.id;
 perform log_audit('finance.expense_paid','finance_expense',e.id::text,jsonb_build_object('amount',e.amount,'reference',p_reference));
end $$;
revoke all on function finance_mark_expense_paid(uuid,text,text,date) from public,anon;
grant execute on function finance_mark_expense_paid(uuid,text,text,date) to authenticated;

create or replace function finance_record_invoice_payment(p_invoice uuid,p_amount numeric,p_paid_on date,p_method text,p_reference text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare i client_invoices; paid numeric(14,2); new_id uuid;
begin
 if not (has_perm('finance.manage') or has_perm('finance.pay')) then raise exception 'finance.manage required' using errcode='42501'; end if;
 select * into i from client_invoices where id=p_invoice and org_id=current_org_id() for update;
 if i.id is null or i.status not in ('ISSUED','PARTIALLY_PAID','OVERDUE') then raise exception 'invoice is not receivable'; end if;
 select coalesce(sum(amount),0) into paid from invoice_payments where invoice_id=i.id;
 if p_amount<=0 or p_amount > i.total_amount-paid then raise exception 'payment exceeds outstanding invoice balance'; end if;
 if p_method not in ('BANK_TRANSFER','UPI','CASH','CARD','CHEQUE','OTHER') or length(trim(p_reference))<3 then raise exception 'payment method and reference required'; end if;
 insert into invoice_payments(org_id,invoice_id,amount,paid_on,method,reference,notes,recorded_by) values(i.org_id,i.id,p_amount,p_paid_on,p_method,trim(p_reference),p_notes,current_employee_id()) returning id into new_id;
 select coalesce(sum(amount),0) into paid from invoice_payments where invoice_id=i.id;
 update client_invoices set status=case when paid>=i.total_amount then 'PAID' else 'PARTIALLY_PAID' end,updated_at=now() where id=i.id;
 perform log_audit('finance.invoice_payment_recorded','client_invoice',i.id::text,jsonb_build_object('payment_id',new_id,'amount',p_amount,'reference',p_reference));
 return new_id;
end $$;
revoke all on function finance_record_invoice_payment(uuid,numeric,date,text,text,text) from public,anon;
grant execute on function finance_record_invoice_payment(uuid,numeric,date,text,text,text) to authenticated;

-- Tenant-scoped RLS. Employee self-service is restricted to own submitted expenses.
alter table vendors enable row level security;
create policy vendors_finance_read on vendors for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.pay')));
create policy vendors_finance_write on vendors for all to authenticated using(org_id=current_org_id() and has_perm('finance.manage')) with check(org_id=current_org_id() and has_perm('finance.manage'));
alter table finance_expenses enable row level security;
create policy finance_expenses_read on finance_expenses for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.approve') or has_perm('finance.pay') or has_perm('finance.export') or has_perm('finance.approve_all') or (has_perm('finance.approve_manager') and is_in_my_team(employee_id))));
create policy finance_expenses_insert on finance_expenses for insert to authenticated with check(org_id=current_org_id() and employee_id=current_employee_id() and status in ('DRAFT','SUBMITTED') and manager_id is null and manager_decision_at is null and finance_decided_by is null and finance_decision_at is null and paid_by is null and paid_at is null and paid_on is null and payment_reference is null and payment_method is null and manager_note is null and finance_note is null  );
revoke delete on finance_expenses from authenticated;

alter table client_invoices enable row level security;
create policy invoices_read on client_invoices for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.pay')));
alter table invoice_lines enable row level security;
create policy invoice_lines_read on invoice_lines for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.pay')));
alter table invoice_payments enable row level security;
create policy invoice_payments_read on invoice_payments for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.pay') or has_perm('finance.export')));
create policy invoice_payments_insert on invoice_payments for insert to authenticated with check(false); -- all payments use transaction-safe RPC
alter table vendor_payments enable row level security;
create policy vendor_payments_read on vendor_payments for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.pay') or has_perm('finance.export')));
create policy vendor_payments_insert on vendor_payments for insert to authenticated with check(org_id=current_org_id() and has_perm('finance.pay') and recorded_by=current_employee_id());
alter table department_budgets enable row level security;
create policy budgets_read on department_budgets for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));
create policy budgets_write on department_budgets for all to authenticated using(org_id=current_org_id() and has_perm('finance.manage')) with check(org_id=current_org_id() and has_perm('finance.manage'));
alter table bank_reconciliations enable row level security;
create policy reconciliation_read on bank_reconciliations for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));
create policy reconciliation_insert on bank_reconciliations for insert to authenticated with check(org_id=current_org_id() and has_perm('finance.manage') and status='OPEN' and created_by=current_employee_id() and reconciled_by is null and reconciled_at is null);
alter table bank_statement_lines enable row level security;
create policy statement_lines_read on bank_statement_lines for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));
create policy statement_lines_insert on bank_statement_lines for insert to authenticated with check(org_id=current_org_id() and has_perm('finance.manage') and matched_type is null and matched_id is null and matched_at is null and matched_by is null);

-- Private receipt bucket; the expense row is the authoritative access check.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finance-receipts','finance-receipts',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy finance_receipts_read on storage.objects for select to authenticated using(bucket_id='finance-receipts' and exists(
 select 1 from finance_expenses e where e.receipt_path=name and e.org_id=current_org_id() and
 (e.employee_id=current_employee_id() or has_perm('finance.view') or has_perm('finance.manage') or has_perm('finance.approve') or has_perm('finance.pay') or has_perm('finance.export') or has_perm('finance.approve_all') or (has_perm('finance.approve_manager') and is_in_my_team(e.employee_id)))
));
create policy finance_receipts_insert on storage.objects for insert to authenticated with check(bucket_id='finance-receipts' and (storage.foldername(name))[1]=current_org_id()::text and (storage.foldername(name))[2]=current_employee_id()::text and lower(storage.extension(name)) in ('pdf','jpg','jpeg','png','webp'));
create policy finance_receipts_delete on storage.objects for delete to authenticated using(bucket_id='finance-receipts' and (storage.foldername(name))[1]=current_org_id()::text and (storage.foldername(name))[2]=current_employee_id()::text and not exists(select 1 from finance_expenses e where e.receipt_path=name and e.org_id=current_org_id()));

-- Audit all finance master/ledger mutations, excluding receipt bytes.
create or replace function finance_audit_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
   perform _audit(old.org_id,'finance.'||lower(tg_op),tg_table_name,old.id::text,jsonb_build_object('status',old.status));
   return old;
 else
   perform _audit(new.org_id,'finance.'||lower(tg_op),tg_table_name,new.id::text,jsonb_build_object('status',new.status));
   return new;
 end if;
end $$;
create trigger finance_expenses_audit after insert or update or delete on finance_expenses for each row execute function finance_audit_trigger();
create trigger finance_invoices_audit after insert or update or delete on client_invoices for each row execute function finance_audit_trigger();
create trigger finance_vendors_audit after insert or update or delete on vendors for each row execute function finance_audit_trigger();

-- Read-only report views, scoped by the underlying RLS-protected tables.
create view finance_monthly_summary with (security_invoker=true) as
select org_id,date_trunc('month',expense_date)::date as month,
 sum(amount) filter(where status in ('APPROVED','PAID')) as approved_expenditure,
 sum(amount) filter(where status='PAID') as paid_expenditure,
 count(*) filter(where status in ('SUBMITTED','MANAGER_APPROVED')) as pending_approvals
from finance_expenses group by org_id,date_trunc('month',expense_date)::date;
create view finance_invoice_balances with (security_invoker=true) as
select i.id,i.org_id,i.invoice_number,i.client_id,i.issue_date,i.due_date,i.currency,i.total_amount,
 case when i.status in ('ISSUED','PARTIALLY_PAID') and i.due_date<current_date then 'OVERDUE' else i.status end as status,
 coalesce(sum(p.amount),0)::numeric(14,2) paid_amount,(i.total_amount-coalesce(sum(p.amount),0))::numeric(14,2) outstanding_amount
from client_invoices i left join invoice_payments p on p.invoice_id=i.id group by i.id;

-- Cross-tenant validation for reconciliation headers and payment actors.
create or replace function finance_org_guard_more() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='bank_reconciliations' then
   if not exists(select 1 from employees where id=new.created_by and org_id=new.org_id) then raise exception 'creator organisation mismatch' using errcode='23514'; end if;
   if new.reconciled_by is not null and not exists(select 1 from employees where id=new.reconciled_by and org_id=new.org_id) then raise exception 'reconciler organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='invoice_payments' then
   if not exists(select 1 from employees where id=new.recorded_by and org_id=new.org_id) then raise exception 'recorder organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='vendor_payments' then
   if not exists(select 1 from employees where id=new.recorded_by and org_id=new.org_id) then raise exception 'recorder organisation mismatch' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger bank_reconciliations_org_guard before insert or update on bank_reconciliations for each row execute function finance_org_guard_more();
create trigger invoice_payments_org_guard_more before insert or update on invoice_payments for each row execute function finance_org_guard_more();
create trigger vendor_payments_org_guard_more before insert or update on vendor_payments for each row execute function finance_org_guard_more();

-- Default company administrators receive the finance operations set; additional
-- Finance/Accounts users should be granted the exact permissions by Super Admin.
insert into role_permissions(org_id,role,permission)
select o.id,'ADMIN'::app_role,p.permission from organizations o
cross join (values ('finance.view'),('finance.manage'),('finance.approve_manager'),('finance.approve_all'),('finance.approve'),('finance.pay'),('finance.export')) as p(permission)
on conflict do nothing;

-- Restrict sensitive state changes to transaction-safe RPCs; RLS alone cannot
-- constrain which columns a caller updates.
revoke update on finance_expenses from authenticated;
revoke update, delete on client_invoices from authenticated;
revoke update on invoice_payments from authenticated;
revoke update on vendor_payments from authenticated;
revoke update on bank_statement_lines from authenticated;
revoke update on bank_reconciliations from authenticated;

create or replace function finance_create_invoice(
 p_client_id uuid,p_project_id uuid,p_invoice_number text,p_issue_date date,p_due_date date,
 p_description text,p_quantity numeric,p_unit_price numeric,p_tax_amount numeric,p_notes text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_org uuid:=current_org_id(); v_subtotal numeric(14,2);
begin
 if not has_perm('finance.manage') then raise exception 'finance.manage required' using errcode='42501'; end if;
 if v_org is null or not exists(select 1 from clients where id=p_client_id and org_id=v_org) then raise exception 'client not found in this organisation'; end if;
 if p_project_id is not null and not exists(select 1 from projects where id=p_project_id and org_id=v_org) then raise exception 'project not found in this organisation'; end if;
 if p_due_date<p_issue_date or length(trim(p_invoice_number))<2 or length(trim(p_description))<2 or p_quantity<=0 or p_unit_price<0 or p_tax_amount<0 then raise exception 'invalid invoice details'; end if;
 v_subtotal:=round(p_quantity*p_unit_price,2);
 insert into client_invoices(org_id,invoice_number,client_id,project_id,issue_date,due_date,subtotal,tax_amount,status,notes,issued_by)
 values(v_org,trim(p_invoice_number),p_client_id,p_project_id,p_issue_date,p_due_date,v_subtotal,p_tax_amount,'DRAFT',p_notes,current_employee_id()) returning id into v_id;
 insert into invoice_lines(org_id,invoice_id,description,quantity,unit_price) values(v_org,v_id,trim(p_description),p_quantity,p_unit_price);
 perform log_audit('finance.invoice_draft_created','client_invoice',v_id::text,jsonb_build_object('invoice_number',p_invoice_number,'total',v_subtotal+p_tax_amount));
 return v_id;
end $$;
revoke all on function finance_create_invoice(uuid,uuid,text,date,date,text,numeric,numeric,numeric,text) from public,anon;
grant execute on function finance_create_invoice(uuid,uuid,text,date,date,text,numeric,numeric,numeric,text) to authenticated;
revoke insert,update,delete on client_invoices from authenticated;
revoke insert,update,delete on invoice_lines from authenticated;

create or replace function finance_issue_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare i client_invoices; n int; line_sum numeric(14,2);
begin
 if not has_perm('finance.manage') then raise exception 'finance.manage required' using errcode='42501'; end if;
 select * into i from client_invoices where id=p_invoice and org_id=current_org_id() for update;
 if i.id is null or i.status<>'DRAFT' then raise exception 'only draft invoices can be issued'; end if;
 select count(*),coalesce(sum(line_total),0) into n,line_sum from invoice_lines where invoice_id=i.id and org_id=i.org_id;
 if n=0 or i.total_amount<=0 or round(line_sum,2)<>round(i.subtotal,2) then raise exception 'invoice lines must exist and equal the invoice subtotal'; end if;
 update client_invoices set status='ISSUED',updated_at=now() where id=i.id;
 perform log_audit('finance.invoice_issued','client_invoice',i.id::text,jsonb_build_object('total',i.total_amount));
end $$;
revoke all on function finance_issue_invoice(uuid) from public,anon;
grant execute on function finance_issue_invoice(uuid) to authenticated;

create or replace function finance_match_statement_line(p_line uuid,p_type text,p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare l bank_statement_lines; amount numeric(14,2); expected_side text;
begin
 if not has_perm('finance.manage') then raise exception 'finance.manage required' using errcode='42501'; end if;
 select * into l from bank_statement_lines where id=p_line and org_id=current_org_id() for update;
 if l.id is null or l.matched_id is not null or not exists(select 1 from bank_reconciliations r where r.id=l.reconciliation_id and r.org_id=l.org_id and r.status='OPEN') then raise exception 'statement line missing, closed or already matched'; end if;
 if p_type='EXPENSE' then
   select e.amount into amount from finance_expenses e where e.id=p_id and e.org_id=l.org_id and e.status='PAID'; expected_side:='DEBIT';
 elsif p_type='VENDOR_PAYMENT' then
   select p.amount into amount from vendor_payments p where p.id=p_id and p.org_id=l.org_id; expected_side:='DEBIT';
 elsif p_type='INVOICE_PAYMENT' then
   select p.amount into amount from invoice_payments p where p.id=p_id and p.org_id=l.org_id; expected_side:='CREDIT';
 else raise exception 'invalid match type'; end if;
 if amount is null then raise exception 'matching ledger transaction not found'; end if;
 if round(amount,2)<>round(case when expected_side='DEBIT' then l.debit else l.credit end,2) then raise exception 'statement amount or debit/credit direction does not match'; end if;
 update bank_statement_lines set matched_type=p_type,matched_id=p_id,matched_at=now(),matched_by=current_employee_id() where id=l.id;
 perform log_audit('finance.statement_line_matched','bank_statement_line',l.id::text,jsonb_build_object('matched_type',p_type,'matched_id',p_id));
end $$;
revoke all on function finance_match_statement_line(uuid,text,uuid) from public,anon;
grant execute on function finance_match_statement_line(uuid,text,uuid) to authenticated;

create or replace function finance_close_reconciliation(p_reconciliation uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r bank_reconciliations; line_count int; matched_count int; movement numeric(14,2);
begin
 if not has_perm('finance.manage') then raise exception 'finance.manage required' using errcode='42501'; end if;
 select * into r from bank_reconciliations where id=p_reconciliation and org_id=current_org_id() for update;
 if r.id is null or r.status not in ('OPEN','IN_REVIEW') then raise exception 'reconciliation is not open'; end if;
 select count(*),count(*) filter(where matched_id is not null),coalesce(sum(credit-debit),0) into line_count,matched_count,movement from bank_statement_lines where reconciliation_id=r.id and org_id=r.org_id;
 if line_count=0 or line_count<>matched_count then raise exception 'all statement lines must be matched before closing'; end if;
 if round(r.opening_balance+movement,2)<>round(r.closing_balance,2) then raise exception 'statement movement does not reconcile to closing balance'; end if;
 update bank_reconciliations set status='RECONCILED',reconciled_by=current_employee_id(),reconciled_at=now() where id=r.id;
 perform log_audit('finance.reconciliation_closed','bank_reconciliation',r.id::text,jsonb_build_object('lines',line_count,'movement',movement));
end $$;
revoke all on function finance_close_reconciliation(uuid) from public,anon;
grant execute on function finance_close_reconciliation(uuid) to authenticated;

create or replace function finance_audit_ledger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; v_id text; v_org uuid;
begin
 v:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_id:=v->>'id'; v_org:=(v->>'org_id')::uuid;
 perform _audit(v_org,'finance.'||lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,v_id,
   jsonb_build_object('status',v->>'status','amount',v->>'amount','reference',v->>'reference'));
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger finance_invoice_payments_audit after insert or update or delete on invoice_payments for each row execute function finance_audit_ledger();
create trigger finance_vendor_payments_audit after insert or update or delete on vendor_payments for each row execute function finance_audit_ledger();
create trigger finance_budgets_audit after insert or update or delete on department_budgets for each row execute function finance_audit_ledger();
create trigger finance_reconciliations_audit after insert or update or delete on bank_reconciliations for each row execute function finance_audit_ledger();
create trigger finance_statement_lines_audit after insert or update or delete on bank_statement_lines for each row execute function finance_audit_ledger();

-- Finance operators must be able to choose the org's clients/projects on invoices and cost allocations.
create policy finance_clients_read on clients for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));
create policy finance_projects_read on projects for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));

-- Avoid duplicate budget rows when one of the optional dimensions is NULL.
create unique index department_budgets_project_unique on department_budgets(org_id,project_id,period_start,category) where department_id is null;
create unique index department_budgets_department_unique on department_budgets(org_id,department_id,period_start,category) where project_id is null;

-- Keep the SQL grant guard aligned with the application permission catalogue.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
  select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%'
      or p in ('roles.manage','audit.view','settings.manage')
$$;
