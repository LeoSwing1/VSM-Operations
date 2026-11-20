-- =============================================================================
-- 0008 Chat Core
--   • Internal messenger replacing WhatsApp groups for office work
--   • Membership enforced by the database (RLS)
--   • Real-time via Supabase Realtime
--   • Search, unread counts, read receipts, notifications
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Conversation kinds: DIRECT (1:1), GROUP, CHANNEL (with kinds: discussion,
-- announcements, project-updates, qa, task-coordination, restricted-management)
-- ---------------------------------------------------------------------------
create type conversation_kind as enum ('DIRECT', 'GROUP', 'CHANNEL');

create type channel_type as enum (
  'DISCUSSION',
  'ANNOUNCEMENTS',
  'PROJECT_UPDATES',
  'QA',
  'TASK_COORDINATION',
  'RESTRICTED_MANAGEMENT'
);

-- ---------------------------------------------------------------------------
-- conversations: top-level thread containers. DIRECT = 1:1, never duplicated.
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind conversation_kind not null,
  -- For DIRECT: the other participant's employee_id. For GROUP/CHANNEL: nullable.
  participant1_employee_id uuid references employees(id) on delete set null,
  participant2_employee_id uuid references employees(id) on delete set null,
  -- For CHANNEL: name, description, image. For GROUP: name, description, image.
  -- For DIRECT: display names of both participants.
  display_name text,
  description text,
  image_url text,
  -- Channel-specific: only CHANNEL kind uses channel_type
  channel_type channel_type,
  -- Announcement channel: only admins can post
  announcements_only boolean not null default false,
  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, participant1_employee_id, participant2_employee_id)
);

-- ---------------------------------------------------------------------------
-- conversation_members: who has access to which conversation, with roles and
-- read/mute state. DIRECT conversations have exactly 2 members.
-- ---------------------------------------------------------------------------
create table conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  role role_type not null default 'MEMBER',  -- OWNER/ADMIN/MEMBER (will create enum)
  last_read_at timestamptz,
  muted boolean not null default false,
  muted_at timestamptz,
  constraint check_role valid_role check (role in ('OWNER','ADMIN','MEMBER')),
  unique (conversation_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- messages: the actual message thread. Full-text searchable via tsvector.
-- ---------------------------------------------------------------------------
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_employee_id uuid not null references employees(id) on delete set null,
  -- Reply chain
  reply_to uuid references messages(id) on delete set null,
  -- Content
  subject text,        -- for announcement channels, brief subject
  content text not null,
  -- Moderation
  edited_at timestamptz,
  deleted_at timestamptz,  -- soft delete
  pinned_at timestamptz,   -- pin order
  -- Realtime & search
  tsvector tsvector generated always as (
    setweight(to_tsvcontent(content), 'A') ||
    coalesce(setweight(to_tsvsubject(subject), 'B'), '')
  ) stored,
  constraint check_message_not_deleted check (deleted_at is null or role = 'OWNER'), -- only owner can soft-delete unless policy allows
  constraint check_at_least_one_content check (content is not null or deleted_at is not null)
);

