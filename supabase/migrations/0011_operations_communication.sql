-- Block 05: Projects & Operations + internal communication workspace.
-- All objects are tenant-scoped. Messages are append-only; time approvals are RPC-only.

create table project_milestones (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade, title text not null check(length(trim(title)) between 2 and 180),
  description text, owner_id uuid references employees(id) on delete set null, due_date date,
  status text not null default 'PENDING' check(status in ('PENDING','IN_PROGRESS','COMPLETED','AT_RISK')),
  sort_order int not null default 0, created_by uuid not null references employees(id), created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index project_milestones_project_idx on project_milestones(project_id,sort_order,due_date);

create table project_updates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade, author_id uuid not null references employees(id),
  update_type text not null default 'UPDATE' check(update_type in ('UPDATE','RISK','DECISION','MILESTONE')),
  body text not null check(length(trim(body)) between 2 and 5000), created_at timestamptz not null default now()
);
create index project_updates_feed_idx on project_updates(project_id,created_at desc);

create table project_time_entries (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade, task_id uuid references tasks(id) on delete set null,
  employee_id uuid not null references employees(id), work_date date not null, hours numeric(6,2) not null check(hours > 0 and hours <= 24),
  notes text not null check(length(trim(notes)) between 2 and 1000), billable boolean not null default true,
  status text not null default 'SUBMITTED' check(status in ('SUBMITTED','APPROVED','REJECTED')),
  decided_by uuid references employees(id), decided_at timestamptz, decision_note text, created_at timestamptz not null default now(),
  check ((status='SUBMITTED' and decided_by is null and decided_at is null) or (status<>'SUBMITTED' and decided_by is not null and decided_at is not null))
);
create index project_time_entries_project_idx on project_time_entries(project_id,work_date desc);
create index project_time_entries_employee_idx on project_time_entries(employee_id,work_date desc);

create or replace function is_project_workspace_member(p_project uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from projects p where p.id=p_project and p.org_id=current_org_id()
   and (p.manager_id=current_employee_id() or exists(select 1 from project_members pm where pm.project_id=p.id and pm.employee_id=current_employee_id())))
$$;
revoke all on function is_project_workspace_member(uuid) from public,anon;
grant execute on function is_project_workspace_member(uuid) to authenticated;

alter table project_milestones enable row level security;
alter table project_updates enable row level security;
alter table project_time_entries enable row level security;
create policy milestone_read on project_milestones for select to authenticated using(org_id=current_org_id() and (has_perm('projects.view_all') or is_project_workspace_member(project_id)));
create policy milestone_write on project_milestones for all to authenticated using(org_id=current_org_id() and (has_perm('projects.manage') or exists(select 1 from projects p where p.id=project_id and p.manager_id=current_employee_id()))) with check(org_id=current_org_id() and (has_perm('projects.manage') or exists(select 1 from projects p where p.id=project_id and p.manager_id=current_employee_id())));
create policy project_update_read on project_updates for select to authenticated using(org_id=current_org_id() and (has_perm('projects.view_all') or is_project_workspace_member(project_id)));
create policy project_update_insert on project_updates for insert to authenticated with check(org_id=current_org_id() and author_id=current_employee_id() and is_project_workspace_member(project_id));
create policy project_time_read on project_time_entries for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('projects.view_all') or has_perm('projects.manage') or is_project_workspace_member(project_id)));
create policy project_time_insert on project_time_entries for insert to authenticated with check(org_id=current_org_id() and employee_id=current_employee_id() and status='SUBMITTED' and decided_by is null and is_project_workspace_member(project_id));

create or replace function decide_project_time_entry(p_entry uuid,p_approve boolean,p_note text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v project_time_entries;
begin
 if not (has_perm('projects.manage') or has_perm('projects.time_approve')) then raise exception 'project time approval permission required' using errcode='42501'; end if;
 select * into v from project_time_entries where id=p_entry and org_id=current_org_id() for update;
 if v.id is null or v.status<>'SUBMITTED' then raise exception 'time entry unavailable or already decided'; end if;
 if v.employee_id=current_employee_id() then raise exception 'cannot approve your own time entry' using errcode='42501'; end if;
 update project_time_entries set status=case when p_approve then 'APPROVED' else 'REJECTED' end,
  decided_by=current_employee_id(),decided_at=now(),decision_note=left(p_note,1000) where id=p_entry;
 perform _audit(current_org_id(),case when p_approve then 'project.time.approved' else 'project.time.rejected' end,'project_time_entry',p_entry::text,jsonb_build_object('hours',v.hours,'project_id',v.project_id));
end $$;
revoke all on function decide_project_time_entry(uuid,boolean,text) from public,anon;
grant execute on function decide_project_time_entry(uuid,boolean,text) to authenticated;

-- Communication: channels include org-wide, department, project, private group and direct conversations.
create table chat_channels (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100), description text,
 channel_type text not null check(channel_type in ('PUBLIC','DEPARTMENT','PROJECT','GROUP','DIRECT')),
 department_id uuid references departments(id) on delete cascade, project_id uuid references projects(id) on delete cascade,
 direct_key text, created_by uuid not null references employees(id), archived_at timestamptz,
 created_at timestamptz not null default now(),
 check ((channel_type='DEPARTMENT')=(department_id is not null)),
 check ((channel_type='PROJECT')=(project_id is not null)),
 check ((channel_type='DIRECT')=(direct_key is not null)),
 unique(org_id,direct_key)
);
create index chat_channels_org_type_idx on chat_channels(org_id,channel_type,created_at desc);

