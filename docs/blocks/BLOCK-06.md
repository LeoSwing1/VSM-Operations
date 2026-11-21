# Block 06 — Chat security and roles & permissions

**Status:** Source implemented; database, RLS, typecheck and production-build verification pending.  
**Migration:** `supabase/migrations/0012_chat_security_access_controls.sql`  
**Previous baseline:** Blocks 01–05; no production environment was changed.

## 1. Chat security hardening

### Membership and channel lifecycle
- Added `manage_chat_member(channel, employee, action, role)` as the controlled path for adding/removing members and assigning `MEMBER`/`MODERATOR` roles.
- The RPC validates the caller, organisation, active target employee, channel state and channel owner/moderator or channel-management authority.
- Direct-message membership is immutable after the direct conversation is opened.
- Direct table writes for membership insert/delete/update are revoked. Authenticated insert remains available only for self-joining a public channel or the caller's own department channel under RLS. `last_read_at` is the only directly mutable membership column.
- Channel creators/owners and authorized channel administrators can add/remove members and assign moderators. The channel owner cannot be removed; the owner role cannot be reassigned through the role-change path.
- Members can leave non-DM channels. Owners must archive their channel instead.
- `archive_chat_channel(channel)` archives through a permission-checked RPC and records an event.

### Message reporting and moderation
- Added `chat_message_reports` with a one-report-per-user/message constraint, enumerated reasons, optional context, status and reviewer/resolution fields.
- Members can report another member's message from the conversation UI. Self-report is blocked by RLS and a database trigger.
- Added `/settings/chat-moderation`, restricted to `communication.moderate`, with an open report queue, review/dismiss actions, message hiding/restoration and recent moderation activity. Moderators can inspect a reported conversation in read-only mode without joining it; private message/attachment access is limited to channels with an OPEN, REVIEWING or ACTIONED report.
- `moderate_chat_message` handles HIDE/RESTORE and resolves open reports when a message is hidden. `review_chat_report` handles REVIEWING/DISMISSED.
- `chat_moderation_events` records membership, channel archive, report review and message moderation operations. It is readable only by moderators.

## 2. Roles and permissions

- `/settings/access` remains the canonical role and permission administration screen; `/settings/roles` remains a compatibility redirect.
- Added `communication.channel_manage` and `communication.moderate` to the permission catalogue.
- These are treated as sensitive grants in both TypeScript and PostgreSQL. Lower-level role managers cannot delegate them; the Super Admin can grant them to eligible roles.
- Existing role hierarchy, no-self-escalation, role level management, employee overrides, effective-permission resolution and audit triggers remain the source of truth.
- Default channel-management and moderation assignments are seeded for Admin, HR Manager and Operations Manager. Super Admin continues to receive all permissions implicitly.
- A trigger seeds these new permissions for organizations created after migration 0012.

## 3. Updated application surfaces

- Conversation page: displays member roles; eligible owners/admins can add/remove members, assign moderator roles and archive channels; ordinary members can leave non-DM channels.
- Chat message component: adds a report form to messages authored by someone else.
- Chat home, Access control and application navigation: expose the moderation queue only when the caller has the moderation permission.
- Existing private `chat-files` bucket, short-lived signed URLs, membership-gated message API and four-second polling are retained.

## 4. Security boundaries

- UI visibility is not authorization. Server actions call `requirePerm`; sensitive state changes are repeated and enforced inside SQL RPCs and RLS.
- Reports are visible to the reporter and authorized moderators only.
- Moderation event writes have no authenticated insert policy; security-definer functions write them.
- Channel membership RPCs enforce same-organization active employee targets; department-channel additions are department-scoped and project-channel additions must already be on the project roster.
- No service-role key is introduced into client code.

## 5. Not included

- WebSocket push, online presence, typing indicators, message delivery guarantees or mobile push.
- Message retention policies, legal holds, e-discovery exports or automated data-loss prevention.
- Full channel-level policy templates, external/guest users, message edit history and appeal workflow.
- Automatic moderation/AI classification.

Chat still refreshes by authenticated polling every four seconds; it is not WebSocket realtime.

## 6. Validation and deployment

- `supabase/all_migrations.sql` is regenerated to include migrations 0001–0012.
- SQL security coverage is extended for reporting, sensitive permission classification, member self-escalation denial, private-channel moderator scope and moderator hide/report resolution.
- Source checks can validate TypeScript syntax and migration concatenation, but the full TypeScript check, Vitest suite, production build and PostgreSQL RLS tests require dependencies and a PostgreSQL/Supabase-compatible test database.
- Apply migration 0012 only after migrations 0001–0011. Run the full DB security suite in a disposable environment before production rollout.
- No production Supabase database, user role, storage object or Vercel deployment was changed in this development step.
