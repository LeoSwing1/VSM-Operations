-- =============================================================================
-- VSM Growth Operations — 0044 Archived chats you can open + 10 GB chat files
-- 1) Archived conversations stay readable (read-only) for their members, moderators, admins, owners and the
--    Super Admin, and can be restored by the same people who could archive them.
-- 2) Chat files up to 10 GB (resumable upload from the browser). Supabase also needs the project's
--    Storage → Settings → "Global file size limit" at 10 GB or more (Pro plan; Free is capped at 50 MB).
-- =============================================================================

update storage.buckets set file_size_limit = 10737418240, allowed_mime_types = null where id = 'chat-files';
alter table chat_attachments drop constraint if exists chat_attachments_file_size_check;
alter table chat_attachments add constraint chat_attachments_file_size_check check (file_size between 1 and 10737418240);

-- Who may look at / restore an archived conversation.
create or replace function can_view_archived_chat(p_channel uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from chat_channels c
     where c.id = p_channel and c.org_id = current_org_id() and c.archived_at is not null
       and (has_perm('communication.moderate') or has_perm('communication.channel_manage')
            or exists (select 1 from chat_channel_members m where m.channel_id = c.id and m.employee_id = current_employee_id())))
$$;
revoke all on function can_view_archived_chat(uuid) from public, anon;
grant execute on function can_view_archived_chat(uuid) to authenticated;

create or replace function my_archived_chats()
returns table (id uuid, name text, channel_type text, archived_at timestamptz, other_name text, messages int, last_message_at timestamptz,
               can_restore boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.name, c.channel_type::text, c.archived_at,
         (select e.full_name from chat_channel_members m join employees e on e.id = m.employee_id
           where m.channel_id = c.id and m.employee_id <> current_employee_id() order by e.full_name limit 1),
         (select count(*)::int from chat_messages x where x.channel_id = c.id and x.deleted_at is null),
         (select max(x.created_at) from chat_messages x where x.channel_id = c.id),
         (has_perm('communication.channel_manage') or c.created_by = current_employee_id()
          or exists (select 1 from chat_channel_members m where m.channel_id = c.id and m.employee_id = current_employee_id() and m.member_role = 'OWNER')
          or (c.channel_type = 'PROJECT' and has_perm('projects.manage')))
    from chat_channels c
   where c.org_id = current_org_id() and c.archived_at is not null and can_view_archived_chat(c.id)
   order by c.archived_at desc
   limit 200
$$;
revoke all on function my_archived_chats() from public, anon;
grant execute on function my_archived_chats() to authenticated;

-- Read-only history (newest 500). Attachment paths are returned so the server can sign them after this check.
create or replace function archived_chat_history(p_channel uuid)
returns table (id uuid, body text, author_name text, author_id uuid, created_at timestamptz, deleted boolean,
               attachments jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not can_view_archived_chat(p_channel) then raise exception 'conversation not available' using errcode = '42501'; end if;
  return query
    select * from (
      select m.id, case when m.deleted_at is null then m.body else null end, e.full_name, m.author_id, m.created_at,
             m.deleted_at is not null,
             coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type,
                                                          'file_size', a.file_size, 'storage_path', a.storage_path))
                         from chat_attachments a where a.message_id = m.id and m.deleted_at is null), '[]'::jsonb)
        from chat_messages m left join employees e on e.id = m.author_id
       where m.channel_id = p_channel
       order by m.created_at desc
       limit 500) t
    order by t.created_at;
end $$;
revoke all on function archived_chat_history(uuid) from public, anon;
grant execute on function archived_chat_history(uuid) to authenticated;

create or replace function unarchive_chat_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v chat_channels;
begin
  select * into v from chat_channels where id = p_channel and org_id = current_org_id() for update;
  if v.id is null or v.archived_at is null then raise exception 'conversation is not archived'; end if;
  if not (has_perm('communication.channel_manage') or v.created_by = current_employee_id()
          or (v.channel_type = 'PROJECT' and has_perm('projects.manage'))
          or exists (select 1 from chat_channel_members m where m.channel_id = p_channel and m.employee_id = current_employee_id() and m.member_role = 'OWNER')) then
    raise exception 'only the channel owner or a chat manager can restore it' using errcode = '42501';
  end if;
  update chat_channels set archived_at = null where id = p_channel;
  insert into chat_moderation_events(org_id, actor_id, action, channel_id) values (v.org_id, current_employee_id(), 'CHANNEL_RESTORED', p_channel);
end $$;
revoke all on function unarchive_chat_channel(uuid) from public, anon;
grant execute on function unarchive_chat_channel(uuid) to authenticated;

select audit_attach_all();
