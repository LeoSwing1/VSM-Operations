-- Block 10: auditable workflow automation and SLA scheduling foundation.
create table if not exists workflow_rules (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 3 and 120), event_key text not null check(length(event_key) between 3 and 100),
 enabled boolean not null default true, conditions jsonb not null default '{}'::jsonb check(jsonb_typeof(conditions)='object'),
 actions jsonb not null default '[]'::jsonb check(jsonb_typeof(actions)='array' and jsonb_array_length(actions)<=20),
 cooldown_minutes integer not null default 0 check(cooldown_minutes between 0 and 10080),
 created_by uuid references employees(id), updated_by uuid references employees(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id)
);
create table if not exists workflow_runs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 rule_id uuid not null, event_key text not null, idempotency_key text not null,
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),
 attempts integer not null default 0 check(attempts between 0 and 10), next_attempt_at timestamptz not null default now(),
 locked_at timestamptz, started_at timestamptz, finished_at timestamptz, error_message text,
 created_at timestamptz not null default now(),
 foreign key(org_id,rule_id) references workflow_rules(org_id,id) on delete cascade,
 unique(org_id,idempotency_key)
);
create index workflow_runs_queue_idx on workflow_runs(next_attempt_at,created_at) where status in ('QUEUED','FAILED');
create index workflow_rules_event_idx on workflow_rules(org_id,event_key) where enabled;
alter table workflow_rules enable row level security;
alter table workflow_runs enable row level security;
create policy workflow_rules_read on workflow_rules for select to authenticated using(org_id=current_org_id() and (has_perm('settings.manage')));
create policy workflow_rules_manage on workflow_rules for all to authenticated using(org_id=current_org_id() and (has_perm('settings.manage'))) with check(org_id=current_org_id() and (has_perm('settings.manage')));
create policy workflow_runs_read on workflow_runs for select to authenticated using(org_id=current_org_id() and (has_perm('settings.manage')));
-- Runs are written by trusted server workers only; no client-side mutation policy.
revoke all on workflow_runs from anon,authenticated;
grant select on workflow_runs to authenticated;
revoke all on workflow_rules from anon;
create or replace function enqueue_workflow_event(p_event_key text,p_idempotency_key text,p_payload jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_org_id(); v_count integer:=0; r workflow_rules;
begin
 if v_org is null or not (has_perm('settings.manage')) then raise exception 'workflow management permission required' using errcode='42501'; end if;
 if p_event_key is null or length(p_event_key) not between 3 and 100 or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then raise exception 'invalid workflow event'; end if;
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
create or replace function claim_workflow_runs(p_limit integer default 25)
returns setof workflow_runs language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query with picked as (
  select id from workflow_runs where attempts<5 and next_attempt_at<=now()
   and (status in ('QUEUED','FAILED') or (status='RUNNING' and locked_at<now()-interval '15 minutes'))
  order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 ) update workflow_runs w set status='RUNNING',attempts=w.attempts+1,locked_at=now(),started_at=coalesce(w.started_at,now()),error_message=null
 from picked where w.id=picked.id returning w.*;
end $$;
revoke all on function claim_workflow_runs(integer) from public,anon,authenticated;
grant execute on function claim_workflow_runs(integer) to service_role;
create or replace function finish_workflow_run(p_id uuid,p_status text,p_result jsonb default '{}'::jsonb,p_error text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status not in ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') or jsonb_typeof(coalesce(p_result,'{}'::jsonb))<>'object' then raise exception 'invalid workflow result'; end if;
 update workflow_runs set status=p_status,result=coalesce(p_result,'{}'::jsonb),error_message=left(p_error,2000),finished_at=case when p_status in ('SUCCEEDED','PARTIAL','CANCELLED') or attempts>=5 then now() else null end,locked_at=null,
  next_attempt_at=case when p_status='FAILED' and attempts<5 then now()+make_interval(mins=>least(60,power(2,attempts)::integer*2)) else next_attempt_at end
 where id=p_id and status='RUNNING';
 if not found then raise exception 'workflow run is not currently running'; end if;
end $$;
revoke all on function finish_workflow_run(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function finish_workflow_run(uuid,text,jsonb,text) to service_role;
