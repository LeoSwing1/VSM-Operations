-- Block 06: hardened communication controls, moderation workflow and permission auditing.
-- All administrative mutations are permission-checked in PostgreSQL; client UI is not trusted.

-- New granular permissions. Existing role defaults are deliberately conservative.
insert into role_permissions(org_id,role,permission)
select o.id,r.role,'communication.moderate' from organizations o
cross join (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('HR_MANAGER'::app_role)) r(role)
on conflict do nothing;
insert into role_permissions(org_id,role,permission)
select o.id,r.role,'communication.channel_manage' from organizations o
cross join (values ('SUPER_ADMIN'::app_role),('ADMIN'::app_role),('HR_MANAGER'::app_role),('OPERATIONS_MANAGER'::app_role)) r(role)
on conflict do nothing;

-- Reports are visible only to designated moderators. Reporters can see their own reports.
create table chat_message_reports (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 channel_id uuid not null references chat_channels(id) on delete cascade,
 message_id uuid not null references chat_messages(id) on delete cascade,
 reporter_id uuid not null references employees(id) on delete cascade,
 reason text not null check(reason in ('HARASSMENT','SPAM','CONFIDENTIAL_DATA','INAPPROPRIATE','OTHER')),
 details text check(details is null or length(details)<=2000),
 status text not null default 'OPEN' check(status in ('OPEN','REVIEWING','DISMISSED','ACTIONED')),
 reviewed_by uuid references employees(id), reviewed_at timestamptz, resolution text,
 created_at timestamptz not null default now(),
 unique(message_id,reporter_id),
 check ((status in ('OPEN','REVIEWING') and reviewed_by is null and reviewed_at is null) or (status in ('DISMISSED','ACTIONED') and reviewed_by is not null and reviewed_at is not null))
);
create index chat_reports_queue_idx on chat_message_reports(org_id,status,created_at desc);
alter table chat_message_reports enable row level security;
create policy chat_reports_insert on chat_message_reports for insert to authenticated with check(
 org_id=current_org_id() and reporter_id=current_employee_id() and has_perm('communication.view') and
 exists(select 1 from chat_messages m where m.id=chat_message_reports.message_id and m.channel_id=chat_message_reports.channel_id and m.org_id=current_org_id() and m.author_id<>current_employee_id()) and is_chat_member(channel_id));
create policy chat_reports_read on chat_message_reports for select to authenticated using(
 org_id=current_org_id() and (reporter_id=current_employee_id() or has_perm('communication.moderate')));

create table chat_moderation_events (
 id bigint generated always as identity primary key, org_id uuid not null references organizations(id) on delete cascade,
 actor_id uuid references employees(id) on delete set null, action text not null,
 channel_id uuid references chat_channels(id) on delete set null, message_id uuid references chat_messages(id) on delete set null,
 target_employee_id uuid references employees(id) on delete set null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index chat_moderation_events_org_idx on chat_moderation_events(org_id,created_at desc);
alter table chat_moderation_events enable row level security;
create policy chat_moderation_events_read on chat_moderation_events for select to authenticated using(org_id=current_org_id() and has_perm('communication.moderate'));

-- Membership changes are RPC-only; clients cannot self-promote or add arbitrary people with table writes.
revoke insert,delete,update on chat_channel_members from authenticated;
grant update(last_read_at) on chat_channel_members to authenticated;
drop policy if exists chat_members_add on chat_channel_members;
drop policy if exists chat_members_public_join on chat_channel_members;
drop policy if exists chat_members_update_self on chat_channel_members;
create policy chat_members_public_join on chat_channel_members for insert to authenticated with check(
 has_perm('communication.view') and employee_id=current_employee_id() and member_role='MEMBER' and exists(
  select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id() and c.archived_at is null and
  (c.channel_type='PUBLIC' or (c.channel_type='DEPARTMENT' and c.department_id=(select e.department_id from employees e where e.id=current_employee_id())))));
drop policy if exists chat_members_read on chat_channel_members;
create policy chat_members_read on chat_channel_members for select to authenticated using(
 exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id()) and
 (has_perm('communication.view') or has_perm('communication.moderate')) and (employee_id=current_employee_id() or is_chat_member(channel_id) or has_perm('communication.channel_manage')));
