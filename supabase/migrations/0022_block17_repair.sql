-- =============================================================================
-- 0022 Repair (Block 17)
-- Forward-only fixes for three defects found in the Block 16 audit. Safe to run on any
-- database that has 0001–0021 applied, fully or partly. Idempotent: running it twice is harmless.
--
--  1. 0009 guard_hr_org_refs() read NEW.uploaded_by on tables without that column, so every
--     probation review, exit-clearance item and employment letter insert failed.
--  2. 0014 seed_workforce_collaboration_permissions() ended with END inside a LANGUAGE SQL body
--     (END = COMMIT), so creating a NEW organisation (bootstrap) failed.
--  3. 0010 stopped at a syntax error (line 252). Everything after it — finance report views,
--     org guards, column revokes, invoice/reconciliation functions, audit triggers, finance read
--     policies and budget indexes — was never created. It is replayed here idempotently.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
create or replace function guard_hr_org_refs() returns trigger language plpgsql as $$
declare r jsonb := to_jsonb(new);
  ref_columns text[] := array['uploaded_by','reviewer_id','approved_by','owner_id','completed_by','issued_by','revoked_by'];
  col text;
begin
  if not exists (select 1 from employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee must belong to the same organization' using errcode = '23514';
  end if;
  foreach col in array ref_columns loop
    if r ? col and (r ->> col) is not null
       and not exists (select 1 from employees e where e.id = (r ->> col)::uuid and e.org_id = new.org_id) then
      raise exception '% must belong to the same organization', replace(col, '_', ' ') using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;

-- 2 ---------------------------------------------------------------------------
create or replace function seed_workforce_collaboration_permissions(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role, p.permission
  from (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
  cross join (values ('teams.view_all'),('time.view_all'),('time.view_team'),('time.approve_all'),('time.approve_team'),('quality.view_all'),('quality.view_team'),('quality.review'),('calendar.manage')) p(permission)
  where r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('time.view_team','time.approve_team','quality.view_team','quality.review')
  on conflict do nothing;
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role, p.permission
  from (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
  cross join (values ('teams.manage'),('teams.manage_team'),('teams.create_group'),('calendar.create'),('quality.manage')) p(permission)
  where r.role in ('SUPER_ADMIN','ADMIN','OPERATIONS_MANAGER') or p.permission in ('teams.manage_team','teams.create_group','calendar.create')
  on conflict do nothing;
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role, 'calendar.create' from unnest(enum_range(null::app_role)) as r(role)
  on conflict do nothing;
$$;
revoke all on function seed_workforce_collaboration_permissions(uuid) from public, anon, authenticated;

-- 3 --- replay of 0010 from its report views to the end (idempotent) ----------
-- Read-only report views, scoped by the underlying RLS-protected tables.
create or replace view finance_monthly_summary with (security_invoker=true) as
select org_id,date_trunc('month',expense_date)::date as month,
 sum(amount) filter(where status in ('APPROVED','PAID')) as approved_expenditure,
 sum(amount) filter(where status='PAID') as paid_expenditure,
 count(*) filter(where status in ('SUBMITTED','MANAGER_APPROVED')) as pending_approvals
from finance_expenses group by org_id,date_trunc('month',expense_date)::date;
create or replace view finance_invoice_balances with (security_invoker=true) as
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
drop trigger if exists bank_reconciliations_org_guard on bank_reconciliations;
create trigger bank_reconciliations_org_guard before insert or update on bank_reconciliations for each row execute function finance_org_guard_more();
drop trigger if exists invoice_payments_org_guard_more on invoice_payments;
create trigger invoice_payments_org_guard_more before insert or update on invoice_payments for each row execute function finance_org_guard_more();
drop trigger if exists vendor_payments_org_guard_more on vendor_payments;
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
drop trigger if exists finance_invoice_payments_audit on invoice_payments;
create trigger finance_invoice_payments_audit after insert or update or delete on invoice_payments for each row execute function finance_audit_ledger();
drop trigger if exists finance_vendor_payments_audit on vendor_payments;
create trigger finance_vendor_payments_audit after insert or update or delete on vendor_payments for each row execute function finance_audit_ledger();
drop trigger if exists finance_budgets_audit on department_budgets;
create trigger finance_budgets_audit after insert or update or delete on department_budgets for each row execute function finance_audit_ledger();
drop trigger if exists finance_reconciliations_audit on bank_reconciliations;
create trigger finance_reconciliations_audit after insert or update or delete on bank_reconciliations for each row execute function finance_audit_ledger();
drop trigger if exists finance_statement_lines_audit on bank_statement_lines;
create trigger finance_statement_lines_audit after insert or update or delete on bank_statement_lines for each row execute function finance_audit_ledger();

-- Finance operators must be able to choose the org's clients/projects on invoices and cost allocations.
drop policy if exists finance_clients_read on clients;
create policy finance_clients_read on clients for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));
drop policy if exists finance_projects_read on projects;
create policy finance_projects_read on projects for select to authenticated using(org_id=current_org_id() and (has_perm('finance.view') or has_perm('finance.manage')));

-- Avoid duplicate budget rows when one of the optional dimensions is NULL.
create unique index if not exists department_budgets_project_unique on department_budgets(org_id,project_id,period_start,category) where department_id is null;
create unique index if not exists department_budgets_department_unique on department_budgets(org_id,department_id,period_start,category) where project_id is null;

-- Keep the SQL grant guard aligned with the application permission catalogue.

-- Keep the newest sensitive-permission rule (0014), never the older 0010 one.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
 select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%'
   or p in ('roles.manage','audit.view','settings.manage','communication.moderate','communication.channel_manage',
            'teams.manage','time.approve_all','quality.manage','calendar.manage')
$$;
