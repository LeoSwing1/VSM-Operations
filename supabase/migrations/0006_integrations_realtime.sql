-- =============================================================================
-- 0006 Integrations, Realtime (chat/groups/spaces/announcements), Webhooks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Integrations command center
-- ---------------------------------------------------------------------------
create table integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('GOOGLE_CALENDAR','GOOGLE_DRIVE','SLACK','TEAMS','WEBHOOK','RESEND','FCM','CUSTOM')),
  name text not null,
  config jsonb not null default '{}',          -- encrypted secrets, OAuth tokens, webhook URLs
  status text not null default 'DISCONNECTED' check (status in ('CONNECTED','DISCONNECTED','ERROR','PENDING_AUTH')),
  last_sync_at timestamptz,
  error_message text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, name)
);
create index integrations_org_idx on integrations(org_id);
create trigger integrations_touch before update on integrations for each row execute function touch_updated_at();

-- Webhook deliveries (outbound) - for integration command center
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  integration_id uuid references integrations(id) on delete set null,
  target_url text not null,
  event_type text not null,
  payload jsonb not null,
  response_status int,
  response_body text,
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','DELIVERED','FAILED','SKIPPED')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (org_id, idempotency_key)
);
create index webhook_deliveries_due_idx on webhook_deliveries(next_attempt_at) where status in ('PENDING','FAILED');
create trigger webhook_deliveries_touch before update on webhook_deliveries for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime: Chat, Groups, Spaces, Announcements
-- ---------------------------------------------------------------------------
create type space_visibility as enum ('PUBLIC','PRIVATE','SHARED');
create type membership_role as enum ('OWNER','ADMIN','MEMBER','VIEWER');
create type message_kind as enum ('TEXT','SYSTEM','FILE','ANNOUNCEMENT','POLL');

create table spaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  visibility space_visibility not null default 'SHARED',
  owner_id uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index spaces_org_idx on spaces(org_id);
create trigger spaces_touch before update on spaces for each row execute function touch_updated_at();