create policy chat_members_read_receipt_update on chat_channel_members for update to authenticated
 using(has_perm('communication.view') and employee_id=current_employee_id() and is_chat_member(channel_id))
 with check(has_perm('communication.view') and employee_id=current_employee_id() and is_chat_member(channel_id));

create or replace function manage_chat_member(p_channel uuid,p_employee uuid,p_action text,p_role text default 'MEMBER') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v chat_channels; v_actor_role text; v_target_role text;
begin
 if p_action not in ('ADD','REMOVE','ROLE','LEAVE') or p_role not in ('OWNER','MODERATOR','MEMBER') or (p_action='ROLE' and p_role='OWNER') then raise exception 'invalid membership operation' using errcode='22023'; end if;
 select * into v from chat_channels where id=p_channel and org_id=current_org_id() and archived_at is null for update;
 if v.id is null then raise exception 'channel unavailable' using errcode='42501'; end if;
 if p_action='LEAVE' then
  if p_employee<>current_employee_id() or v.channel_type='DIRECT' then raise exception 'only self-leave is allowed; direct-message membership is immutable' using errcode='42501'; end if;
 elsif not (has_perm('communication.channel_manage') or (v.channel_type='PROJECT' and has_perm('projects.manage') and is_project_workspace_member(v.project_id)) or v.created_by=current_employee_id() or exists(select 1 from chat_channel_members m where m.channel_id=p_channel and m.employee_id=current_employee_id() and m.member_role in ('OWNER','MODERATOR'))) then
  raise exception 'channel owner or channel management permission required' using errcode='42501'; end if;
 if not exists(select 1 from employees e where e.id=p_employee and e.org_id=current_org_id() and e.status<>'EXITED') then raise exception 'employee is not active in this organisation' using errcode='23503'; end if;
 if p_action in ('ADD','ROLE') and v.channel_type='DEPARTMENT' and p_employee<>v.created_by and not exists(select 1 from employees e where e.id=p_employee and e.department_id=v.department_id) then raise exception 'department channels can include only department members' using errcode='42501'; end if;
 if p_action in ('ADD','ROLE') and v.channel_type='PROJECT' and not exists(select 1 from projects p where p.id=v.project_id and p.org_id=current_org_id() and (p.manager_id=p_employee or exists(select 1 from project_members pm where pm.project_id=p.id and pm.employee_id=p_employee))) then raise exception 'project channels can include only project roster members' using errcode='42501'; end if;
 if v.channel_type='DIRECT' then raise exception 'direct-message membership is immutable' using errcode='42501'; end if;
 if p_role='OWNER' and (p_action<>'ADD' or p_employee<>v.created_by) then raise exception 'only the channel creator may hold owner role' using errcode='42501'; end if;
 if p_employee=current_employee_id() and p_action='ROLE' then raise exception 'cannot change your own membership role' using errcode='42501'; end if;
 select member_role into v_target_role from chat_channel_members where channel_id=p_channel and employee_id=p_employee;
 if p_action='ADD' then
  insert into chat_channel_members(channel_id,employee_id,member_role) values(p_channel,p_employee,p_role) on conflict(channel_id,employee_id) do nothing;
 elsif p_action in ('REMOVE','LEAVE') then
  if v_target_role='OWNER' then raise exception 'channel owner cannot be removed; archive the channel instead' using errcode='42501'; end if;
  delete from chat_channel_members where channel_id=p_channel and employee_id=p_employee;
 elsif p_action='ROLE' then
  if v_target_role is null or v_target_role='OWNER' then raise exception 'membership unavailable or owner role is immutable' using errcode='42501'; end if;
  update chat_channel_members set member_role=p_role where channel_id=p_channel and employee_id=p_employee;
 end if;
 insert into chat_moderation_events(org_id,actor_id,action,channel_id,target_employee_id,details)
 values(current_org_id(),current_employee_id(),'MEMBER_'||p_action,p_channel,p_employee,jsonb_build_object('role',p_role));
end $$;
revoke all on function manage_chat_member(uuid,uuid,text,text) from public,anon;
grant execute on function manage_chat_member(uuid,uuid,text,text) to authenticated;

