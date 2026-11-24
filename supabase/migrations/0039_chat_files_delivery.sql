-- =============================================================================
-- 0039 · Chat: any file type up to 50 MB (direct browser upload), and "delivered" ticks.
-- 50 MB is the Supabase Free-plan per-file maximum; on Pro raise it in Storage settings and here.
-- =============================================================================
update storage.buckets set allowed_mime_types = null, file_size_limit = 52428800 where id = 'chat-files';

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.chat_attachments'::regclass and contype = 'c'
            and (pg_get_constraintdef(oid) ilike '%mime_type%' or pg_get_constraintdef(oid) ilike '%file_size%') loop
    execute format('alter table chat_attachments drop constraint %I', c.conname);
  end loop;
end $$;
alter table chat_attachments add constraint chat_attachments_mime_type_check check (length(mime_type) between 3 and 200);
alter table chat_attachments add constraint chat_attachments_file_size_check check (file_size between 1 and 52428800);
alter table chat_attachments drop constraint if exists chat_attachments_file_name_check;
alter table chat_attachments add constraint chat_attachments_file_name_check check (length(file_name) between 1 and 255);

-- Delivered = the person's app has been open since the message arrived (refreshed by the app every ~20 s).
alter table chat_channel_members add column if not exists last_delivered_at timestamptz;
create or replace function chat_mark_delivered() returns void
language sql security definer set search_path = public, pg_temp as $$
  update chat_channel_members set last_delivered_at = now()
   where employee_id = current_employee_id() and (last_delivered_at is null or last_delivered_at < now() - interval '15 seconds')
$$;
revoke all on function chat_mark_delivered() from public, anon;
grant execute on function chat_mark_delivered() to authenticated;