create table space_members (
  space_id uuid not null references spaces(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  role membership_role not null default 'MEMBER',
  joined_at timestamptz not null default now(),
  muted_until timestamptz,
  primary key (space_id, employee_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  sender_id uuid not null references employees(id) on delete cascade,
  kind message_kind not null default 'TEXT',
  content text not null,
  reply_to uuid references messages(id) on delete set null,
  metadata jsonb not null default '{}',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_space_time_idx on messages(space_id, created_at desc);
create index messages_sender_idx on messages(sender_id, created_at desc);

create table message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, employee_id, emoji)
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  body text not null,
  author_id uuid not null references employees(id),
  target_roles app_role[],
  target_department_ids uuid[],
  target_employee_ids uuid[],
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index announcements_org_publish_idx on announcements(org_id, publish_at desc);
create index announcements_target_idx on announcements(org_id) where expires_at is null or expires_at > now();

create table announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- Meetings & Calendar integration
-- ---------------------------------------------------------------------------
create type meeting_status as enum ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED');

create table meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid references spaces(id) on delete set null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata',
  meeting_url text,
  provider text check (provider in ('GOOGLE_MEET','TEAMS','ZOOM','CUSTOM')),
  provider_event_id text,
  status meeting_status not null default 'SCHEDULED',
  organizer_id uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index meetings_org_time_idx on meetings(org_id, starts_at);
create index meetings_space_idx on meetings(space_id);
create trigger meetings_touch before update on meetings for each row execute function touch_updated_at();

create table meeting_attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED','TENTATIVE')),
  responded_at timestamptz,
  primary key (meeting_id, employee_id)
);

-- Calendar sync tokens (per employee for Google Calendar)
create table calendar_sync (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  provider text not null check (provider in ('GOOGLE')),
  sync_token text,
  next_sync_token text,
  last_synced_at timestamptz,
  unique (org_id, employee_id, provider)
);

-- ---------------------------------------------------------------------------
-- Documents & Storage
-- ---------------------------------------------------------------------------
create type document_category as enum ('CONTRACT','HR','FINANCE','PROJECT','PERSONAL','COMPLIANCE','OTHER');

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid references spaces(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,  -- owner/uploader
  category document_category not null default 'OTHER',
  title text not null,
  description text,
  file_path text not null,              -- Supabase Storage path
  file_name text not null,
  file_size int not null,
  mime_type text not null,
  version int not null default 1,
  parent_document_id uuid references documents(id) on delete set null,  -- for versioning
  is_template boolean not null default false,
  checksum text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_org_idx on documents(org_id);
create index documents_space_idx on documents(space_id);
create index documents_project_idx on documents(project_id);
create index documents_employee_idx on documents(employee_id);
create trigger documents_touch before update on documents for each row execute function touch_updated_at();

create table document_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  shared_with_employee_id uuid references employees(id) on delete cascade,
  shared_with_role app_role,
  permission text not null default 'VIEW' check (permission in ('VIEW','COMMENT','EDIT')),
  expires_at timestamptz,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  unique (document_id, shared_with_employee_id),
  unique (document_id, shared_with_role)
);

-- ---------------------------------------------------------------------------
-- Incidents & SLA (Block 5)
-- ---------------------------------------------------------------------------
create type incident_severity as enum ('SEV1','SEV2','SEV3','SEV4');
create type incident_status as enum ('OPEN','INVESTIGATING','MITIGATED','RESOLVED','CLOSED');

create table incident_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  severity incident_severity not null,
  response_time_minutes int not null check (response_time_minutes > 0),
  resolution_time_minutes int not null check (resolution_time_minutes > 0),
  escalation_levels jsonb not null default '[]',  -- [{level, notify_roles, after_minutes}]
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid references incident_policies(id) on delete set null,
  title text not null,
  description text,
  severity incident_severity not null default 'SEV3',
  status incident_status not null default 'OPEN',
  source text not null default 'MANUAL' check (source in ('MANUAL','MONITORING','WEBHOOK','EMAIL')),
  source_ref text,
  assignee_id uuid references employees(id) on delete set null,
  reporter_id uuid references employees(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  root_cause text,
  resolution_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_org_status_idx on incidents(org_id, status, severity);
create index incidents_assignee_idx on incidents(assignee_id, status);
create trigger incidents_touch before update on incidents for each row execute function touch_updated_at();

create table incident_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  incident_id uuid not null references incidents(id) on delete cascade,
  author_id uuid not null references employees(id),
  kind text not null check (kind in ('NOTE','STATUS_CHANGE','ASSIGNMENT','ESCALATION','RESOLUTION','ROOT_CAUSE')),
  body text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- SLA tracking per incident
create table incident_sla (
  incident_id uuid primary key references incidents(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid not null references incident_policies(id),
  response_deadline timestamptz not null,
  resolution_deadline timestamptz not null,
  response_met boolean,
  resolution_met boolean,
  escalated_at timestamptz,
  escalation_level int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Automation Engine (Block 5)
-- ---------------------------------------------------------------------------
create type automation_trigger as enum ('SCHEDULE','EVENT','WEBHOOK','MANUAL');
create type automation_action_type as enum ('NOTIFY','EMAIL','WEBHOOK','CREATE_TASK','UPDATE_FIELD','RUN_SQL','HTTP_REQUEST');

create table automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger automation_trigger not null,
  trigger_config jsonb not null default '{}',   -- cron, event type, webhook path, etc.
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_org_idx on automations(org_id);
create trigger automations_touch before update on automations for each row execute function touch_updated_at();

create table automation_actions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  step_order int not null,
  action_type automation_action_type not null,
  config jsonb not null default '{}',   -- template, recipients, URL, SQL, etc.
  condition jsonb,                      -- optional condition to run this step
  continue_on_error boolean not null default false,
  created_at timestamptz not null default now()
);

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  trigger_payload jsonb not null default '{}',
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  run_log jsonb not null default '[]'
);
create index automation_runs_org_idx on automation_runs(org_id, started_at desc);

-- ---------------------------------------------------------------------------
-- VSM Scholars (Block 5)
-- ---------------------------------------------------------------------------
create type scholar_status as enum ('APPLIED','SCREENING','INTERVIEW','SELECTED','ONBOARDING','ACTIVE','ALUMNI','WITHDRAWN');

create table scholar_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date,
  capacity int not null default 30,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table scholars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references scholar_batches(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,  -- linked when hired
  full_name text not null,
  email text not null,
  phone text,
  college text,
  graduation_year int,
  skills text[] not null default '{}',
  status scholar_status not null default 'APPLIED',
  application_data jsonb not null default '{}',
  assigned_mentor_id uuid references employees(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);
create index scholars_batch_idx on scholars(batch_id, status);
create index scholars_mentor_idx on scholars(assigned_mentor_id);
create trigger scholars_touch before update on scholars for each row execute function touch_updated_at();

create table scholar_evaluations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  scholar_id uuid not null references scholars(id) on delete cascade,
  evaluator_id uuid not null references employees(id),
  round text not null,  -- 'screening', 'technical', 'hr', 'final'
  score numeric(5,2) check (score between 0 and 100),
  feedback text,
  recommendation text not null check (recommendation in ('HIRE','MAYBE','REJECT')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications preferences (extending notifications from 0004)
-- ---------------------------------------------------------------------------
create table notification_preferences (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  digest_mode text not null default 'IMMEDIATE' check (digest_mode in ('IMMEDIATE','HOURLY','DAILY','WEEKLY')),
  categories jsonb not null default '{}',  -- per-category overrides
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- FCM Tokens for push notifications (extending integrations)
-- ---------------------------------------------------------------------------
create table fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  token text not null,
  device_info jsonb,                      -- {platform, model, os_version, browser, ...}
  platform text not null check (platform in ('web','android','ios','macos','windows','linux','chrome','firefox','safari','edge')),
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, token)
);
create index fcm_tokens_employee_idx on fcm_tokens(employee_id, active);
create index fcm_tokens_active_idx on fcm_tokens(active, last_used_at desc);

-- ---------------------------------------------------------------------------
-- RLS Policies
-- ---------------------------------------------------------------------------

-- Integrations
alter table integrations enable row level security;
alter table webhook_deliveries enable row level security;

create policy integrations_read on integrations for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
create policy integrations_write on integrations for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy webhook_read on webhook_deliveries for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
create policy webhook_write on webhook_deliveries for insert to authenticated
  with check (org_id = current_org_id() and has_perm('settings.manage'));

-- Spaces & Chat
alter table spaces enable row level security;
alter table space_members enable row level security;
alter table messages enable row level security;
alter table message_reactions enable row level security;

create policy spaces_read on spaces for select to authenticated
  using (org_id = current_org_id() and (
    visibility = 'PUBLIC'
    or owner_id = current_employee_id()
    or exists (select 1 from space_members sm where sm.space_id = spaces.id and sm.employee_id = current_employee_id())
  ));
create policy spaces_write on spaces for all to authenticated
  using (org_id = current_org_id() and (owner_id = current_employee_id() or has_perm('settings.manage')))
  with check (org_id = current_org_id() and (owner_id = current_employee_id() or has_perm('settings.manage')));

create policy sm_read on space_members for select to authenticated
  using (exists (select 1 from spaces s where s.id = space_id and s.org_id = current_org_id()));
create policy sm_write on space_members for all to authenticated
  using (org_id = current_org_id() and (
    exists (select 1 from spaces s where s.id = space_id and s.owner_id = current_employee_id())
    or has_perm('settings.manage')
  ))
  with check (org_id = current_org_id());

create policy messages_read on messages for select to authenticated
  using (org_id = current_org_id() and exists (
    select 1 from spaces s join space_members sm on sm.space_id = s.id
    where s.id = messages.space_id and sm.employee_id = current_employee_id() and s.org_id = current_org_id()
  ));
create policy messages_write on messages for insert to authenticated
  with check (org_id = current_org_id() and sender_id = current_employee_id() and exists (
    select 1 from space_members sm where sm.space_id = messages.space_id and sm.employee_id = current_employee_id()
  ));
create policy messages_update on messages for update to authenticated
  using (org_id = current_org_id() and sender_id = current_employee_id() and deleted_at is null)
  with check (org_id = current_org_id() and sender_id = current_employee_id());

create policy reactions_read on message_reactions for select to authenticated
  using (exists (select 1 from messages m join spaces s on s.id = m.space_id join space_members sm on sm.space_id = s.id
    where m.id = message_reactions.message_id and sm.employee_id = current_employee_id()));
create policy reactions_write on message_reactions for all to authenticated
  using (employee_id = current_employee_id()) with check (employee_id = current_employee_id());

-- Announcements
alter table announcements enable row level security;
alter table announcement_reads enable row level security;

create policy announcements_read on announcements for select to authenticated
  using (org_id = current_org_id() and (
    publish_at <= now() and (expires_at is null or expires_at > now()) and (
      target_roles is null or target_roles = '{}' or current_role_name() = any(target_roles)
      or target_department_ids is null or target_department_ids = '{}' or exists (
        select 1 from employees e where e.id = current_employee_id() and e.department_id = any(target_department_ids)
      )
      or target_employee_ids is null or target_employee_ids = '{}' or current_employee_id() = any(target_employee_ids)
    )
  ));
create policy announcements_write on announcements for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy ar_read on announcement_reads for select to authenticated using (employee_id = current_employee_id());
create policy ar_write on announcement_reads for insert to authenticated
  with check (employee_id = current_employee_id() and exists (
    select 1 from announcements a where a.id = announcement_reads.announcement_id and a.org_id = current_org_id()
  ));

-- Meetings
alter table meetings enable row level security;
alter table meeting_attendees enable row level security;
alter table calendar_sync enable row level security;

create policy meetings_read on meetings for select to authenticated
  using (org_id = current_org_id() and (
    organizer_id = current_employee_id()
    or exists (select 1 from meeting_attendees ma where ma.meeting_id = meetings.id and ma.employee_id = current_employee_id())
    or has_perm('projects.view_all')
  ));
create policy meetings_write on meetings for all to authenticated
  using (org_id = current_org_id() and (organizer_id = current_employee_id() or has_perm('projects.manage')))
  with check (org_id = current_org_id() and (organizer_id = current_employee_id() or has_perm('projects.manage')));

create policy ma_read on meeting_attendees for select to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id and m.org_id = current_org_id()));
create policy ma_write on meeting_attendees for all to authenticated
  using (employee_id = current_employee_id() or has_perm('projects.manage'))
  with check (employee_id = current_employee_id() or has_perm('projects.manage'));

create policy cs_read on calendar_sync for select to authenticated using (employee_id = current_employee_id());
create policy cs_write on calendar_sync for all to authenticated using (employee_id = current_employee_id()) with check (employee_id = current_employee_id());

-- Documents
alter table documents enable row level security;
alter table document_shares enable row level security;

create policy docs_read on documents for select to authenticated
  using (org_id = current_org_id() and (
    employee_id = current_employee_id()
    or created_by = current_employee_id()
    or exists (select 1 from document_shares ds where ds.document_id = documents.id and ds.shared_with_employee_id = current_employee_id())
    or exists (select 1 from document_shares ds join employees e on e.role = ds.shared_with_role where ds.document_id = documents.id and e.id = current_employee_id())
    or has_perm('settings.manage')
  ));
create policy docs_write on documents for insert to authenticated
  with check (org_id = current_org_id() and created_by = current_employee_id());
create policy docs_update on documents for update to authenticated
  using (org_id = current_org_id() and (created_by = current_employee_id() or has_perm('settings.manage')))
  with check (org_id = current_org_id());

create policy ds_read on document_shares for select to authenticated
  using (org_id = current_org_id() and (
    shared_with_employee_id = current_employee_id()
    or created_by = current_employee_id()
    or has_perm('settings.manage')
  ));
create policy ds_write on document_shares for all to authenticated
  using (org_id = current_org_id() and (created_by = current_employee_id() or has_perm('settings.manage')))
  with check (org_id = current_org_id() and created_by = current_employee_id());

-- Incidents & SLA
alter table incident_policies enable row level security;
alter table incidents enable row level security;
alter table incident_updates enable row level security;
alter table incident_sla enable row level security;

create policy ip_read on incident_policies for select to authenticated using (org_id = current_org_id());
create policy ip_write on incident_policies for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy incidents_read on incidents for select to authenticated
  using (org_id = current_org_id() and (
    reporter_id = current_employee_id()
    or assignee_id = current_employee_id()
    or has_perm('settings.manage')
    or has_perm('reports.view_org')
  ));
create policy incidents_write on incidents for insert to authenticated
  with check (org_id = current_org_id() and reporter_id = current_employee_id());
create policy incidents_update on incidents for update to authenticated
  using (org_id = current_org_id() and (
    reporter_id = current_employee_id()
    or assignee_id = current_employee_id()
    or has_perm('settings.manage')
  ))
  with check (org_id = current_org_id());

create policy iu_read on incident_updates for select to authenticated
  using (org_id = current_org_id() and exists (
    select 1 from incidents i where i.id = incident_updates.incident_id and i.org_id = current_org_id()
  ));
create policy iu_write on incident_updates for insert to authenticated
  with check (org_id = current_org_id() and author_id = current_employee_id() and exists (
    select 1 from incidents i where i.id = incident_updates.incident_id and i.org_id = current_org_id()
  ));

create policy is_read on incident_sla for select to authenticated
  using (org_id = current_org_id() and exists (
    select 1 from incidents i where i.id = incident_sla.incident_id and i.org_id = current_org_id()
  ));

-- Automations
alter table automations enable row level security;
alter table automation_actions enable row level security;
alter table automation_runs enable row level security;

create policy automations_read on automations for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));
create policy automations_write on automations for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy aa_read on automation_actions for select to authenticated
  using (exists (select 1 from automations a where a.id = automation_id and a.org_id = current_org_id()));
