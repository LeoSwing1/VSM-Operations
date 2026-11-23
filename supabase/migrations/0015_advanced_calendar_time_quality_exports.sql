-- Block 09: advanced calendar, evidence, timer sessions, provider connections and exports.
create table calendar_provider_connections (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 employee_id uuid not null references employees(id) on delete cascade,
 provider text not null check(provider in ('GOOGLE','MICROSOFT')), account_email text,
 access_token_enc text not null, refresh_token_enc text, expires_at timestamptz,
 scopes text[] not null default '{}', sync_enabled boolean not null default true,
 last_synced_at timestamptz, sync_cursor text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,employee_id,provider)
);
create table calendar_sync_links (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 employee_id uuid not null references employees(id) on delete cascade, event_id uuid not null references calendar_events(id) on delete cascade,
 provider text not null check(provider in ('GOOGLE','MICROSOFT')), external_event_id text not null,
 external_etag text, last_synced_at timestamptz not null default now(), sync_error text,
 unique(event_id,provider), unique(employee_id,provider,external_event_id)
);
create table calendar_email_deliveries (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 event_id uuid not null references calendar_events(id) on delete cascade, attendee_id uuid not null references employees(id) on delete cascade,
 email text not null, status text not null default 'QUEUED' check(status in ('QUEUED','SENT','FAILED')),
 provider_message_id text, attempts int not null default 0, last_error text, sent_at timestamptz,
 created_at timestamptz not null default now(), unique(event_id,attendee_id)
);
create table quality_evidence (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 assessment_id uuid not null references quality_assessments(id) on delete cascade,
 uploaded_by uuid not null references employees(id), storage_path text not null,
 file_name text not null check(length(file_name) between 1 and 240), mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 15728640), sha256 text,
 created_at timestamptz not null default now(), unique(assessment_id,storage_path)
);
alter table calendar_provider_connections enable row level security;
alter table calendar_sync_links enable row level security;
alter table calendar_email_deliveries enable row level security;
alter table quality_evidence enable row level security;
create policy calendar_connections_self on calendar_provider_connections for all to authenticated using(org_id=current_org_id() and employee_id=current_employee_id()) with check(org_id=current_org_id() and employee_id=current_employee_id());
create policy calendar_sync_links_self on calendar_sync_links for select to authenticated using(org_id=current_org_id() and employee_id=current_employee_id());
create policy calendar_email_deliveries_read on calendar_email_deliveries for select to authenticated using(org_id=current_org_id() and (attendee_id=current_employee_id() or has_perm('calendar.manage')));
create policy quality_evidence_read on quality_evidence for select to authenticated using(org_id=current_org_id() and exists(select 1 from quality_assessments a where a.id=assessment_id and (a.employee_id=current_employee_id() or a.reviewer_id=current_employee_id() or has_perm('quality.view_all') or has_perm('quality.view_team'))));
create policy quality_evidence_insert on quality_evidence for insert to authenticated with check(org_id=current_org_id() and uploaded_by=current_employee_id() and exists(select 1 from quality_assessments a where a.id=assessment_id and a.reviewer_id=current_employee_id()));
create trigger workforce_org_guard_provider_connections before insert or update on calendar_provider_connections for each row execute function workforce_org_guard();
create trigger workforce_org_guard_sync_links before insert or update on calendar_sync_links for each row execute function workforce_org_guard();
create trigger workforce_org_guard_email_deliveries before insert or update on calendar_email_deliveries for each row execute function workforce_org_guard();
create trigger workforce_org_guard_quality_evidence before insert or update on quality_evidence for each row execute function workforce_org_guard();
create index calendar_provider_connections_lookup on calendar_provider_connections(org_id,employee_id,provider);
create index quality_evidence_assessment_idx on quality_evidence(assessment_id,created_at);
-- Private evidence bucket; object paths are org/assessment/uuid-filename.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quality-evidence','quality-evidence',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=15728640,allowed_mime_types=excluded.allowed_mime_types;
create policy quality_evidence_storage_read on storage.objects for select to authenticated using(bucket_id='quality-evidence' and (storage.foldername(name))[1]=current_org_id()::text and exists(select 1 from quality_assessments a where a.id=((storage.foldername(name))[2])::uuid and (a.employee_id=current_employee_id() or a.reviewer_id=current_employee_id() or has_perm('quality.view_all') or has_perm('quality.view_team'))));
create policy quality_evidence_storage_insert on storage.objects for insert to authenticated with check(bucket_id='quality-evidence' and (storage.foldername(name))[1]=current_org_id()::text and exists(select 1 from quality_assessments a where a.id=((storage.foldername(name))[2])::uuid and a.reviewer_id=current_employee_id()));
create policy quality_evidence_storage_delete on storage.objects for delete to authenticated using(bucket_id='quality-evidence' and (storage.foldername(name))[1]=current_org_id()::text and exists(select 1 from quality_assessments a where a.id=((storage.foldername(name))[2])::uuid and a.reviewer_id=current_employee_id()));
-- Extend the timer workflow without changing the approved timesheet contract.
create index task_time_active_timer_idx on task_time_entries(org_id,employee_id,started_at) where started_at is not null and ended_at is null;