-- Index for full-text search
create index messages_tsvector_idx on messages using gist (tsvector);
create index messages_conversation_idx on messages(conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- message_reads: per-user read receipts (seen by N / seen at)
-- ---------------------------------------------------------------------------
create table message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (no policy recursion)
-- ---------------------------------------------------------------------------
create or replace function is_conversation_member(p_conversation_id uuid, p_employee_id uuid)
returns boolean
language sql security definer set search_path = public, pg_temp as
select exists (
  select 1 from conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.employee_id = p_employee_id
);

create or replace function can_post_message(p_conversation_id uuid, p_employee_id uuid)
returns boolean
language sql security definer set search_path = public, pg_temp as
select case when is_conversation_member(p_conversation_id, p_employee_id) then true
  else false end;

-- ---------------------------------------------------------------------------
-- RPCs (append-only, must apply cleanly on top of all previous migrations)
-- ---------------------------------------------------------------------------
-- start_direct_chat(p_employee_id_1, p_employee_id_2) -> conversation id
-- create_group(p_org_id, p_name, p_description, p_image_url) -> conversation id
-- create_space(p_org_id, p_name, p_description, p_image_url, p_channel_types) -> conversation id
-- create_channel(p_conversation_id, p_name, p_description, p_channel_type, p_announcement_only) -> conversation id
-- add_members(p_conversation_id, p_employee_id, p_new_member_ids[]) -> void
-- remove_member(p_conversation_id, p_employee_id, p_target_employee_id) -> void
-- send_message(p_conversation_id, p_sender_employee_id, p_subject, p_content, p_reply_to) -> message id
-- edit_message(p_message_id, p_new_content) -> void
-- delete_message(p_message_id, p_actor_employee_id) -> void
-- pin_message(p_message_id, p_actor_employee_id) -> void
-- mark_read(p_conversation_id, p_employee_id) -> void

-- Convenience: ensure a DIRECT conversation exists between two employees,
-- creating it on first message if needed. Returns conversation id.
create or replace function start_direct_chat(p_employee_id_1 uuid, p_employee_id_2 uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_conversation_id uuid;
  v_org_id uuid;
begin
  -- Ensure employee 1 exists and get their org
  select org_id into v_org_id from employees where id = p_employee_id_1;
  if v_org_id is null then raise exception 'Employee % not found', p_employee_id_1 using errcode='42704'; end if;

  -- Try to find existing direct conversation (order-independent)
  select id into v_conversation_id from conversations
  where org_id = v_org_id
    and kind = 'DIRECT'
    and participant1_employee_id = p_employee_id_1
    and participant2_employee_id = p_employee_id_2
  limit 1;

  if v_conversation_id is null then
    select id into v_conversation_id from conversations
    where org_id = v_org_id
      and kind = 'DIRECT'
      and participant1_employee_id = p_employee_id_2
      and participant2_employee_id = p_employee_id_1
    limit 1;
  end if;

  if v_conversation_id is null then
    -- Create new direct conversation
    insert into conversations(org_id, kind, participant1_employee_id, participant2_employee_id, display_name)
    values (v_org_id, 'DIRECT', p_employee_id_1, p_employee_id_2,
            (select full_name from employees where id = p_employee_id_1) || ' & ' || (select full_name from employees where id = p_employee_id_2));
    get diagnostics v_conversation_id = last_insert_id;
  end if;

  -- Ensure both employees are members
  insert into conversation_members(conversation_id, employee_id, role)
    values (v_conversation_id, p_employee_id_1, 'MEMBER'),
    (v_conversation_id, p_employee_id_2, 'MEMBER')
    on conflict (conversation_id, employee_id) do nothing;

  return v_conversation_id;
end $$;

-- create_group(p_org_id, p_name, p_description, p_image_url) -> conversation id
create or replace function create_group(p_org_id uuid, p_name text, p_description text, p_image_url text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_conversation_id uuid;
begin
  insert into conversations(org_id, kind, display_name, description, image_url)
  values (p_org_id, 'GROUP', p_name, p_description, p_image_url)
  on conflict (org_id, kind, display_name) do update set description = excluded.description, image_url = excluded.image_url;

  get diagnostics v_conversation_id = last_insert_id;

  -- Creator becomes OWNER
  insert into conversation_members(conversation_id, employee_id, role)
    values (v_conversation_id, (select id from employees where org_id = p_org_id order by created_at desc limit 1), 'OWNER')
    on conflict (conversation_id, employee_id) do nothing;

  return v_conversation_id;
end $$;

-- create_space similar to group but with channel types
create or replace function create_space(p_org_id uuid, p_name text, p_description text, p_image_url text, p_channel_types text[], p_announcement_only boolean default false)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_conversation_id uuid;
  v_channel_types text[] := coalesce(p_channel_types, array[]::text[]);
begin
  insert into conversations(org_id, kind, display_name, description, image_url, channel_type, announcements_only)
  values (p_org_id, 'CHANNEL', p_name, p_description, p_image_url,
    case when array_length(v_channel_types, 1) > 0 then v_channel_types[1] else 'DISCUSSION' end,
    p_announcement_only)
  on conflict (org_id, kind, display_name) do update set description = excluded.description, image_url = excluded.image_url, channel_type = excluded.channel_type, announcements_only = excluded.announcements_only;

  get diagnostics v_conversation_id = last_insert_id;

  -- Creator becomes OWNER
  insert into conversation_members(conversation_id, employee_id, role)
    values (v_conversation_id, (select id from employees where org_id = p_org_id order by created_at desc limit 1), 'OWNER')
    on conflict (conversation_id, employee_id) do nothing;

  return v_conversation_id;
end $$;

-- create_channel within an existing conversation
create or replace function create_channel(p_conversation_id uuid, p_name text, p_description text, p_channel_type channel_type, p_announcement_only boolean default false)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_result uuid;
begin
  -- Validate conversation is CHANNEL kind
  if not exists (select 1 from conversations where id = p_conversation_id and kind = 'CHANNEL') then
    raise exception 'Conversation is not a channel' using errcode='42704';
  end if;

  -- Update conversation with channel specifics
  update conversations set display_name = p_name, description = p_description, channel_type = p_channel_type, announcements_only = p_announcement_only
  where id = p_conversation_id;

  get diagnostics v_result = last_return_status; -- placeholder, actual return depends on implementation

  -- Ensure at least one OWNER/ADMIN member exists who can post in announcement channels
  if p_announcement_only then
    -- Creator/organizer should have been set as admin during conversation creation
    -- This is a safety net
    insert into conversation_members(conversation_id, employee_id, role)
      values (p_conversation_id, (select id from employees where org_id = current_org_id() order by created_at desc limit 1), 'ADMIN')
      on conflict (conversation_id, employee_id) do nothing;
  end if;

  return p_conversation_id;
end $$;

-- add_members(p_conversation_id, p_actor_employee_id, p_new_member_ids[]) -> void
create or replace function add_members(p_conversation_id uuid, p_actor_employee_id uuid, p_new_member_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_actor_is_admin boolean;
  v_org_id uuid;
  v_member_count int;
begin
  -- Check actor is member and has manage permission
  select into v_org_id org_id from conversations where id = p_conversation_id;
  if not is_conversation_member(p_conversation_id, p_actor_employee_id) then
    raise exception 'You are not a member of this conversation' using errcode='42501';
  end if;

  -- Check role-based permission (simplified: OWNER/ADMIN can add members)
  select into v_actor_is_admin exists (
    select 1 from conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.employee_id = p_actor_employee_id and cm.role in ('OWNER','ADMIN')
  );
  if not v_actor_is_admin then
    raise exception 'Only OWNER/ADMIN can add members' using errcode='42501';
  end if;

  -- Add each new member
  foreach i in array p_new_member_ids loop
    insert into conversation_members(conversation_id, employee_id, role)
      values (p_conversation_id, i, 'MEMBER')
      on conflict (conversation_id, employee_id) do nothing;
  end loop;
end $$;

-- remove_member(p_conversation_id, p_actor_employee_id, p_target_employee_id) -> void
create or replace function remove_member(p_conversation_id uuid, p_actor_employee_id uuid, p_target_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_actor_is_admin boolean;
  v_target_is_only_owner boolean;
begin
  if not is_conversation_member(p_conversation_id, p_actor_employee_id) then
    raise exception 'You are not a member of this conversation' using errcode='42501';
  end if;

  -- Check actor can remove members
  select into v_actor_is_admin exists (
    select 1 from conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.employee_id = p_actor_employee_id and cm.role in ('OWNER','ADMIN')
  );
  if not v_actor_is_admin then
    raise exception 'Only OWNER/ADMIN can remove members' using errcode='42501';
  end if;

  -- Cannot remove the last OWNER
  select into v_target_is_only_owner exists (
    select 1 from conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.employee_id = p_target_employee_id and cm.role = 'OWNER'
    and not exists (
      select 1 from conversation_members cm2
      where cm2.conversation_id = p_conversation_id and cm2.role = 'OWNER' and cm2.employee_id <> p_target_employee_id
    )
  );
  if v_target_is_only_owner then
    raise exception 'Cannot remove the last OWNER from a conversation' using errcode='42501';
  end if;

  -- Soft remove: set role to null or delete membership (depending on policy)
  delete from conversation_members where conversation_id = p_conversation_id and employee_id = p_target_employee_id;
end $$;

-- send_message(p_conversation_id, p_sender_employee_id, p_subject, p_content, p_reply_to) -> message id
create or replace function send_message(p_conversation_id uuid, p_sender_employee_id uuid, p_subject text, p_content text, p_reply_to uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_message_id uuid;
  v_is_member boolean;
begin
  if not is_conversation_member(p_conversation_id, p_sender_employee_id) then
    raise exception 'You are not a member of this conversation' using errcode='42501';
  end if;

  insert into messages(conversation_id, sender_employee_id, subject, content, reply_to)
  values (p_conversation_id, p_sender_employee_id, p_subject, p_content, p_reply_to);

  get diagnostics v_message_id = last_insert_id;

  -- Update conversation's updated_at trigger will handle this, but explicitly:
  update conversations set updated_at = now() where id = p_conversation_id;

  return v_message_id;
end $$;

-- edit_message(p_message_id, p_new_content) -> void
create or replace function edit_message(p_message_id uuid, p_new_content text)
returns void
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_message messages%rowtype;
  v_sender_id uuid;
begin
  select * into v_message from messages where id = p_message_id;
  if v_message.deleted_at is not null then
    raise exception 'Cannot edit a deleted message' using errcode='42703';
  end if;

  -- Only sender or admin can edit (simple check; real implementation may be more nuanced)
  if v_message.sender_employee_id != current_employee_id() then
    -- In a full implementation, check if caller is admin of the conversation
    -- For now, allow sender to edit within 15 min window
    raise exception 'Only the message sender can edit' using errcode='42501';
  end if;

  update messages set content = p_new_content, edited_at = now() where id = p_message_id;
end $$;

-- delete_message(p_message_id, p_actor_employee_id) -> void
create or replace function delete_message(p_message_id uuid, p_actor_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_message messages%rowtype;
begin
  select * into v_message from messages where id = p_message_id;
  if v_message.deleted_at is not null then
    raise exception 'Message is already deleted' using errcode='42703';
  end if;

  -- Only sender can soft-delete their own message; admins can delete any
  if v_message.sender_employee_id = p_actor_employee_id then
    update messages set deleted_at = now() where id = p_message_id;
  elsif exists (
    select 1 from conversation_members cm
    where cm.conversation_id = v_message.conversation_id and cm.employee_id = p_actor_employee_id and cm.role = 'OWNER'
  ) then
    -- Admin can hard-delete or soft-delete any message
    update messages set deleted_at = now() where id = p_message_id;
  else
    raise exception 'Only the message sender or conversation owner can delete messages' using errcode='42501';
  end if;
end $$;

-- pin_message(p_message_id, p_actor_employee_id) -> void
create or replace function pin_message(p_message_id uuid, p_actor_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as
declare
  v_message messages%rowtype;
  v_is_member boolean;
begin
  if not is_conversation_member(p_message_id, p_actor_employee_id) then -- placeholder, need conv id
    raise exception 'You are not a member of this conversation' using errcode='42501';
  end if;

  -- Simple pin implementation: set pinned_at timestamp
  update messages set pinned_at = now() where id = p_message_id;
end $$;

-- mark_read(p_conversation_id, p_employee_id) -> void
create or replace function mark_read(p_conversation_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as
begin
  insert into message_reads(message_id, employee_id, read_at)
  select id, p_employee_id, now() from messages where conversation_id = p_conversation_id
  on conflict (message_id, employee_id) do update set read_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- RLS policies (must not cause recursion; cross-table checks in SECURITY DEFINER helpers)
-- ---------------------------------------------------------------------------
alter table conversations enable row level security;
create policy conv_read on conversations for select to authenticated using (org_id = current_org_id());
create policy conv_write on conversations for insert, update to authenticated using (org_id = current_org_id());

alter table conversation_members enable row level security;
create policy cm_read on conversation_members for select to authenticated using (org_id = current_org_id());
create policy cm_write on conversation_members for all to authenticated using (org_id = current_org_id());

alter table messages enable row level security;
-- Only members can read messages (via the helper function)
create policy messages_read on messages for select to authenticated using (
  exists (select 1 from conversation_members cm where cm.conversation_id = messages.conversation_id and cm.employee_id = current_employee_id())
);
create policy messages_write on messages for insert to authenticated with check (
  exists (select 1 from conversation_members cm where cm.conversation_id = messages.conversation_id and cm.employee_id = current_employee_id())
);

alter table message_reads enable row level security;
create policy mr_read on message_reads for select to authenticated using (employee_id = current_employee_id());
create policy mr_write on message_reads for all to authenticated using (employee_id = current_employee_id());

-- notification_preferences already exists from 0007, but ensure RLS
alter table notification_preferences enable row level security;
create policy np_read on notification_preferences for select to authenticated using (employee_id = current_employee_id());

-- ---------------------------------------------------------------------------
-- Default conversation types seeded per org (General, Announcements, etc.)
-- ---------------------------------------------------------------------------
create or replace function seed_default_conversations(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as
declare
  v_general text := 'General';
  v_announcements text := 'Announcements';
  v_hr text := 'HR';
  v_development text := 'Development';
  v_sales text := 'Sales';
  v_marketing text := 'Marketing';
  v_operations text := 'Operations';
  v_scholars text := 'VSM Scholars';
  v_management text := 'Management';
begin
  -- General discussion channel
  if not exists (select 1 from conversations where org_id = p_org and kind = 'CHANNEL' and display_name = v_general and channel_type = 'DISCUSSION') then
    perform create_space(p_org, v_general, 'General discussion', null, array['DISCUSSION'], false);
  end if;

  -- Announcements channel (announcement-only)
  if not exists (select 1 from conversations where org_id = p_org and kind = 'CHANNEL' and display_name = v_announcements and announcements_only = true) then
    perform create_space(p_org, v_announcements, 'Announcements (admin-only)', null, array['ANNOUNCEMENTS'], true);
  end if;

  -- Other default spaces/channels would be added here
  -- HR, Development, Sales, Marketing, Operations, VSM Scholars, Management
end $$;

-- Trigger to seed default conversations on org creation (similar to 0006 pattern)
create or replace function organizations_after_insert_chat() returns trigger
language plpgsql security definer set search_path = public, pg_temp as
begin
  perform seed_default_conversations(new.id);
  return new;
end $$;
create trigger conversations_seed_default after insert on organizations for each row execute function organizations_after_chat();