create policy aa_write on automation_actions for all to authenticated
  using (exists (select 1 from automations a where a.id = automation_id and a.org_id = current_org_id() and has_perm('settings.manage')))
  with check (exists (select 1 from automations a where a.id = automation_id and a.org_id = current_org_id() and has_perm('settings.manage')));

create policy ar_read on automation_runs for select to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'));

-- Scholars
alter table scholar_batches enable row level security;
alter table scholars enable row level security;
alter table scholar_evaluations enable row level security;

create policy sb_read on scholar_batches for select to authenticated using (org_id = current_org_id());
create policy sb_write on scholar_batches for all to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage'))
  with check (org_id = current_org_id() and has_perm('settings.manage'));

create policy scholars_read on scholars for select to authenticated
  using (org_id = current_org_id() and (
    assigned_mentor_id = current_employee_id()
    or has_perm('people.view_all')
    or has_perm('people.view_team')
  ));
create policy scholars_write on scholars for all to authenticated
  using (org_id = current_org_id() and has_perm('people.manage'))
  with check (org_id = current_org_id() and has_perm('people.manage'));

create policy se_read on scholar_evaluations for select to authenticated
  using (org_id = current_org_id() and (evaluator_id = current_employee_id() or has_perm('people.view_all')));
create policy se_write on scholar_evaluations for insert to authenticated
  with check (org_id = current_org_id() and evaluator_id = current_employee_id() and has_perm('people.view_all'));

