-- Block 16: durable approval cases and manager escalation metadata.
create table if not exists workflow_approval_cases (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references organizations(id) on delete cascade,
 workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
 subject text not null check (length(subject) between 1 and 180),
 details text not null default '' check (length(details)<=2000),
 requester_id uuid not null references employees(id),
 approver_id uuid not null references employees(id),
 status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','ESCALATED','CANCELLED')),
 due_at timestamptz not null,
 escalation_level integer not null default 0 check (escalation_level between 0 and 3),
 decided_at timestamptz,
 decision_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workflow_run_id)
);
create index if not exists workflow_approval_pending_idx on workflow_approval_cases(org_id,due_at) where status='PENDING';
alter table workflow_approval_cases enable row level security;
create policy workflow_approval_read on workflow_approval_cases for select using (
 org_id=current_org_id() and (has_perm('settings.manage') or requester_id=current_employee_id() or approver_id=current_employee_id())
);
create policy workflow_approval_decide on workflow_approval_cases for update using (
 org_id=current_org_id() and approver_id=current_employee_id() and status='PENDING'
) with check (org_id=current_org_id() and approver_id=current_employee_id());

create or replace function validate_workflow_rule_actions()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare a jsonb; t text;
begin
 if jsonb_typeof(new.actions)<>'array' or jsonb_array_length(new.actions)>10 then raise exception 'Workflow must contain at most 10 actions'; end if;
 for a in select value from jsonb_array_elements(new.actions) loop
   if jsonb_typeof(a)<>'object' then raise exception 'Each workflow action must be an object'; end if;
   t:=a->>'type';
   if t not in ('notify_actor','notify_target','notify_manager','create_approval') then raise exception 'Unsupported workflow action type: %',coalesce(t,'(missing)'); end if;
   if t in ('notify_actor','notify_target','notify_manager') and (length(coalesce(a->>'title','')) not between 1 and 120 or length(coalesce(a->>'body','')) not between 1 and 1000) then raise exception 'Notification action requires a title and body'; end if;
   if t='create_approval' and (length(coalesce(a->>'subject','')) not between 1 and 180 or coalesce((a->>'sla_hours')::int,0) not between 1 and 720) then raise exception 'Approval action requires subject and SLA between 1 and 720 hours'; end if;
   if coalesce(a->>'link','')<>'' and (a->>'link') !~ '^/' then raise exception 'Workflow notification links must be relative paths'; end if;
 end loop;
 new.updated_at:=now(); return new;
end $$;
comment on table workflow_approval_cases is 'Block 16 auditable approval requests created by typed workflow actions.';
