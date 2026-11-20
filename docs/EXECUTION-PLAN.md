# VSM Growth Operations — Execution Plan (10 blocks)

One file for the whole build. Each block is delivered, reviewed by the owner, and approved **before** the next one starts.
Every block ships with: migration(s) that apply cleanly on top of the previous ones, RLS security tests, unit tests, a clean typecheck and production build, and a `docs/blocks/BLOCK-NN.md` with exact run steps.

| # | Block | Main outcome | Depends on | Status |
|---:|---|---|---|---|
| 1 | Security & notification foundation | HttpOnly sessions, email preferences, daily digest, Integrations panel v1, shifts & holidays | — | ✅ Delivered: awaiting approval |
| 2 | Chat core | Direct chats, groups, spaces & channels in real time | 1 | ⏳ Next |
| 3 | Chat extras & files | Attachments, reactions, presence, typing, announcements | 2 | Planned |
| 4 | Governance | Approval delegation, warnings, team roles, escalation | 1 | Planned |
| 5 | Work depth & documents | Task comments/evidence/subtasks, milestones, Client 360, documents | 3 | Planned |
| 6 | Meetings & calendar | Meetings, notes, action items, Google Calendar + Meet | 3 | Planned |
| 7 | Training & VSM Scholars | Courses, lessons, assessments, certificates, Scholars bridge | 3 | Planned |
| 8 | Automation engine & command center | Event bus, triggers, escalation, live attention queue | 4, 6 | Planned |
| 9 | External channels & reliability | WhatsApp, push, Slack/Teams, webhooks, Meta leads, Razorpay, incidents & SLA | 8 | Planned |
| 10 | Flutter mobile app | Employee + manager app on the same backend, FCM/APNs | 2–9 | Planned |

**Rules for every block** (from `CLAUDE.md`): security in Postgres RLS; the app queries as the signed-in user; no table used before its migration exists; no deleted working code; append-only migrations; no policy recursion; salary never visible through the reporting line; emails only via `enqueue_email()`; nothing shown as "connected" without a real test; never claim a test that wasn't run.

**How you apply any block** (your database already has the earlier migrations):
1. Supabase → SQL Editor → paste **only that block's new migration file(s)** → Run → expect "Success".
2. Copy the new code over your folder (keep `.env.local`) → `npm install` → `npm test` → `npm run build`.
3. Add any new env vars from the block to `.env.local` and to Vercel.
4. Work through that block's acceptance checklist → reply **"approved"** or list what failed.

---

## Block 1: Security & notification foundation ✅ Delivered

**Goal:** close the security gap found in the OPDesk review and give everyone control over email before chat creates more of it.

**Features**
- Session cookies forced to HttpOnly + SameSite=Lax (+ Secure in production); the browser Supabase client is removed.
- Email preferences per category (Immediately / Daily summary / Off), enforced inside `enqueue_email()`. In-app is always kept, SYSTEM can never be muted, chat defaults to the summary.
- Daily summary email at 7 pm IST, at most one per person per day.
- Integrations panel v1 showing real results only: database check, Brevo test send, cron heartbeat, website-intake status, outbox counts, recent failures, Retry failed, and the list of planned integrations by block.
- Shifts & holidays admin (timings, grace, full/half-day hours, weekly offs; yearly holiday list).

**Database:** `0007_notification_prefs_integrations.sql`: `notification_preferences`, `notification_digest_items`, `integration_status`; functions `enqueue_email` (rewritten), `build_daily_digests`, `record_integration_test`, `record_integration_event`, `retry_failed_emails`.
**Screens:** `/notifications/preferences`, `/settings/integrations`, `/settings/attendance`. **Routes:** `/api/cron/digest`.
**Env:** none new (uses `CRON_SECRET`, `BREVO_API_KEY`, `EMAIL_FROM`).
**Verified:** 135 DB checks, 31 unit tests, typecheck, build.

