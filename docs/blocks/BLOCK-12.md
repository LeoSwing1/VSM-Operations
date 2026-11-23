# Block 12 — Super Admin Console, Roles Matrix & Chat Workspace Refresh

## Scope delivered

### Super Admin administration
- Added `/settings/admin`, restricted to the `SUPER_ADMIN` role after the existing `roles.manage` permission gate.
- Shows live counts from the organisation's role settings, role permission grants and employee directory.
- Provides direct navigation to access control, audit logs, workflow automation, integrations and chat moderation.
- Added a Super Admin console entry to the Admin navigation group; it is not shown to other roles.

### Roles & Permissions
- Reframed `/settings/access` as **Roles & Permissions**, with authority, database persistence and configurable-role summary cards.
- Reworked the permission matrix into compact, horizontally scrollable rows with sticky permission labels and accessible switch controls.
- Preserved the existing role hierarchy, sensitive permission restrictions, per-role editability, database-backed save action and audit behavior.
- Super Admin remains a fixed full-access authority and is not configurable as an ordinary role.

### Team chat
- Rebuilt `/chat` as an inbox-style workspace with conversation rows, channel discovery, direct-message creation and collapsible channel/group creation flows.
- Reworked message presentation into aligned sender/recipient bubbles with clearer timestamps, reply context, attachment links, reactions, reporting and reply actions.
- Preserved the existing authenticated message API, channel membership checks, report/reaction actions, private attachment handling and four-second refresh behavior.

## Files changed
- `src/app/(app)/settings/admin/page.tsx` (new)
- `src/app/(app)/settings/access/page.tsx`
- `src/components/shell.tsx`
- `src/app/(app)/chat/page.tsx`
- `src/components/chat/chat-room.tsx`
- `README.md`, `RUNBOOK.md`, `CLAUDE.md`

## Security and data behavior
- No permission was broadened by this block. Super Admin route checks use the authenticated role; access matrix saves continue through the existing permission-checked server action and RLS policies.
- No new database tables or migrations were required.
- Admin console counts are queried from the current organisation-scoped Supabase context; no sample or fabricated data is inserted.
- Chat data remains membership/RLS controlled. Moderators continue to use the existing read-only review path.

## Known limitations
- This is a UI and admin-navigation milestone, not a new platform-level multi-tenant super-admin control plane. It administers the currently authenticated organisation only.
- Chat still uses authenticated four-second polling, not WebSocket delivery; presence, typing indicators, push notifications, message editing/deletion UI and advanced search are not included here.
- Channel unread counts are not yet calculated in the new inbox list.
- Role matrix displays every configured role and may require horizontal scrolling when an organisation has many roles.
- No production Supabase migration or Vercel deployment was performed.

## Validation
- Static syntax validation is run against changed TypeScript/TSX files.
- Full Next.js build, application typecheck, Vitest suite and live Supabase RLS tests require dependencies and a configured database. The current workspace does not contain `node_modules`, so those checks cannot be honestly reported as passing.