alter table calendar_events add column recurrence_series_id uuid references calendar_events(id) on delete cascade;
alter table calendar_events add column recurrence_index integer not null default 0 check(recurrence_index>=0);
create unique index calendar_recurrence_occurrence_unique on calendar_events(recurrence_series_id,recurrence_index) where recurrence_series_id is not null;
create unique index task_time_one_active_timer_per_employee on task_time_entries(org_id,employee_id) where started_at is not null and ended_at is null;

-- Atomic recurring series creation. Supported rules are deliberately bounded and explicit.
create or replace function create_calendar_event(
 p_title text,p_description text,p_event_type text,p_visibility text,p_starts_at timestamptz,p_ends_at timestamptz,
 p_location text,p_meeting_url text,p_department uuid,p_team uuid,p_attendees uuid[],p_recurrence text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_org_id(); v_me uuid:=current_employee_id(); v_master uuid; v_event uuid; v_count int:=1; v_freq text; v_start timestamptz; v_end timestamptz; i int;
begin
 if v_me is null or not (has_perm('calendar.create') or has_perm('calendar.manage')) then raise exception 'calendar creation permission required' using errcode='42501'; end if;
 if length(trim(coalesce(p_title,'')))<2 or length(p_title)>200 or length(coalesce(p_description,''))>3000 or length(coalesce(p_location,''))>200 or coalesce(array_length(p_attendees,1),0)>100 or p_ends_at<=p_starts_at then raise exception 'invalid calendar event details'; end if;
 if p_visibility='DEPARTMENT' and p_department is null then raise exception 'department required for department event'; end if;
 if p_visibility='TEAM' and p_team is null then raise exception 'team required for team event'; end if;
 if exists(select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) a(id) left join employees e on e.id=a.id and e.org_id=v_org and e.status<>'EXITED' where e.id is null) then raise exception 'all invitees must be active employees in this organisation' using errcode='23514'; end if;
 if nullif(p_recurrence,'') is not null then
   if p_recurrence !~ '^(DAILY|WEEKLY|MONTHLY):([1-9]|[1-4][0-9]|5[0-2])$' then raise exception 'unsupported recurrence rule; choose a supported bounded series'; end if;
   v_freq:=split_part(p_recurrence,':',1); v_count:=split_part(p_recurrence,':',2)::int;
 end if;
 for i in 0..v_count-1 loop
   v_start:=case v_freq when 'DAILY' then p_starts_at+(i||' days')::interval when 'WEEKLY' then p_starts_at+(i||' weeks')::interval when 'MONTHLY' then p_starts_at+(i||' months')::interval else p_starts_at end;
   v_end:=v_start+(p_ends_at-p_starts_at);
   insert into calendar_events(org_id,title,description,event_type,visibility,starts_at,ends_at,location,meeting_url,department_id,team_id,organizer_id,recurrence_rule,recurrence_index)
   values(v_org,trim(p_title),nullif(p_description,''),p_event_type,p_visibility,v_start,v_end,nullif(p_location,''),nullif(p_meeting_url,''),p_department,p_team,v_me,case when v_count>1 then p_recurrence else null end,i)
   returning id into v_event;
   if i=0 then v_master:=v_event; update calendar_events set recurrence_series_id=v_master where id=v_master;
   else update calendar_events set recurrence_series_id=v_master where id=v_event; end if;
   insert into calendar_attendees(event_id,org_id,employee_id,response)
   select v_event,v_org,a.employee_id,case when a.employee_id=v_me then 'ACCEPTED' else 'NEEDS_ACTION' end
   from (select distinct unnest(array_append(coalesce(p_attendees,'{}'::uuid[]),v_me)) as employee_id) a;
   insert into calendar_email_deliveries(org_id,event_id,attendee_id,email)
   select v_org,v_event,e.id,e.official_email from employees e where e.org_id=v_org and e.id=any(coalesce(p_attendees,'{}'::uuid[])) and e.id<>v_me and coalesce(e.official_email,'')<>'' on conflict(event_id,attendee_id) do nothing;
 end loop;
 perform _audit(v_org,'calendar.event.created','calendar_event',v_master::text,jsonb_build_object('event_type',p_event_type,'visibility',p_visibility,'attendee_count',coalesce(array_length(p_attendees,1),0),'occurrences',v_count));
 return v_master;