**Acceptance checklist**
- [ ] Login cookie shows **HttpOnly** in DevTools → Application → Cookies
- [ ] Email preference saved and still set after reload
- [ ] Integrations → Database check shows HEALTHY with a ms value
- [ ] Integrations → Send test email arrives (or shows Brevo's exact error)
- [ ] A holiday added in Shifts & holidays shows as HOLIDAY in Attendance

---

## Block 2: Chat core

**Goal:** a proper internal messenger that replaces WhatsApp groups for office work, with membership enforced by the database.

**Features**
- **Direct messages** (1:1, created on first message, never duplicated per pair).
- **Groups**: department, project, team, temporary and custom; name, description, image; admins and members; join rules (invite-only / open within the org); add/remove members; leave group.
- **Spaces & channels**: persistent workspaces (General, Announcements, HR, Development, Sales, Marketing, Operations, VSM Scholars, Management, per-project). Channel types: discussion, announcements (only admins post), project updates, Q&A, task coordination, restricted management.
- **Messages**: history with infinite scroll, date separators, reply-to (quoted), edit within 15 min and delete own (soft delete, "message deleted" shown), admins can remove any message (audited), pin/unpin, links auto-detected.
- **Real-time** via Supabase Realtime: new messages, edits, deletes appear live without refresh.
- **Unread counts** per conversation, plus a total badge in the sidebar; **read receipts** (seen by N / seen at); mark conversation read.
- **Search** across messages the user can see (Postgres full-text).
- Notifications: in-app for mentions and DMs; email follows preferences (CHAT defaults to the daily summary).

**Database:** `0008_chat_core.sql`: `conversations` (kind DIRECT/GROUP/CHANNEL), `spaces`, `conversation_members` (role OWNER/ADMIN/MEMBER, last_read_at, muted), `messages` (reply_to, edited_at, deleted_at, pinned_at, tsvector), `message_reads`. SECURITY DEFINER helpers `is_conversation_member()` / `can_post()` (no policy recursion). RPCs: `start_direct_chat`, `create_group`, `create_space`, `create_channel`, `add_members`, `remove_member`, `send_message`, `edit_message`, `delete_message`, `pin_message`, `mark_read`. Realtime publication on `messages` with RLS. Rate limit 30 messages per minute per user.
**Permissions:** `chat.create` (groups/spaces), `chat.manage` (any group's members, moderation), `chat.announce` (post in announcement channels).
**Screens:** `/chat` (conversation list + thread, responsive two-pane), `/chat/groups`, `/chat/spaces`, new-chat dialog (DIRECT / GROUP / SPACE).

**Security tests to add:** a non-member can't read, list, search or receive realtime for a conversation; can't post; edit/delete limited to own message within policy; announcement channel blocks non-admin posts; removed member loses history access going forward; cross-org isolation; DM is never duplicated; rate limit.

**Acceptance checklist**
- [ ] Two browsers (you + a test employee): a DM appears live on the other side within 2 s
- [ ] Create a group, add/remove a member; the removed member can no longer open it
- [ ] Create a space with an Announcements channel; an employee can read but not post
- [ ] Reply, edit, delete, pin work; unread badge clears when the chat is opened
- [ ] Search finds a message only for people in that conversation

---

## Block 3: Chat extras & files

**Goal:** finish chat to production level and introduce secure file storage, which later blocks reuse.

**Features**
- **Supabase Storage** private buckets: `chat`, `documents`, `avatars`. Uploads checked server-side (type allow-list, max 25 MB), served only through **signed URLs that expire** (5 min), access audited.
- **Attachments** in chat: images with previews and a lightbox, documents (PDF, DOCX, XLSX…) with an icon and size, multiple files per message.
- **Reactions** (emoji set), **presence** (online / last seen), **typing indicator** (5-second lease), **link previews** (title + domain, fetched server-side with SSRF rules).
- **Member administration**: promote/demote admin, group image, description.
- **Announcements**: org-wide or by department/role, with priority (normal/important/critical), publish and expiry dates, **read acknowledgement** ("I've read this") and a delivery/ack tracker for the sender.
- **Profile photos** for employees (People and chat avatars).

**Database:** `0009_files_chat_extras.sql`: `files` (bucket, path, size, mime, owner, scope), `message_attachments`, `message_reactions`, `presence` (heartbeat, expires_at), `announcements`, `announcement_audience`, `announcement_acks`. Storage RLS on `storage.objects` mirrors conversation membership.
**Permissions:** `announcements.publish`.
**Screens:** attachment picker in chat, `/announcements` (feed + composer + tracker), avatar upload in profile.

**Security tests to add:** a file in a chat is unreadable by non-members (DB and storage); signed URL only issued to members; uploads over the limit or with blocked types rejected; announcement audience targeting is respected; acknowledgements are your own only.

**Acceptance checklist**
- [ ] Send an image and a PDF; preview works; a non-member gets "not found" for the file
- [ ] Typing indicator and online dot appear for the other person
- [ ] Publish an "important" announcement to one department; only they see it; the tracker shows who acknowledged

---

## Block 4: Governance

**Goal:** continuity and accountability: approvals never get stuck, and disciplinary actions are controlled.

**Features**
- **Approval delegation**: delegate a specific action type (leave, attendance correction, task review, payroll approval, warning) to a named person for a date range. Delegates see items in their Approvals inbox. Delegation never widens permanent permissions, is audited, and expires automatically. You can't delegate what you can't approve yourself.
- **Warnings / disciplinary notes**: drafted by a manager, routed to a nominated approver (an active Manager, HR Manager or Super Admin) before being issued. The employee sees issued warnings and can add a response. Severity, category and documents. Never visible to peers.
- **Team roles**: teams within departments, Team Lead and **Assistant Team Lead** with approval by the manager.
- **Escalation**: approvals pending longer than N hours (configurable per type) escalate to the next level up the hierarchy, with notification and audit.
- Unified Approvals inbox gains: delegated items, warnings, team-role requests, filters, bulk view.

**Database:** `0010_governance.sql`: `approval_delegations`, `warnings`, `warning_responses`, `teams`, `team_members` (role LEAD/ASSISTANT_LEAD/MEMBER), `approval_escalation_rules`. Decision RPCs updated to accept active delegates; compare-and-set on every decision.
**Permissions:** `warnings.issue`, `warnings.approve`, `teams.manage`, `approvals.delegate`.
**Screens:** `/settings/approval-delegations`, `/warnings`, team management inside People, updated `/approvals`.

**Security tests to add:** a delegate can decide only the delegated type within dates; an expired delegation stops working; nobody approves their own warning or their own leave via delegation; an employee sees only their own warnings; double decisions are blocked.

**Acceptance checklist**
- [ ] Delegate leave approval to a colleague for 3 days; they approve a request; after expiry they can't
- [ ] Draft a warning, the approver approves it, the employee sees it and responds
- [ ] A request left pending past its threshold escalates and notifies the next level

---

## Block 5: Work depth & documents

**Goal:** take tasks and projects from basic to agency-grade, and give HR a secure document library.

**Features**
- **Tasks**: comments with @mentions, **evidence attachments** on submission, **subtasks** (checklist with progress), **dependencies** (blocked-by; a task can't start until its blockers finish), time logs, calendar view, filters.
- **Projects**: milestones and deliverables, progress %, project timeline (Gantt-style), project files, activity history, project groups linked to chat.
- **Client 360**: contacts, relationship manager, projects, enquiries, proposals, contracts, documents, meetings, notes, follow-ups, communication history and status. CRM leads convert into it.
- **Document library**: employee documents (ID proofs, offer letters, contracts, certificates), client documents, project files; version history; access rules (owner, HR, specific roles); preview, download, audit trail; no public URLs.
- **Payslip PDFs** generated and stored in the employee's private documents.

**Database:** `0011_work_documents.sql`: `task_comments`, `task_attachments`, `subtasks`, `task_dependencies`, `time_logs`, `milestones`, `client_contacts`, `client_notes`, `proposals`, `documents`, `document_versions`, `document_access`.
**Permissions:** `documents.manage`, `documents.view_hr`, `clients.view_all` (existing).
**Screens:** task drawer (comments, files, subtasks), `/projects/[id]` (timeline, milestones), `/clients/[id]` (Client 360), `/documents`.

**Security tests to add:** an employee's HR documents are visible only to them and HR; a client document is visible only to the client's team; task attachments follow task visibility; version history is preserved on replace.

**Acceptance checklist**
- [ ] Comment with @mention notifies the person; evidence file attached at "Submit for review"
- [ ] A dependent task can't move to In progress until its blocker is completed
- [ ] Upload an offer letter to an employee; another employee can't see it; HR can
- [ ] Convert a won lead into a client and see it in Client 360

---

## Block 6: Meetings & calendar

**Goal:** meetings stop living in WhatsApp: agenda, attendance, notes and action items all tracked.

**Features**
- Meetings: title, agenda, description, start/end (IST), location or online link, participants (employees and optional client contacts), recurring meetings.
- **Meeting attendance** (separate from office attendance): self check-in, organiser marks present/absent/late.
- **Notes and action items**: action items become tasks with owner and deadline.
- Reminders (in-app + email per preference) at 1 day and 15 min before.
- **Calendar view** (day/week/month) combining meetings, leave, holidays and task deadlines.
- **Google Calendar + Meet** (optional per user): connect via OAuth with signed, expiring state; two-way sync of VSM meetings; auto-created Meet link; leave shown as out-of-office. Status in the Integrations panel only after a successful sync.

**Database:** `0012_meetings_calendar.sql`: `meetings`, `meeting_participants`, `meeting_attendance`, `meeting_notes`, `meeting_action_items`, `calendar_connections` (encrypted refresh token, per user).
**Env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT`, `TOKEN_ENCRYPTION_KEY`.
**Screens:** `/meetings`, `/meetings/[id]`, `/calendar`, Google connect button in profile.

**Security tests to add:** only participants and the organiser see a meeting and its notes; only participants self-check-in; calendar tokens are never readable by any client role.

**Acceptance checklist**
- [ ] Create a meeting with 3 people; each gets the invite and reminder
- [ ] Self check-in works; the organiser sees the attendance list
- [ ] An action item becomes a task assigned to its owner
- [ ] Connect Google: the meeting appears in Google Calendar with a Meet link

---

## Block 7: Training & VSM Scholars

**Goal:** onboarding and upskilling for staff, plus a secure bridge to VSM Scholars, without mixing student data into HR.

**Features**
- **Courses, programs and lessons** (video link, document, text), **assessments** (MCQ with pass mark), enrolment (self or assigned by a manager), progress tracking, **certificates** (PDF, verifiable code).
- Onboarding paths assigned automatically to new joiners by role/department.
- Training progress feeds the performance engine (new optional "Training" dimension).
- **VSM Scholars bridge**: batches, trainers, students, enrolments, schedules, attendance, assignments, certificates and internship records via a secure API. Student data lives in a separate schema with its own RLS, never in `employees`. Staff trainers see only their batches.

**Database:** `0013_training_scholars.sql`: `courses`, `lessons`, `enrolments`, `lesson_progress`, `assessments`, `assessment_attempts`, `certificates`; schema `scholars` (`students`, `batches`, `batch_trainers`, `student_enrolments`, `student_attendance`, `assignments`, `internships`).
**Env:** `SCHOLARS_API_URL`, `SCHOLARS_API_KEY` (if Scholars runs separately).
**Permissions:** `training.manage`, `scholars.view`, `scholars.manage`.
**Screens:** `/training`, `/training/[course]`, `/scholars`, certificate verify page.

**Security tests to add:** employees see only their enrolments and results; trainers see only their batches; no employee-table join exposes student data; assessment answers aren't readable before submission.

**Acceptance checklist**
- [ ] Assign a course; the employee completes lessons and passes the test; the certificate downloads
- [ ] New joiner gets the onboarding path automatically
- [ ] A Scholars trainer sees their batch only; an employee without access sees nothing

---

## Block 8: Automation engine & command center

**Goal:** the system nudges people so managers don't have to.

**Features**
- **Domain event bus** (`domain_events`): every important action emits an event (task assigned/overdue, leave requested, punch missing, lead created…).
- **Allow-listed triggers** (no custom code, ever): missing clock-in by grace + N min, late arrival, missing clock-out, missing daily update by 7 pm, task deadline in 24 h, task overdue, milestone approaching, lead follow-up due, meeting in 15 min, leave pending > N h, payroll approval pending, new announcement, integration failure.
- Per rule: conditions (department, role, priority), target audience (person, manager, HR, role), delay, escalation step, channels (in-app, email, later WhatsApp/push), quiet hours, on/off.
- **Idempotent runs** (one notification per rule per subject per window), retry policy, **execution history** with outcome.
- **Command center** for managers: live attention queue (not clocked in, late, overdue tasks, blocked tasks, pending approvals, follow-ups due), refreshed in real time, each item with a one-click action.
- Dashboard date and department filters; drill-downs.

**Database:** `0014_automation.sql`: `domain_events`, `automation_rules`, `automation_runs`, `automation_suppressions`; scheduler via Supabase `pg_cron` (preferred) or `/api/cron/automation` every 5 min.
**Permissions:** `automation.manage`.
**Screens:** `/settings/automation` (rules, toggles, history), `/command-center`.

**Security tests to add:** rules can only target people within the creator's scope; a rule never fires twice for the same subject/window; disabled rules don't run; employees can't read other people's events.

**Acceptance checklist**
- [ ] Don't clock in: at 9:25 the employee gets a reminder, at 10:00 the manager does
- [ ] An overdue task appears in the command center and the reminder fires once
- [ ] Execution history shows each run with its outcome

---

## Block 9: External channels & reliability

**Goal:** reach people where they are and run every integration with real monitoring.

**Features**
- **WhatsApp** (Meta Cloud API, or Twilio): approved templates for lead acknowledgement, follow-up reminders, leave decision, payslip-ready link (no amounts), attendance and meeting reminders, critical alerts; opt-in per employee; delivery status callbacks.
- **Web push** (browser notifications, VAPID) per category preference.
- **Slack / Microsoft Teams** incoming webhooks with an allow-listed event set.
- **Outbound webhooks** (Zapier / n8n): signed payloads, HTTPS only, blocks localhost/private/metadata addresses, 5 retries then dead-letter.
- **Meta Lead Ads** webhook: leads from VSM's own Facebook/Instagram campaigns into CRM (source = Campaign), signature-verified, deduplicated.
- **Razorpay** (optional): payout references auto-filled on payroll entries; client payment status on Client 360. Signature-verified webhooks; never marks PAID without a verified payment.
- **Analytics** (PostHog/GA4, optional): feature usage, no personal or salary data.
- **Integration Command Center v2**: per integration, connection state, configuration, last success/failure, failure count, health, recent events and safe retry. **Incidents** with ID, severity, owner, first/last seen, count, timeline, resolution notes; **SLA** ON_TRACK / AT_RISK / BREACHED with escalation and cooldown; no blind retry of irreversible actions.
- Notification preferences gain WhatsApp and Push columns.

**Database:** `0015_channels_reliability.sql`: `whatsapp_optins`, `push_subscriptions`, `webhook_endpoints`, `webhook_deliveries`, `integration_events`, `incidents`, `incident_events`, `sla_policies`; preference channel check extended.
**Env:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` (or `TWILIO_*`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SLACK_WEBHOOK_URL`, `SLACK_EVENTS`, `TEAMS_WEBHOOK_URL`, `TEAMS_EVENTS`, `META_APP_SECRET`, `META_PAGE_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `POSTHOG_KEY`.
**Screens:** `/settings/integrations` v2 (per-provider setup + test), `/settings/incidents`, `/settings/webhooks`.

**Security tests to add:** webhook signature checks reject tampered payloads; SSRF blocklist enforced; opt-out respected; no salary amounts in any external message; incident data admin-only.

**Acceptance checklist**
- [ ] Opted-in employee receives a WhatsApp leave decision; opted-out does not
- [ ] A Meta test lead lands in CRM as source Campaign
- [ ] Turn off the Brevo key: an incident opens, escalates at SLA breach, then resolves after the fix

---

## Block 10: Flutter mobile app

**Goal:** the employee's personal workspace and the manager's team view in their pocket, on the same backend and the same security rules.

**Features**
- **Employee:** login (Supabase Auth, secure storage), personal dashboard, **clock in/out with a geo-check** against the Meerut/Noida office radius (on demand, no background tracking), attendance history, my tasks (update, submit with evidence), daily updates, leave requests, my performance and analytics, **payslips** (view/download), notifications, documents, meetings.
- **Chat:** DMs, groups, spaces, channels, replies, attachments, image/file sharing, read receipts, unread counters, presence, push notifications, deep links into a conversation.
- **Manager:** team overview, team attendance, assign tasks, team analytics, review daily updates, leave approvals, meeting management, group management where permitted.
- **Push:** FCM HTTP v1 (Android), APNs (iOS, optional); device registration, token refresh, logout invalidation, per-category preferences, deep links, delivery error handling.
- **Offline:** read-only cache, isolated per session, purged on logout/401; offline banner; **writes are never queued or replayed**.
- Responsive from 320 px phones to tablets, large-font safe, dark/light themes, VSM design system.

**Database:** `0016_mobile.sql`: `devices` (platform, token, last_seen, revoked_at), push delivery log; office geofence settings.
**Env (server):** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, optional `APNS_*`. **App build:** `--dart-define=SUPABASE_URL`, `SUPABASE_ANON_KEY` (no secrets in the app).
**Deliverable:** `mobile/` Flutter project, release APK build script, Play Store listing checklist.

**Security tests to add:** the mobile app uses only anon key + user session (no service key); RLS identical to web; a revoked device stops receiving push; geo-check failure blocks the punch with a clear message and an option to request a correction.

**Acceptance checklist**
- [ ] Install the APK; sign in; clock in at the office (works) and away from it (blocked with reason)
- [ ] Receive a push for a new DM; tapping it opens that conversation
- [ ] View and download your payslip; you can't reach anyone else's
- [ ] Airplane mode: cached screens show with the offline banner; actions are disabled

---

## Integration ↔ block map

| Integration | Block |
|---|---|
| Supabase Auth (HttpOnly sessions), Brevo email + preferences + digest, Brevo SMTP for auth emails, Integrations panel v1, cron heartbeat | 1 |
| Supabase Realtime | 2 |
| Supabase Storage, link previews | 3 |
| Google Calendar + Meet | 6 |
| VSM Scholars API | 7 |
| Scheduler / pg_cron automation | 8 |
| WhatsApp, Web Push, Slack, Teams, outbound webhooks, Meta Lead Ads, Razorpay, Analytics, Integration Command Center v2, incidents & SLA | 9 |
| FCM HTTP v1, APNs, device location | 10 |

Already live before Block 1: Supabase Postgres + RLS, website enquiry intake (vsmgrowth.com → CRM).

Full feature and integration catalogue (with OPDesk sources): see the "OPDesk → VSM Ops: Master Feature, Integration & Panel Catalogue" doc.