-- Notification preferences
alter table notification_preferences enable row level security;
create policy np_read on notification_preferences for select to authenticated using (employee_id = current_employee_id());
create policy np_write on notification_preferences for all to authenticated using (employee_id = current_employee_id()) with check (employee_id = current_employee_id());

-- FCM tokens
alter table fcm_tokens enable row level security;
create policy fcm_tokens_read on fcm_tokens for select to authenticated using (employee_id = current_employee_id());
create policy fcm_tokens_write on fcm_tokens for all to authenticated using (employee_id = current_employee_id()) with check (employee_id = current_employee_id());

-- ---------------------------------------------------------------------------
-- Helper functions for realtime
-- ---------------------------------------------------------------------------

-- Get spaces for current employee (for realtime subscription filter)
create or replace function my_spaces() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from spaces s
  left join space_members sm on sm.space_id = s.id and sm.employee_id = current_employee_id()
  where s.org_id = current_org_id()
    and (s.visibility = 'PUBLIC' or s.owner_id = current_employee_id() or sm.employee_id is not null)
$$;

-- Get unread message counts per space
create or replace function my_unread_counts() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_object_agg(space_id::text, cnt) from (
    select m.space_id, count(*) as cnt
    from messages m
    join space_members sm on sm.space_id = m.space_id and sm.employee_id = current_employee_id()
    where m.org_id = current_org_id()
      and m.sender_id <> current_employee_id()
      and m.deleted_at is null
      and not exists (select 1 from message_reactions mr where mr.message_id = m.id and mr.employee_id = current_employee_id())  -- simplified: no explicit read receipts yet
    group by m.space_id
  ) x
