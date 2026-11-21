# Block 05 — Main VSM Operations Portal

**Status:** Source implementation complete; database/RLS/typecheck/build verification pending.  
**Migration:** `0011_operations_communication.sql`  
**Goal:** Make OPDesk the main VSM Growth daily operations portal by bringing delivery work, project coordination, internal conversations and announcements into the same protected application as HRMS, attendance, payroll, Finance and CRM.

## 1. Projects & delivery

- `/projects` provides an RLS-scoped project list and manager-only workspace creation.
- `/projects/[id]` provides project details, team roster, milestones, task roll-up, activity updates/risks/decisions, time logging and finance-linked actuals.
- Project managers can add members to the roster; the removal UI is not implemented. Adding members to an existing project chat also adds them to the chat roster.
- Milestones support title, description, owner, due date and PENDING / IN_PROGRESS / AT_RISK / COMPLETED status.
- Existing tasks stay in `tasks`; project workspaces do not duplicate the task ledger.
- Time entries are employee-submitted, dated, limited to 24 hours per entry, note-backed and marked billable/non-billable. A different authorized manager approves/rejects via `decide_project_time_entry`; the decision is audited and direct update is blocked by the lack of an update policy.
- Finance-authorized project viewers see paid project expenses and actual invoice cash receipts. Project cost/revenue is read from Finance records rather than copied into another ledger.
- `/projects/time` is the authorized time approval queue.

## 2. Communication

- `/chat` lists joined conversations, public/department channels, direct-message creation and private group creation.
- `/chat/[id]` renders messages and supports threaded replies, reactions, file attachments and read timestamps.
- Direct conversations are opened by `open_direct_conversation`, which validates that both employees belong to the caller's organization and deterministically reuses an existing conversation.
- Project managers can create a project chat; the project roster is synchronized to the project channel when members are added.
- Message attachments use the private `chat-files` bucket (15 MB; PDF, JPEG, PNG, WebP, TXT and ZIP). The API creates short-lived signed URLs only after RLS membership checks.
- `/announcements` supports company-wide, department and project audiences, pinning, and in-app notifications.
- Message and announcement triggers create in-app notifications for relevant recipients.
- The chat UI refreshes through authenticated polling every four seconds. The table is registered with `supabase_realtime` for a future authenticated realtime client, but WebSocket subscriptions, presence and typing indicators are not yet wired. The existing HttpOnly session design is preserved; no browser auth token is exposed.

## 3. New schema and access controls

- Project: `project_milestones`, `project_updates`, `project_time_entries`.
- Communication: `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_reactions`, `chat_attachments`, `company_announcements`.
- All new tables enable RLS. Policies enforce permission checks, channel membership, project membership and employee self-service scope.
- Organization guard triggers validate employee, project, department, channel, message, attachment and related IDs across tenant boundaries.
- Private group membership cannot be self-joined. Public channels and the employee's own department channels may be joined. Direct channels are only created by the RPC.
- Time approvals are transaction-safe RPC-only and cannot be self-approved.
- Message/announcement notifications use the existing `notifications` table.
- The permission seeder is replaced so new organizations created after this migration receive the same project/communication defaults. `src/lib/perms.ts` is updated to expose the new permissions.

## 4. New routes

- `/projects`
- `/projects/[id]`
- `/projects/time`
- `/chat`
- `/chat/[id]`
- `/announcements`
- `/api/chat/[channelId]/messages` (authenticated message polling + signed attachment URLs)
- `/api/chat/[channelId]/read` (authenticated read timestamp update)

## 5. Validation and known limitations

- TypeScript source parser pass: all 104 `.ts`/`.tsx` files were parsed with zero syntax diagnostics.
- Full `npm run typecheck` cannot be verified because dependencies are not installed in this environment. `tsc --noEmit` currently reports missing Next/React/Supabase/Vitest modules and resulting JSX type errors; this is not a passing typecheck.
- `npm test` was attempted but `vitest` is not installed; `npm run build` was attempted but `next` is not installed; `npm run test:db` was attempted but `psql` is not installed. PostgreSQL and Docker executables are unavailable, so migration/RLS tests remain unverified.
- No production Supabase database or Vercel deployment was changed.
- WebSocket chat, typing/presence, push notifications, task subtasks/dependencies/recurrence, project document library, deliverable versioning, project roster removal UI, client 360, advanced capacity planning and forecast profitability remain future work.

## 6. Required release checks

1. Run `npm ci` from the lockfile in a network-enabled environment.
2. Run `npm test`, `npm run typecheck`, `npm run build`.
3. Run `npm run test:db` against scratch PostgreSQL with migrations 0001–0011. The security suite now checks project membership/time approval, public-channel join, private group isolation and message send/read access.
4. In Supabase staging, verify private chat file signed URLs, group isolation, cross-organization channel/member denial, direct-message creation, announcement notifications, and the four-second polling route.
5. Apply migration 0011 before deploying the new routes. Confirm the private `chat-files` bucket and its 15 MB MIME restrictions.
