-- Block 15: business-event routing and bounded SLA execution.
-- The event payload can identify a target employee, but the worker must validate
-- that target is active and belongs to the same organisation before delivery.
create or replace function validate_workflow_rule_actions()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare a jsonb; t text;
begin
 if jsonb_typeof(new.actions)<>'array' or jsonb_array_length(new.actions)>10 then raise exception 'Workflow must contain at most 10 actions'; end if;
 for a in select value from jsonb_array_elements(new.actions) loop
   if jsonb_typeof(a)<>'object' then raise exception 'Each workflow action must be an object'; end if;
   t:=a->>'type';
   if t not in ('notify_actor','notify_target') then raise exception 'Unsupported workflow action type: %',coalesce(t,'(missing)'); end if;
   if length(coalesce(a->>'title','')) not between 1 and 120 or length(coalesce(a->>'body','')) not between 1 and 1000 then raise exception 'Notification action requires a title (1-120) and body (1-1000)'; end if;
   if coalesce(a->>'link','')<>'' and (a->>'link') !~ '^/' then raise exception 'Workflow notification links must be relative paths'; end if;
 end loop;
 new.updated_at:=now(); return new;
end $$;
comment on column workflow_rules.actions is 'Block 15 typed registry: notify_actor and notify_target. Target resolves only payload.target_employee_id and is validated active within the same organisation by the worker.';
create index if not exists workflow_runs_sla_lookup_idx on workflow_runs(org_id,event_key,created_at desc);