create table chat_channel_members (
 channel_id uuid not null references chat_channels(id) on delete cascade,
 employee_id uuid not null references employees(id) on delete cascade,
 member_role text not null default 'MEMBER' check(member_role in ('OWNER','MODERATOR','MEMBER')),
 joined_at timestamptz not null default now(), last_read_at timestamptz,
 primary key(channel_id,employee_id)
);
create index chat_members_employee_idx on chat_channel_members(employee_id,channel_id);

create table chat_messages (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 channel_id uuid not null references chat_channels(id) on delete cascade,
 author_id uuid not null references employees(id), body text not null check(length(trim(body)) between 1 and 10000),
 parent_message_id uuid references chat_messages(id) on delete set null,
 edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now()
);
create index chat_messages_channel_idx on chat_messages(channel_id,created_at desc);

create table chat_reactions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 message_id uuid not null references chat_messages(id) on delete cascade, employee_id uuid not null references employees(id) on delete cascade,
 reaction text not null check(reaction in ('👍','❤️','😂','🎉','👀','🙏')), created_at timestamptz not null default now(), unique(message_id,employee_id,reaction)
);
create index chat_reactions_message_idx on chat_reactions(message_id);

create or replace function is_chat_member(p_channel uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from chat_channel_members m join chat_channels c on c.id=m.channel_id
  where m.channel_id=p_channel and m.employee_id=current_employee_id() and c.org_id=current_org_id() and c.archived_at is null)
$$;
revoke all on function is_chat_member(uuid) from public,anon;
grant execute on function is_chat_member(uuid) to authenticated;

