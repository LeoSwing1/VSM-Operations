-- Block 14: secure Realtime channels for chat, notification delivery and read receipts.

-- Postgres Changes must include old values so unread counters can react to read transitions.
alter table public.notifications replica identity full;
alter table public.chat_reactions replica identity full;
alter table public.chat_channel_members replica identity full;
alter table public.chat_messages replica identity full;

-- Ensure the relevant tables are published. Chat messages were published in Block 5;
-- these additions are idempotent for fresh and already-provisioned projects.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_reactions') then
      alter publication supabase_realtime add table public.chat_reactions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_channel_members') then
      alter publication supabase_realtime add table public.chat_channel_members;
    end if;
  end if;
end $$;

-- Private Realtime topic authorization. A user can only subscribe to a chat topic
-- when they are an active member of that exact channel in their current org.
create or replace function public.can_access_chat_realtime_topic()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$' then exists (
      select 1
      from public.chat_channels c
      join public.chat_channel_members m on m.channel_id = c.id
      where c.id = split_part(realtime.topic(), ':', 2)::uuid
        and c.org_id = public.current_org_id()
        and m.employee_id = public.current_employee_id()
    )
    else false
  end;
$$;
revoke all on function public.can_access_chat_realtime_topic() from public, anon;
grant execute on function public.can_access_chat_realtime_topic() to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "OPDesk chat topic members read" on realtime.messages';
    execute 'drop policy if exists "OPDesk chat topic members send" on realtime.messages';
    execute 'create policy "OPDesk chat topic members read" on realtime.messages for select to authenticated using (public.can_access_chat_realtime_topic())';
    execute 'create policy "OPDesk chat topic members send" on realtime.messages for insert to authenticated with check (public.can_access_chat_realtime_topic())';
  end if;
end $$;

-- The application still uses the existing RLS policies on notifications and chat tables.
-- No service-role access is granted to browser clients.