end $$;
revoke all on function create_calendar_event(text,text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,uuid[],text) from public,anon;
grant execute on function create_calendar_event(text,text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,uuid[],text) to authenticated;
alter table calendar_events drop constraint if exists calendar_events_recurrence_series_id_fkey;
create trigger calendar_events_touch before update on calendar_events for each row execute function touch_updated_at();

-- Queue claiming is concurrency-safe and retries use bounded exponential backoff.
alter table calendar_email_deliveries drop constraint if exists calendar_email_deliveries_status_check;
alter table calendar_email_deliveries add constraint calendar_email_deliveries_status_check check(status in ('QUEUED','SENDING','SENT','FAILED'));
alter table calendar_email_deliveries add column if not exists next_attempt_at timestamptz not null default now();
alter table calendar_email_deliveries add column if not exists locked_at timestamptz;
create or replace function claim_calendar_email_deliveries(p_limit integer default 50)
returns setof calendar_email_deliveries language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query with picked as (
  select id from calendar_email_deliveries
  where attempts<5 and next_attempt_at<=now() and (status in ('QUEUED','FAILED') or (status='SENDING' and locked_at<now()-interval '10 minutes'))
  order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
 ) update calendar_email_deliveries d set status='SENDING',locked_at=now(),attempts=d.attempts+1 from picked where d.id=picked.id returning d.*;
end $$;
revoke all on function claim_calendar_email_deliveries(integer) from public,anon,authenticated;
grant execute on function claim_calendar_email_deliveries(integer) to service_role;

create or replace function decide_task_time_entry(p_id uuid,p_approve boolean) returns task_time_entries
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row task_time_entries; v_me uuid:=current_employee_id();
begin
 select * into v_row from task_time_entries where id=p_id and org_id=current_org_id() for update;
 if v_row.id is null then raise exception 'time entry not found' using errcode='P0002'; end if;
 if v_row.status<>'PENDING' then raise exception 'time entry already decided' using errcode='P0001'; end if;
 if v_row.started_at is not null and v_row.ended_at is null then raise exception 'cannot approve an active timer' using errcode='P0001'; end if;
 if v_row.employee_id=v_me then raise exception 'cannot approve your own time' using errcode='42501'; end if;
 if not (has_perm('time.approve_all') or (has_perm('time.approve_team') and is_in_my_team(v_row.employee_id))) then raise exception 'not authorized' using errcode='42501'; end if;
 update task_time_entries set status=case when p_approve then 'APPROVED'::request_status else 'REJECTED'::request_status end,
  approved_by=case when p_approve then v_me else null end, approved_at=case when p_approve then now() else null end
 where id=p_id returning * into v_row;
 perform _audit(v_row.org_id,case when p_approve then 'time.approved' else 'time.rejected' end,'task_time_entry',v_row.id::text,jsonb_build_object('employee_id',v_row.employee_id,'minutes',v_row.minutes));
 return v_row;
end $$;
revoke all on function decide_task_time_entry(uuid,boolean) from public,anon;
grant execute on function decide_task_time_entry(uuid,boolean) to authenticated;
alter table calendar_provider_connections add column if not exists last_error text;
alter table quality_evidence add constraint quality_evidence_sha256_format check(sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
create or replace function quality_evidence_path_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid; v_reviewer uuid;
begin
 select org_id,reviewer_id into v_org,v_reviewer from quality_assessments where id=new.assessment_id;
 if v_org is null or v_org<>new.org_id or v_reviewer<>new.uploaded_by or new.storage_path not like new.org_id::text||'/'||new.assessment_id::text||'/%' then raise exception 'invalid quality evidence relationship or storage path' using errcode='42501'; end if;
 return new;
end $$;
create trigger quality_evidence_path_guard before insert or update on quality_evidence for each row execute function quality_evidence_path_guard();
revoke all on function quality_evidence_path_guard() from public,anon,authenticated;
-- Never expose encrypted provider credentials to browser clients, even as ciphertext.
revoke all on table calendar_provider_connections from anon,authenticated;
grant select(id,org_id,employee_id,provider,account_email,expires_at,scopes,sync_enabled,last_synced_at,last_error,created_at,updated_at) on table calendar_provider_connections to authenticated;
