-- =============================================================================
-- 0030 · Block 22 — Google Workspace: tokens never readable from the browser, two-way calendar sync queue,
-- external busy blocks, Drive copies of documents, workspace settings (Gmail sender, Drive folder).
-- =============================================================================
-- Tokens: the signed-in user may see/delete their own connection, never the encrypted token columns.
revoke all on calendar_provider_connections from anon, authenticated;
grant select (id, org_id, employee_id, provider, account_email, expires_at, scopes, sync_enabled, last_synced_at, last_error, created_at, updated_at)
  on calendar_provider_connections to authenticated;
grant update (sync_enabled) on calendar_provider_connections to authenticated;
grant delete on calendar_provider_connections to authenticated;

-- One Google copy per participant (was: one per event).
alter table calendar_sync_links drop constraint if exists calendar_sync_links_event_id_provider_key;
create unique index if not exists calendar_sync_links_event_emp_provider on calendar_sync_links(event_id, employee_id, provider);
-- Events imported FROM Google are marked so they are never pushed back (no duplicates / loops).
alter table calendar_events add column if not exists external_source text check (external_source in ('GOOGLE','MICROSOFT'));

create table if not exists google_workspace_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  gmail_sender_employee_id uuid references employees(id) on delete set null,
  drive_enabled boolean not null default false,
  drive_folder_id text check (drive_folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  calendar_two_way boolean not null default true,
  updated_by uuid references employees(id), updated_at timestamptz not null default now()
);
insert into google_workspace_settings(org_id) select id from organizations on conflict do nothing;
alter table google_workspace_settings enable row level security;
drop policy if exists gws_read on google_workspace_settings;
create policy gws_read on google_workspace_settings for select to authenticated using (org_id = current_org_id());
drop policy if exists gws_write on google_workspace_settings;
create policy gws_write on google_workspace_settings for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage')) with check (org_id = current_org_id() and has_perm('settings.manage'));

-- Push queue: VSM meetings → each participant's connected Google calendar.
create table if not exists calendar_sync_queue (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null,
  employee_id uuid not null references employees(id) on delete cascade,
  op text not null check (op in ('UPSERT','DELETE')),
  status text not null default 'QUEUED' check (status in ('QUEUED','SENDING','DONE','FAILED','SKIPPED')),
  attempts int not null default 0, last_error text, next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(), done_at timestamptz
);
create unique index if not exists cal_sync_pending_uniq on calendar_sync_queue(event_id, employee_id) where status in ('QUEUED','SENDING');
alter table calendar_sync_queue enable row level security;
drop policy if exists cal_sync_admin on calendar_sync_queue;
create policy cal_sync_admin on calendar_sync_queue for select to authenticated using (org_id = current_org_id() and has_perm('settings.manage'));
revoke insert, update, delete on calendar_sync_queue from authenticated;

create or replace function enqueue_calendar_sync(p_event uuid, p_op text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from calendar_events where id = p_event;
  if v_org is null then return; end if;
  insert into calendar_sync_queue(org_id, event_id, employee_id, op)
  select v_org, p_event, x.emp, p_op from (
    select organizer_id emp from calendar_events where id = p_event
    union select employee_id from calendar_attendees where event_id = p_event) x
  join calendar_provider_connections c on c.employee_id = x.emp and c.provider = 'GOOGLE' and c.sync_enabled
  on conflict (event_id, employee_id) where status in ('QUEUED','SENDING') do update set op = excluded.op, next_attempt_at = now();
end $$;
revoke all on function enqueue_calendar_sync(uuid, text) from public, anon, authenticated;

create or replace function calendar_events_sync_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from google_workspace_settings where org_id = coalesce(new.org_id, old.org_id) and calendar_two_way) then
    return coalesce(new, old);
  end if;
  if coalesce(new.external_source, old.external_source) is not null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    insert into calendar_sync_queue(org_id, event_id, employee_id, op)
    select old.org_id, old.id, l.employee_id, 'DELETE' from calendar_sync_links l where l.event_id = old.id and l.provider = 'GOOGLE'
    on conflict (event_id, employee_id) where status in ('QUEUED','SENDING') do update set op = 'DELETE', next_attempt_at = now();
  else
    perform enqueue_calendar_sync(new.id, case when new.status = 'CANCELLED' then 'DELETE' else 'UPSERT' end);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists calendar_events_sync on calendar_events;
create trigger calendar_events_sync after insert or update or delete on calendar_events for each row execute function calendar_events_sync_trg();

create or replace function calendar_attendees_sync_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    insert into calendar_sync_queue(org_id, event_id, employee_id, op)
    select old.org_id, old.event_id, old.employee_id, 'DELETE'
     where exists (select 1 from calendar_sync_links l where l.event_id = old.event_id and l.employee_id = old.employee_id)
    on conflict (event_id, employee_id) where status in ('QUEUED','SENDING') do update set op = 'DELETE', next_attempt_at = now();
  elsif not exists (select 1 from calendar_events e where e.id = new.event_id and e.external_source is not null) then
    perform enqueue_calendar_sync(new.event_id, 'UPSERT');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists calendar_attendees_sync on calendar_attendees;
create trigger calendar_attendees_sync after insert or delete on calendar_attendees for each row execute function calendar_attendees_sync_trg();

create or replace function claim_calendar_sync(p_limit int default 25) returns setof calendar_sync_queue
language sql security definer set search_path = public, pg_temp as $$
  update calendar_sync_queue q set status = 'SENDING', attempts = q.attempts + 1
  where q.id in (select id from calendar_sync_queue where status = 'QUEUED' and next_attempt_at <= now()
                 order by id limit greatest(1, least(p_limit, 100)) for update skip locked)
  returning q.*
$$;
revoke all on function claim_calendar_sync(int) from public, anon, authenticated;

-- Drive copies of employee documents.
create table if not exists google_drive_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_document_id uuid not null references employee_documents(id) on delete cascade,
  drive_file_id text not null, web_view_link text check (web_view_link ~ '^https://'),
  uploaded_by uuid references employees(id), created_at timestamptz not null default now(),
  unique (employee_document_id)
);
alter table google_drive_files enable row level security;
drop policy if exists gdrive_read on google_drive_files;
create policy gdrive_read on google_drive_files for select to authenticated
  using (org_id = current_org_id() and exists (select 1 from employee_documents d where d.id = employee_document_id));
revoke insert, update, delete on google_drive_files from authenticated;