create or replace function moderate_chat_message(p_message uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v chat_messages;
begin
 if not has_perm('communication.moderate') then raise exception 'communication moderation permission required' using errcode='42501'; end if;
 if p_action not in ('HIDE','RESTORE') then raise exception 'invalid moderation action' using errcode='22023'; end if;
 select * into v from chat_messages where id=p_message and org_id=current_org_id() for update;
 if v.id is null then raise exception 'message unavailable' using errcode='42501'; end if;
 if p_action='HIDE' then update chat_messages set deleted_at=coalesce(deleted_at,now()) where id=p_message;
 else update chat_messages set deleted_at=null where id=p_message; end if;
 insert into chat_moderation_events(org_id,actor_id,action,channel_id,message_id,details)
 values(current_org_id(),current_employee_id(),'MESSAGE_'||p_action,v.channel_id,p_message,jsonb_build_object('reason',left(coalesce(p_reason,''),1000)));
 update chat_message_reports set status='ACTIONED',reviewed_by=current_employee_id(),reviewed_at=now(),resolution=left(coalesce(p_reason,'Message moderated'),2000)
 where message_id=p_message and status in ('OPEN','REVIEWING') and p_action='HIDE';
end $$;
revoke all on function moderate_chat_message(uuid,text,text) from public,anon;
grant execute on function moderate_chat_message(uuid,text,text) to authenticated;

create or replace function review_chat_report(p_report uuid,p_status text,p_resolution text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v chat_message_reports;
begin
 if not has_perm('communication.moderate') then raise exception 'communication moderation permission required' using errcode='42501'; end if;
 if p_status not in ('REVIEWING','DISMISSED') then raise exception 'invalid report status' using errcode='22023'; end if;
 select * into v from chat_message_reports where id=p_report and org_id=current_org_id() for update;
 if v.id is null or v.status in ('ACTIONED','DISMISSED') then raise exception 'report unavailable or already resolved'; end if;
 update chat_message_reports set status=p_status,reviewed_by=case when p_status='DISMISSED' then current_employee_id() else null end,
  reviewed_at=case when p_status='DISMISSED' then now() else null end,resolution=left(coalesce(p_resolution,''),2000) where id=p_report;
 insert into chat_moderation_events(org_id,actor_id,action,channel_id,message_id,details)
 values(current_org_id(),current_employee_id(),'REPORT_'||p_status,v.channel_id,v.message_id,jsonb_build_object('report_id',p_report,'resolution',left(coalesce(p_resolution,''),1000)));
end $$;
revoke all on function review_chat_report(uuid,text,text) from public,anon;
grant execute on function review_chat_report(uuid,text,text) to authenticated;

-- Channel archive is a controlled action and does not permit changing channel type/org identity.
create or replace function archive_chat_channel(p_channel uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v chat_channels;
begin
 select * into v from chat_channels where id=p_channel and org_id=current_org_id() for update;
 if v.id is null then raise exception 'channel unavailable'; end if;
 if not (has_perm('communication.channel_manage') or (v.channel_type='PROJECT' and has_perm('projects.manage') and is_project_workspace_member(v.project_id)) or v.created_by=current_employee_id() or exists(select 1 from chat_channel_members m where m.channel_id=p_channel and m.employee_id=current_employee_id() and m.member_role='OWNER')) then
  raise exception 'channel owner or channel management permission required' using errcode='42501'; end if;
 update chat_channels set archived_at=coalesce(archived_at,now()) where id=p_channel;
 insert into chat_moderation_events(org_id,actor_id,action,channel_id) values(current_org_id(),current_employee_id(),'CHANNEL_ARCHIVED',p_channel);
end $$;
revoke all on function archive_chat_channel(uuid) from public,anon;
grant execute on function archive_chat_channel(uuid) to authenticated;

-- Prevent direct table writes from bypassing message moderation and report workflow.
drop policy if exists chat_messages_edit_own on chat_messages;
create policy chat_messages_edit_own on chat_messages for update to authenticated using(
 org_id=current_org_id() and has_perm('communication.send') and author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id))
 with check(org_id=current_org_id() and has_perm('communication.send') and author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id));

-- Ensure the app's permission catalogue and database seed stay aligned.

-- Explicit grants: RLS still limits self-join/report reads to the policies above.
grant insert on chat_channel_members to authenticated;
grant select,insert on chat_message_reports to authenticated;
grant select on chat_moderation_events to authenticated;

create or replace function chat_report_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from chat_channels c join chat_messages m on m.channel_id=c.id
   join employees e on e.id=new.reporter_id where c.id=new.channel_id and m.id=new.message_id and
   c.org_id=new.org_id and m.org_id=new.org_id and e.org_id=new.org_id and m.author_id<>new.reporter_id) then
  raise exception 'report entities must belong to the same organisation and cannot target self' using errcode='23514';
 end if;
 return new;