$$;

-- Check if employee can access a space
create or replace function can_access_space(p_space uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from spaces s
    left join space_members sm on sm.space_id = s.id and sm.employee_id = current_employee_id()
    where s.id = p_space and s.org_id = current_org_id()
      and (s.visibility = 'PUBLIC' or s.owner_id = current_employee_id() or sm.employee_id is not null)
  )
$$;

-- ---------------------------------------------------------------------------
-- Realtime publication (run in Supabase dashboard → Replication)
-- ---------------------------------------------------------------------------
-- alter publication supabase_realtime add table messages, message_reactions, announcements, spaces, space_members, meetings, meeting_attendees, incidents, incident_updates, documents, document_shares;
-- Note: Run the above in Supabase SQL editor to enable realtime for these tables.

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function my_spaces() from public, anon, authenticated;
revoke all on function my_unread_counts() from public, anon, authenticated;
revoke all on function can_access_space(uuid) from public, anon, authenticated;
grant execute on function my_spaces() to authenticated;
grant execute on function my_unread_counts() to authenticated;
grant execute on function can_access_space(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- FCM helper function
-- ---------------------------------------------------------------------------
-- Update token usage timestamp (called from server-side functions)
create or replace function touch_fcm_token_used(p_token text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update fcm_tokens set last_used_at = now() where token = p_token;
$$;
revoke all on function touch_fcm_token_used(text) from public, anon, authenticated;
grant execute on function touch_fcm_token_used(text) to authenticated;