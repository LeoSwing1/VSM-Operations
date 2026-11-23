-- Block 11: typed, auditable workflow configuration and execution support.
-- Arbitrary code/SQL actions are intentionally not supported.
create index if not exists workflow_runs_org_created_idx on workflow_runs(org_id, created_at desc);
create index if not exists workflow_rules_org_updated_idx on workflow_rules(org_id, updated_at desc);

create or replace function validate_workflow_rule_actions()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare a jsonb; t text;
begin
 if jsonb_typeof(new.actions)<>'array' or jsonb_array_length(new.actions)>10 then raise exception 'Workflow must contain at most 10 actions'; end if;
 for a in select value from jsonb_array_elements(new.actions) loop
   if jsonb_typeof(a)<>'object' then raise exception 'Each workflow action must be an object'; end if;
   t:=a->>'type';
   if t not in ('notify_actor') then raise exception 'Unsupported workflow action type: %',coalesce(t,'(missing)'); end if;
   if length(coalesce(a->>'title','')) not between 1 and 120 or length(coalesce(a->>'body','')) not between 1 and 1000 then raise exception 'Notification action requires a title (1-120) and body (1-1000)'; end if;
   if coalesce(a->>'link','')<>'' and (a->>'link') !~ '^/' then raise exception 'Workflow notification links must be relative paths'; end if;
 end loop;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists workflow_rule_actions_validate on workflow_rules;
create trigger workflow_rule_actions_validate before insert or update of actions,name,event_key,enabled on workflow_rules for each row execute function validate_workflow_rule_actions();

-- Keep the action registry intentionally narrow and deterministic.
comment on column workflow_rules.actions is 'Typed action array. Block 11 supports notify_actor only; no arbitrary code, URLs, SQL or user-selected recipients.';
comment on function claim_workflow_runs(integer) is 'Service-role-only queue claim. Process with the typed Block 11 action registry.';

-- Authenticated business actions may enqueue only as themselves; this removes the
-- Block 10 settings.manage-only limitation without allowing actor impersonation.
create or replace function enqueue_workflow_event(p_event_key text,p_idempotency_key text,p_payload jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_org_id(); v_actor uuid:=current_employee_id(); v_count integer:=0; r workflow_rules;
begin
 if v_org is null or v_actor is null then raise exception 'active employee context required' using errcode='42501'; end if;
 if p_event_key is null or length(p_event_key) not between 3 and 100 or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then raise exception 'invalid workflow event'; end if;
 if coalesce(p_payload->>'actor_employee_id','')<>v_actor::text then raise exception 'event actor must match the signed-in employee' using errcode='42501'; end if;
 for r in select * from workflow_rules where org_id=v_org and enabled and event_key=p_event_key loop
   insert into workflow_runs(org_id,rule_id,event_key,idempotency_key,payload)
   values(v_org,r.id,p_event_key,r.id::text||':'||p_idempotency_key,coalesce(p_payload,'{}'::jsonb))
   on conflict(org_id,idempotency_key) do nothing;
   if found then v_count:=v_count+1; end if;
 end loop;
 return v_count;
end $$;
revoke all on function enqueue_workflow_event(text,text,jsonb) from public,anon;
grant execute on function enqueue_workflow_event(text,text,jsonb) to authenticated;