end $$;
create trigger chat_report_org_guard before insert or update on chat_message_reports for each row execute function chat_report_org_guard();

-- Organisations created after this migration receive the new communication controls too.
create or replace function seed_chat_permissions(p_org uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into role_permissions(org_id,role,permission)
 select p_org,r.role,p.permission from
 (values ('ADMIN'::app_role),('HR_MANAGER'::app_role),('OPERATIONS_MANAGER'::app_role)) r(role)
 cross join (values ('communication.channel_manage'),('communication.moderate')) p(permission)
 on conflict do nothing;
$$;
revoke all on function seed_chat_permissions(uuid) from public,anon,authenticated;
create or replace function organizations_seed_chat_permissions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform seed_chat_permissions(new.id); return new; end $$;
create trigger organizations_seed_chat_permissions after insert on organizations for each row execute function organizations_seed_chat_permissions();

-- Moderation and channel administration are security-sensitive grants: Super Admin
-- may delegate them, but lower-level role managers cannot pass them on.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
 select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%'
   or p in ('roles.manage','audit.view','settings.manage','communication.moderate','communication.channel_manage')
$$;

-- Moderators can inspect reported/private conversations without joining them; they remain read-only.
drop policy if exists chat_channels_read on chat_channels;
create policy chat_channels_read on chat_channels for select to authenticated using(
 org_id=current_org_id() and (has_perm('communication.view') or has_perm('communication.moderate')) and archived_at is null and
 (created_by=current_employee_id() or channel_type='PUBLIC' or
  (channel_type='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or
  is_chat_member(id) or has_perm('communication.channel_manage') or (has_perm('communication.moderate') and exists(select 1 from chat_message_reports r where r.channel_id=chat_channels.id and r.org_id=current_org_id() and r.status in ('OPEN','REVIEWING','ACTIONED')))));
drop policy if exists chat_messages_read on chat_messages;
create policy chat_messages_read on chat_messages for select to authenticated using(
 org_id=current_org_id() and (has_perm('communication.view') or has_perm('communication.moderate')) and (is_chat_member(channel_id) or (has_perm('communication.moderate') and exists(select 1 from chat_message_reports r where r.channel_id=chat_messages.channel_id and r.org_id=current_org_id() and r.status in ('OPEN','REVIEWING','ACTIONED')))));
drop policy if exists chat_attachments_read on chat_attachments;
create policy chat_attachments_read on chat_attachments for select to authenticated using(
 org_id=current_org_id() and (has_perm('communication.view') or has_perm('communication.moderate')) and (is_chat_member(channel_id) or (has_perm('communication.moderate') and exists(select 1 from chat_message_reports r where r.channel_id=chat_attachments.channel_id and r.org_id=current_org_id() and r.status in ('OPEN','REVIEWING','ACTIONED')))));
drop policy if exists chat_files_read on storage.objects;
create policy chat_files_read on storage.objects for select to authenticated using(
 bucket_id='chat-files' and (has_perm('communication.view') or has_perm('communication.moderate')) and split_part(name,'/',1)=current_org_id()::text and
 (is_chat_member(split_part(name,'/',2)::uuid) or (has_perm('communication.moderate') and exists(select 1 from chat_attachments a join chat_message_reports r on r.message_id=a.message_id where a.storage_path=name and r.org_id=current_org_id() and r.status in ('OPEN','REVIEWING','ACTIONED')))));
-- Moderator read access to member roster is org-scoped and does not grant mutation rights.
drop policy if exists chat_members_read on chat_channel_members;
create policy chat_members_read on chat_channel_members for select to authenticated using(
 exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id()) and
 (has_perm('communication.view') or has_perm('communication.moderate')) and (employee_id=current_employee_id() or is_chat_member(channel_id) or has_perm('communication.channel_manage') or (has_perm('communication.moderate') and exists(select 1 from chat_message_reports r where r.channel_id=chat_channel_members.channel_id and r.org_id=current_org_id() and r.status in ('OPEN','REVIEWING','ACTIONED')))));