alter table chat_channels enable row level security;
alter table chat_channel_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_reactions enable row level security;
create policy chat_channels_read on chat_channels for select to authenticated using(org_id=current_org_id() and archived_at is null and
 (channel_type='PUBLIC' or (channel_type='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or is_chat_member(id)));
create policy chat_channels_create on chat_channels for insert to authenticated with check(org_id=current_org_id() and created_by=current_employee_id() and (has_perm('communication.manage') or channel_type in ('GROUP','DIRECT')));
create policy chat_channels_manage on chat_channels for update to authenticated using(org_id=current_org_id() and (created_by=current_employee_id() or has_perm('communication.manage'))) with check(org_id=current_org_id());
create policy chat_members_read on chat_channel_members for select to authenticated using(is_chat_member(channel_id) or employee_id=current_employee_id() or has_perm('communication.manage'));
create policy chat_members_add on chat_channel_members for insert to authenticated with check(employee_id=current_employee_id() or exists(select 1 from chat_channels c where c.id=channel_id and c.created_by=current_employee_id()) or has_perm('communication.manage'));
create policy chat_members_update_self on chat_channel_members for update to authenticated using(employee_id=current_employee_id()) with check(employee_id=current_employee_id());
create policy chat_messages_read on chat_messages for select to authenticated using(org_id=current_org_id() and is_chat_member(channel_id));
create policy chat_messages_insert on chat_messages for insert to authenticated with check(org_id=current_org_id() and author_id=current_employee_id() and is_chat_member(channel_id) and deleted_at is null and edited_at is null);
create policy chat_messages_edit_own on chat_messages for update to authenticated using(author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id)) with check(author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id));
create policy chat_reactions_read on chat_reactions for select to authenticated using(org_id=current_org_id() and exists(select 1 from chat_messages m where m.id=message_id and is_chat_member(m.channel_id)));
create policy chat_reactions_add on chat_reactions for insert to authenticated with check(org_id=current_org_id() and employee_id=current_employee_id() and exists(select 1 from chat_messages m where m.id=message_id and is_chat_member(m.channel_id)));
create policy chat_reactions_remove on chat_reactions for delete to authenticated using(employee_id=current_employee_id() and org_id=current_org_id());

-- A private bucket: object path is org/channel/employee/filename. Membership is checked for reads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('chat-files','chat-files',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp','text/plain','application/zip'])
 on conflict(id) do update set public=false,file_size_limit=15728640,allowed_mime_types=excluded.allowed_mime_types;
create policy chat_files_read on storage.objects for select to authenticated using(bucket_id='chat-files' and split_part(name,'/',1)=current_org_id()::text and is_chat_member(split_part(name,'/',2)::uuid));
create policy chat_files_insert on storage.objects for insert to authenticated with check(bucket_id='chat-files' and split_part(name,'/',1)=current_org_id()::text and split_part(name,'/',3)=current_employee_id()::text and is_chat_member(split_part(name,'/',2)::uuid));
create policy chat_files_delete on storage.objects for delete to authenticated using(bucket_id='chat-files' and split_part(name,'/',1)=current_org_id()::text and split_part(name,'/',3)=current_employee_id()::text);

-- Permission catalogue additions; existing organisations receive them too.
insert into role_permissions(org_id,role,permission)
select o.id, r.role, p.permission from organizations o
cross join (values ('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('PROJECT_MANAGER'::app_role),('DEPARTMENT_MANAGER'::app_role),('TEAM_LEAD'::app_role)) r(role)
cross join (values ('communication.view'),('communication.send'),('projects.time_log'),('projects.time_approve'),('projects.updates')) p(permission)
on conflict do nothing;
insert into role_permissions(org_id,role,permission)
select o.id, r.role, p.permission from organizations o
cross join (values ('EMPLOYEE'::app_role),('INTERN'::app_role),('SALES_EXECUTIVE'::app_role)) r(role)
cross join (values ('communication.view'),('communication.send'),('projects.time_log'),('projects.updates')) p(permission)
on conflict do nothing;
insert into role_permissions(org_id,role,permission)
select o.id, 'HR_MANAGER'::app_role, p.permission from organizations o
cross join (values ('communication.view'),('communication.send'),('projects.updates')) p(permission)
on conflict do nothing;

-- Keep message records in the Supabase Realtime publication for clients that enable realtime auth.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
   select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
   alter publication supabase_realtime add table public.chat_messages;
 end if;
end $$;

-- Message attachments are private and visible only to channel members.
create table chat_attachments (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 channel_id uuid not null references chat_channels(id) on delete cascade, message_id uuid not null references chat_messages(id) on delete cascade,
 uploaded_by uuid not null references employees(id), storage_path text not null unique, file_name text not null,
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp','text/plain','application/zip')),
 file_size bigint not null check(file_size between 1 and 15728640), created_at timestamptz not null default now()
);
alter table chat_attachments enable row level security;
create policy chat_attachments_read on chat_attachments for select to authenticated using(org_id=current_org_id() and is_chat_member(channel_id));
create policy chat_attachments_insert on chat_attachments for insert to authenticated with check(org_id=current_org_id() and uploaded_by=current_employee_id() and is_chat_member(channel_id) and exists(select 1 from chat_messages m where m.id=chat_attachments.message_id and m.channel_id=chat_attachments.channel_id and m.author_id=current_employee_id()));
create policy chat_members_public_join on chat_channel_members for insert to authenticated with check(employee_id=current_employee_id() and exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id() and c.channel_type in ('PUBLIC','DEPARTMENT')));
drop policy chat_members_public_join on chat_channel_members;
create policy chat_members_public_join on chat_channel_members for insert to authenticated with check(
 employee_id=current_employee_id() and exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id() and
  (c.channel_type='PUBLIC' or (c.channel_type='DEPARTMENT' and c.department_id=(select e.department_id from employees e where e.id=current_employee_id())))));

create or replace function open_direct_conversation(p_employee uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_channel uuid; v_other employees;
begin
 if p_employee=current_employee_id() then raise exception 'cannot open a direct conversation with yourself'; end if;
 select * into v_other from employees where id=p_employee and org_id=current_org_id() and status<>'EXITED';
 if v_other.id is null then raise exception 'employee not found in this organisation'; end if;
 v_key:=least(current_employee_id()::text,p_employee::text)||':'||greatest(current_employee_id()::text,p_employee::text);
 insert into chat_channels(org_id,name,channel_type,direct_key,created_by)
 values(current_org_id(),v_other.full_name,'DIRECT',v_key,current_employee_id())
 on conflict(org_id,direct_key) do update set direct_key=excluded.direct_key returning id into v_channel;
 insert into chat_channel_members(channel_id,employee_id,member_role) values(v_channel,current_employee_id(),'OWNER'),(v_channel,p_employee,'MEMBER') on conflict do nothing;
 return v_channel;
end $$;
revoke all on function open_direct_conversation(uuid) from public,anon;
grant execute on function open_direct_conversation(uuid) to authenticated;

-- Company announcements (separate from chat so important notices remain discoverable).
create table company_announcements (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 title text not null check(length(trim(title)) between 3 and 180), body text not null check(length(trim(body)) between 3 and 10000),
 audience text not null default 'ALL' check(audience in ('ALL','DEPARTMENT','PROJECT')),
 department_id uuid references departments(id) on delete cascade, project_id uuid references projects(id) on delete cascade,
 pinned boolean not null default false, published_at timestamptz not null default now(), expires_at timestamptz,
 created_by uuid not null references employees(id), created_at timestamptz not null default now(),
 check ((audience='DEPARTMENT')=(department_id is not null)), check ((audience='PROJECT')=(project_id is not null))
);
create index announcements_feed_idx on company_announcements(org_id,pinned desc,published_at desc);
alter table company_announcements enable row level security;
create policy announcements_read on company_announcements for select to authenticated using(org_id=current_org_id() and published_at<=now() and (expires_at is null or expires_at>now()) and (audience='ALL' or (audience='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or (audience='PROJECT' and is_project_workspace_member(project_id))));
create policy announcements_write on company_announcements for all to authenticated using(org_id=current_org_id() and has_perm('communication.manage')) with check(org_id=current_org_id() and created_by=current_employee_id() and has_perm('communication.manage'));

-- Project managers can create a project channel and seed membership from the workspace roster.
drop policy chat_channels_create on chat_channels;
create policy chat_channels_create on chat_channels for insert to authenticated with check(org_id=current_org_id() and created_by=current_employee_id() and
 (has_perm('communication.manage') or channel_type in ('GROUP','DIRECT') or (channel_type='PROJECT' and has_perm('projects.manage'))));
insert into role_permissions(org_id,role,permission)
select o.id,r.role,'projects.workspace_view' from organizations o
cross join (values ('EMPLOYEE'::app_role),('INTERN'::app_role),('SALES_EXECUTIVE'::app_role),('TEAM_LEAD'::app_role),('DEPARTMENT_MANAGER'::app_role),('PROJECT_MANAGER'::app_role),('OPERATIONS_MANAGER'::app_role),('ADMIN'::app_role)) r(role)
on conflict do nothing;
drop policy chat_channels_read on chat_channels;
create policy chat_channels_read on chat_channels for select to authenticated using(org_id=current_org_id() and archived_at is null and
 (created_by=current_employee_id() or channel_type='PUBLIC' or (channel_type='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or is_chat_member(id)));
insert into role_permissions(org_id,role,permission)
select o.id,r.role,'communication.manage' from organizations o
cross join (values ('ADMIN'::app_role),('OPERATIONS_MANAGER'::app_role),('HR_MANAGER'::app_role)) r(role)
on conflict do nothing;
-- Project managers may maintain membership of the matching project channel.
drop policy chat_members_add on chat_channel_members;
create policy chat_members_add on chat_channel_members for insert to authenticated with check(
 employee_id=current_employee_id() or has_perm('communication.manage') or
 exists(select 1 from chat_channels c where c.id=channel_id and c.created_by=current_employee_id()) or
 (has_perm('projects.manage') and exists(select 1 from chat_channels c where c.id=channel_id and c.channel_type='PROJECT' and has_perm('projects.manage'))));

create or replace function open_direct_conversation(p_employee uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_channel uuid; v_other employees;
begin
 if p_employee=current_employee_id() then raise exception 'cannot open a direct conversation with yourself'; end if;
 select * into v_other from employees where id=p_employee and org_id=current_org_id() and status<>'EXITED';
 if v_other.id is null then raise exception 'employee not found in this organisation'; end if;
 v_key:=least(current_employee_id()::text,p_employee::text)||':'||greatest(current_employee_id()::text,p_employee::text);
 insert into chat_channels(org_id,name,channel_type,direct_key,created_by)
 values(current_org_id(),'Direct message','DIRECT',v_key,current_employee_id())
 on conflict(org_id,direct_key) do update set direct_key=excluded.direct_key returning id into v_channel;
 insert into chat_channel_members(channel_id,employee_id,member_role) values(v_channel,current_employee_id(),'OWNER'),(v_channel,p_employee,'MEMBER') on conflict do nothing;
 return v_channel;
end $$;

-- Tighten channel membership: only public/department self-join, channel creator,
-- communication managers, or project managers managing a project room can add members.
drop policy chat_members_add on chat_channel_members;
create policy chat_members_add on chat_channel_members for insert to authenticated with check(
 has_perm('communication.manage') or
 exists(select 1 from chat_channels c where c.id=channel_id and c.created_by=current_employee_id()) or
 (has_perm('projects.manage') and exists(select 1 from chat_channels c where c.id=channel_id and c.channel_type='PROJECT')));
drop policy chat_channels_create on chat_channels;
create policy chat_channels_create on chat_channels for insert to authenticated with check(org_id=current_org_id() and created_by=current_employee_id() and
 (has_perm('communication.manage') or channel_type='GROUP' or (channel_type='PROJECT' and has_perm('projects.manage'))));

create or replace function operations_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='project_milestones' then
  if not exists(select 1 from projects p where p.id=new.project_id and p.org_id=new.org_id) then raise exception 'milestone project organisation mismatch' using errcode='23514'; end if;
  if new.owner_id is not null and not exists(select 1 from employees e where e.id=new.owner_id and e.org_id=new.org_id) then raise exception 'milestone owner organisation mismatch' using errcode='23514'; end if;
  if not exists(select 1 from employees e where e.id=new.created_by and e.org_id=new.org_id) then raise exception 'milestone creator organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='project_updates' then
  if not exists(select 1 from projects p where p.id=new.project_id and p.org_id=new.org_id) or not exists(select 1 from employees e where e.id=new.author_id and e.org_id=new.org_id) then raise exception 'project update organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='project_time_entries' then
  if not exists(select 1 from projects p where p.id=new.project_id and p.org_id=new.org_id) or not exists(select 1 from employees e where e.id=new.employee_id and e.org_id=new.org_id) then raise exception 'time entry organisation mismatch' using errcode='23514'; end if;
  if new.task_id is not null and not exists(select 1 from tasks t where t.id=new.task_id and t.org_id=new.org_id and t.project_id=new.project_id) then raise exception 'time entry task must belong to the same project' using errcode='23514'; end if;
  if new.decided_by is not null and not exists(select 1 from employees e where e.id=new.decided_by and e.org_id=new.org_id) then raise exception 'time approver organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='chat_channels' then
  if not exists(select 1 from employees e where e.id=new.created_by and e.org_id=new.org_id) then raise exception 'channel creator organisation mismatch' using errcode='23514'; end if;
  if new.project_id is not null and not exists(select 1 from projects p where p.id=new.project_id and p.org_id=new.org_id) then raise exception 'channel project organisation mismatch' using errcode='23514'; end if;
  if new.department_id is not null and not exists(select 1 from departments d where d.id=new.department_id and d.org_id=new.org_id) then raise exception 'channel department organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='chat_channel_members' then
  if not exists(select 1 from chat_channels c join employees e on e.id=new.employee_id where c.id=new.channel_id and c.org_id=e.org_id) then raise exception 'channel member organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='chat_messages' then
  if not exists(select 1 from chat_channels c where c.id=new.channel_id and c.org_id=new.org_id) or not exists(select 1 from employees e where e.id=new.author_id and e.org_id=new.org_id) then raise exception 'message organisation mismatch' using errcode='23514'; end if;
  if new.parent_message_id is not null and not exists(select 1 from chat_messages m where m.id=new.parent_message_id and m.channel_id=new.channel_id) then raise exception 'reply parent must belong to the same channel' using errcode='23514'; end if;
 elsif tg_table_name='chat_attachments' then
  if not exists(select 1 from chat_messages m where m.id=new.message_id and m.channel_id=new.channel_id and m.org_id=new.org_id and m.author_id=new.uploaded_by) then raise exception 'attachment message mismatch' using errcode='23514'; end if;
  if new.storage_path not like new.org_id::text||'/'||new.channel_id::text||'/'||new.uploaded_by::text||'/%' or not exists(select 1 from storage.objects o where o.bucket_id='chat-files' and o.name=new.storage_path) then raise exception 'attachment must reference the uploader private object' using errcode='23514'; end if;
 elsif tg_table_name='chat_reactions' then
  if not exists(select 1 from chat_messages m where m.id=new.message_id and m.org_id=new.org_id) or not exists(select 1 from employees e where e.id=new.employee_id and e.org_id=new.org_id) then raise exception 'reaction organisation mismatch' using errcode='23514'; end if;
 elsif tg_table_name='company_announcements' then
  if not exists(select 1 from employees e where e.id=new.created_by and e.org_id=new.org_id) then raise exception 'announcement author organisation mismatch' using errcode='23514'; end if;
  if new.department_id is not null and not exists(select 1 from departments d where d.id=new.department_id and d.org_id=new.org_id) then raise exception 'announcement department mismatch' using errcode='23514'; end if;
  if new.project_id is not null and not exists(select 1 from projects p where p.id=new.project_id and p.org_id=new.org_id) then raise exception 'announcement project mismatch' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger project_milestones_org_guard before insert or update on project_milestones for each row execute function operations_org_guard();
create trigger project_updates_org_guard before insert or update on project_updates for each row execute function operations_org_guard();
create trigger project_time_org_guard before insert or update on project_time_entries for each row execute function operations_org_guard();
create trigger chat_channels_org_guard before insert or update on chat_channels for each row execute function operations_org_guard();
create trigger chat_members_org_guard before insert or update on chat_channel_members for each row execute function operations_org_guard();
create trigger chat_messages_org_guard before insert or update on chat_messages for each row execute function operations_org_guard();
create trigger chat_attachments_org_guard before insert or update on chat_attachments for each row execute function operations_org_guard();
create trigger chat_reactions_org_guard before insert or update on chat_reactions for each row execute function operations_org_guard();
create trigger announcements_org_guard before insert or update on company_announcements for each row execute function operations_org_guard();

-- Keep the permission seeder current for organisations bootstrapped after migration 0011.
create or replace function seed_default_permissions(p_org uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 m jsonb := jsonb_build_object(
  'ADMIN',jsonb_build_array('people.view_all','people.manage','attendance.view_all','attendance.approve','attendance.manage','leave.view_all','leave.approve','leave.manage','tasks.view_all','tasks.manage','tasks.review','projects.view_all','projects.manage','projects.workspace_view','projects.time_log','projects.time_approve','projects.updates','crm.view_all','crm.manage','crm.assign','clients.view_all','clients.manage','performance.view_all','performance.review','performance.configure','reports.view_org','settings.manage','roles.manage','audit.view','finance.view','finance.manage','finance.approve_manager','finance.approve_all','finance.approve','finance.pay','finance.export','communication.view','communication.send','communication.manage'),
  'HR_MANAGER',jsonb_build_array('people.view_all','people.manage','attendance.view_all','attendance.approve','attendance.manage','leave.view_all','leave.approve','leave.manage','performance.view_all','performance.review','performance.configure','payroll.view_all','payroll.manage','payroll.export','salary.manage','reports.view_org','audit.view','communication.view','communication.send','communication.manage','projects.workspace_view'),
  'OPERATIONS_MANAGER',jsonb_build_array('people.view_all','attendance.view_all','attendance.approve','leave.view_all','leave.approve','tasks.view_all','tasks.manage','tasks.review','projects.view_all','projects.manage','projects.workspace_view','projects.time_log','projects.time_approve','projects.updates','clients.view_all','performance.view_all','performance.review','reports.view_org','communication.view','communication.send','communication.manage'),
  'DEPARTMENT_MANAGER',jsonb_build_array('people.view_team','attendance.view_team','attendance.approve','leave.approve','tasks.view_team','tasks.manage','tasks.review','projects.manage','projects.workspace_view','projects.time_log','projects.time_approve','projects.updates','performance.view_team','performance.review','communication.view','communication.send'),
  'TEAM_LEAD',jsonb_build_array('people.view_team','attendance.view_team','attendance.approve','leave.approve','tasks.view_team','tasks.manage','tasks.review','projects.workspace_view','projects.time_log','projects.time_approve','projects.updates','performance.view_team','performance.review','communication.view','communication.send'),
  'SALES_EXECUTIVE',jsonb_build_array('crm.manage','clients.view_all','projects.workspace_view','projects.time_log','projects.updates','communication.view','communication.send'),
  'PROJECT_MANAGER',jsonb_build_array('tasks.view_team','tasks.manage','tasks.review','projects.view_all','projects.manage','projects.workspace_view','projects.time_log','projects.time_approve','projects.updates','clients.view_all','communication.view','communication.send'),
  'EMPLOYEE',jsonb_build_array('projects.workspace_view','projects.time_log','projects.updates','communication.view','communication.send'),
  'INTERN',jsonb_build_array('projects.workspace_view','projects.time_log','projects.updates','communication.view','communication.send')
 ); r text; p text;
begin
 for r in select jsonb_object_keys(m) loop
  for p in select jsonb_array_elements_text(m->r) loop
   insert into role_permissions(org_id,role,permission) values(p_org,r::app_role,p) on conflict do nothing;
  end loop;
 end loop;
end $$;
create or replace function project_member_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from projects p join employees e on e.id=new.employee_id where p.id=new.project_id and p.org_id=e.org_id) then
  raise exception 'project member must belong to the same organisation' using errcode='23514';
 end if;
 return new;
end $$;
create trigger project_members_org_guard before insert or update on project_members for each row execute function project_member_org_guard();

create or replace function notify_chat_message() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_name text;
begin
 select name into v_name from chat_channels where id=new.channel_id;
 insert into notifications(org_id,recipient_id,category,title,body,link,dedupe_key)
 select new.org_id,m.employee_id,'CHAT_MESSAGE','New message in '||coalesce(v_name,'team chat'),left(new.body,180),'/chat/'||new.channel_id::text,'chat:'||new.id::text||':'||m.employee_id::text
 from chat_channel_members m where m.channel_id=new.channel_id and m.employee_id<>new.author_id
 on conflict(recipient_id,dedupe_key) do nothing;
 return new;
end $$;
create trigger chat_message_notify after insert on chat_messages for each row execute function notify_chat_message();

create or replace function notify_announcement() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into notifications(org_id,recipient_id,category,title,body,link,dedupe_key)
 select new.org_id,e.id,'ANNOUNCEMENT',new.title,left(new.body,180),'/announcements','announcement:'||new.id::text||':'||e.id::text
 from employees e where e.org_id=new.org_id and e.status<>'EXITED' and e.id<>new.created_by and
  (new.audience='ALL' or (new.audience='DEPARTMENT' and e.department_id=new.department_id) or (new.audience='PROJECT' and exists(select 1 from project_members pm where pm.project_id=new.project_id and pm.employee_id=e.id)))
 on conflict(recipient_id,dedupe_key) do nothing;
 perform _audit(new.org_id,'communication.announcement.published','company_announcement',new.id::text,jsonb_build_object('audience',new.audience,'pinned',new.pinned));
 return new;
end $$;
create trigger announcement_notify after insert on company_announcements for each row execute function notify_announcement();

-- Align RLS with the app's granular communication/project permissions.
drop policy chat_channels_read on chat_channels;
create policy chat_channels_read on chat_channels for select to authenticated using(org_id=current_org_id() and has_perm('communication.view') and archived_at is null and
 (created_by=current_employee_id() or channel_type='PUBLIC' or (channel_type='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or is_chat_member(id) or (channel_type='PROJECT' and has_perm('projects.manage'))));
drop policy chat_channels_create on chat_channels;
create policy chat_channels_create on chat_channels for insert to authenticated with check(org_id=current_org_id() and created_by=current_employee_id() and
 (has_perm('communication.manage') or (channel_type='GROUP' and has_perm('communication.send')) or (channel_type='PROJECT' and has_perm('projects.manage'))));
drop policy chat_members_public_join on chat_channel_members;
create policy chat_members_public_join on chat_channel_members for insert to authenticated with check(
 has_perm('communication.view') and employee_id=current_employee_id() and exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id() and
  (c.channel_type='PUBLIC' or (c.channel_type='DEPARTMENT' and c.department_id=(select e.department_id from employees e where e.id=current_employee_id())))));
drop policy chat_members_read on chat_channel_members;
create policy chat_members_read on chat_channel_members for select to authenticated using(has_perm('communication.view') and (is_chat_member(channel_id) or employee_id=current_employee_id() or has_perm('communication.manage')));
drop policy chat_members_update_self on chat_channel_members;
create policy chat_members_update_self on chat_channel_members for update to authenticated using(has_perm('communication.view') and employee_id=current_employee_id()) with check(has_perm('communication.view') and employee_id=current_employee_id());
drop policy chat_messages_read on chat_messages;
create policy chat_messages_read on chat_messages for select to authenticated using(org_id=current_org_id() and has_perm('communication.view') and is_chat_member(channel_id));
drop policy chat_messages_insert on chat_messages;
create policy chat_messages_insert on chat_messages for insert to authenticated with check(org_id=current_org_id() and has_perm('communication.send') and author_id=current_employee_id() and is_chat_member(channel_id) and deleted_at is null and edited_at is null);
drop policy chat_messages_edit_own on chat_messages;
create policy chat_messages_edit_own on chat_messages for update to authenticated using(has_perm('communication.send') and author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id)) with check(org_id=current_org_id() and has_perm('communication.send') and author_id=current_employee_id() and created_at>now()-interval '15 minutes' and is_chat_member(channel_id));
drop policy chat_reactions_read on chat_reactions;
create policy chat_reactions_read on chat_reactions for select to authenticated using(org_id=current_org_id() and has_perm('communication.view') and exists(select 1 from chat_messages m where m.id=message_id and is_chat_member(m.channel_id)));
drop policy chat_reactions_add on chat_reactions;
create policy chat_reactions_add on chat_reactions for insert to authenticated with check(org_id=current_org_id() and has_perm('communication.send') and employee_id=current_employee_id() and exists(select 1 from chat_messages m where m.id=message_id and is_chat_member(m.channel_id)));
drop policy chat_attachments_read on chat_attachments;
create policy chat_attachments_read on chat_attachments for select to authenticated using(org_id=current_org_id() and has_perm('communication.view') and is_chat_member(channel_id));
drop policy chat_attachments_insert on chat_attachments;
create policy chat_attachments_insert on chat_attachments for insert to authenticated with check(org_id=current_org_id() and has_perm('communication.send') and uploaded_by=current_employee_id() and is_chat_member(channel_id) and exists(select 1 from chat_messages m where m.id=chat_attachments.message_id and m.channel_id=chat_attachments.channel_id and m.author_id=current_employee_id()));
drop policy announcements_read on company_announcements;
create policy announcements_read on company_announcements for select to authenticated using(org_id=current_org_id() and has_perm('communication.view') and published_at<=now() and (expires_at is null or expires_at>now()) and (audience='ALL' or (audience='DEPARTMENT' and department_id=(select department_id from employees where id=current_employee_id())) or (audience='PROJECT' and is_project_workspace_member(project_id))));
drop policy project_update_insert on project_updates;
create policy project_update_insert on project_updates for insert to authenticated with check(org_id=current_org_id() and has_perm('projects.updates') and author_id=current_employee_id() and is_project_workspace_member(project_id));
drop policy project_time_insert on project_time_entries;
create policy project_time_insert on project_time_entries for insert to authenticated with check(org_id=current_org_id() and has_perm('projects.time_log') and employee_id=current_employee_id() and status='SUBMITTED' and decided_by is null and is_project_workspace_member(project_id));

create unique index chat_project_channel_unique on chat_channels(org_id,project_id) where channel_type='PROJECT';
drop policy chat_files_read on storage.objects;
create policy chat_files_read on storage.objects for select to authenticated using(bucket_id='chat-files' and has_perm('communication.view') and split_part(name,'/',1)=current_org_id()::text and is_chat_member(split_part(name,'/',2)::uuid));
drop policy chat_files_insert on storage.objects;
create policy chat_files_insert on storage.objects for insert to authenticated with check(bucket_id='chat-files' and has_perm('communication.send') and split_part(name,'/',1)=current_org_id()::text and split_part(name,'/',3)=current_employee_id()::text and is_chat_member(split_part(name,'/',2)::uuid));

drop policy chat_reactions_remove on chat_reactions;
create policy chat_reactions_remove on chat_reactions for delete to authenticated using(employee_id=current_employee_id() and org_id=current_org_id() and has_perm('communication.send'));
drop policy chat_files_delete on storage.objects;
create policy chat_files_delete on storage.objects for delete to authenticated using(bucket_id='chat-files' and has_perm('communication.send') and split_part(name,'/',1)=current_org_id()::text and split_part(name,'/',3)=current_employee_id()::text);

create or replace function chat_message_update_guard() returns trigger language plpgsql as $$
begin
 if old.id<>new.id or old.org_id<>new.org_id or old.channel_id<>new.channel_id or old.author_id<>new.author_id or old.created_at<>new.created_at or old.parent_message_id is distinct from new.parent_message_id then raise exception 'message identity and thread cannot be changed'; end if;
 return new;
end $$;
create trigger chat_message_update_guard before update on chat_messages for each row execute function chat_message_update_guard();

-- Read receipts are the only mutable membership column. Prevent self-promotion and
-- prevent a creator from changing a private group into a public channel via direct UPDATE.
revoke update on chat_channel_members from authenticated;
grant update(last_read_at) on chat_channel_members to authenticated;
revoke update on chat_channels from authenticated;
drop policy chat_members_public_join on chat_channel_members;
create policy chat_members_public_join on chat_channel_members for insert to authenticated with check(
 has_perm('communication.view') and employee_id=current_employee_id() and member_role='MEMBER' and exists(select 1 from chat_channels c where c.id=channel_id and c.org_id=current_org_id() and
  (c.channel_type='PUBLIC' or (c.channel_type='DEPARTMENT' and c.department_id=(select e.department_id from employees e where e.id=current_employee_id())))));

create or replace function chat_message_update_guard() returns trigger language plpgsql as $$
begin
 if old.id<>new.id or old.org_id<>new.org_id or old.channel_id<>new.channel_id or old.author_id<>new.author_id or old.created_at<>new.created_at or old.parent_message_id is distinct from new.parent_message_id then raise exception 'message identity and thread cannot be changed'; end if;
 if old.body is distinct from new.body then new.edited_at:=now(); end if;
 return new;
end $$;
drop policy project_time_read on project_time_entries;
create policy project_time_read on project_time_entries for select to authenticated using(org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('projects.view_all') or has_perm('projects.manage') or has_perm('projects.time_approve') or is_project_workspace_member(project_id)));
create or replace function project_org_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.manager_id is not null and not exists(select 1 from employees e where e.id=new.manager_id and e.org_id=new.org_id) then raise exception 'project manager must belong to the organisation' using errcode='23514'; end if;
 if new.client_id is not null and not exists(select 1 from clients c where c.id=new.client_id and c.org_id=new.org_id) then raise exception 'project client must belong to the organisation' using errcode='23514'; end if;
 return new;
end $$;
create trigger projects_org_guard before insert or update on projects for each row execute function project_org_guard();
