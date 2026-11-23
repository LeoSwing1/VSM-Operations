# Block 18 — Chat & Windows notifications, live sync, live clock, posts & teams, demo team, passwords, one protected Super Admin, Docker

## What you get
| Area | What changed |
|---|---|
| **Chat inbox** | A live unread badge on *Team chat*. Opening a conversation clears its chat notifications, so the bell and the chat badge drop together. Chat notifications now follow the **Chat** preference (before this fix they were filed under *System*). |
| **Windows notifications** | A one-click **Turn on desktop notifications** banner. It allows browser notifications, registers the service worker and (with VAPID keys) a push subscription, so messages reach the Windows notification centre even when VSM Ops is closed. It also shows alerts for chats you aren't looking at, without duplicates: the in-page and push copies share a tag. The app is installable on Windows (manifest + icons; Edge/Chrome → *Install VSM Ops*). |
| **Live sync** | Attendance, dashboard, tasks, approvals, leave and the Operations Center refresh within about a second of any change you're allowed to see (Supabase Realtime + RLS). |
| **Live clock** | The clock starts ticking the moment you press *Clock in* (optimistic, no waiting), shows HH:MM:SS with progress towards the shift's 8 h, pauses on break and stops on clock-out. A small clock in the sidebar follows you on every page and syncs across devices. |
| **Employee IDs** | Leave the ID blank and the database assigns the next `VSM-0001` style ID (concurrency-safe). The ID is shown on every profile. |
| **Posts & workflow** (`/people/posts`) | 18 company posts: Founder & CEO, Co-Founder, HR Manager, Operations Manager, SEO Manager, **SEO Executive**, Content Writer, Editing Lead, Video Editor, Graphic Designer, Tech Lead, Web Developer, Social Media Manager, Sales Executive, Course Counsellor, Trainer, Accounts Executive and Intern. Each post has a department, default role, team, *reports to*, responsibilities and KPIs. Giving someone a post puts them in the right department, team and team chat automatically. |
| **Teams** | **SEO Team**, **Editing Team** and **Developers Team**, each with its own chat group. Joining or leaving a team adds or removes the person from the group automatically. |
| **Demo team** (Super Admin console) | 5 demo employees with real logins: Riya Kapoor (HR Manager), Arjun Mehta and Neha Verma (SEO Executives), Kabir Singh (Video Editor) and Ishaan Gupta (Web Developer). They come with sample tasks and live clock-ins and are tagged DEMO. Passwords are random and shown once. They can be removed in one click. |
| **Passwords per employee** | On each profile, people with `people.reset_password` (Admin and HR Manager by default; Super Admin can delegate it) can *email a reset link* (sent through Brevo/Resend if configured) or *generate a temporary password*. A temporary password must be changed at the next sign-in. Every action is audited. |
| **Login & connection tests** | A **Test connection** link on the login page opens `/status` (database, sign-in, realtime, email — yes/no only, no secrets). The Super Admin console adds **Test login** (checks any account without touching your session) and **Send a test reset email** to yourself. |
| **One protected Super Admin** | Exactly one per organisation (unique index). Nobody can promote anyone to Super Admin from the app, and no one can demote, deactivate, delete, relink, restrict or reset the Super Admin. That includes admins, HR and the server's service key. The Super Admin's login can't be deleted through the Auth API either. Recovery works only from the Supabase **SQL Editor** (owner session) and is recorded in the audit log. |
| **Docker** | `scripts/local-up.ps1` (Windows) and `local-up.sh` run the whole Supabase stack in Docker Desktop: DB, Auth, Realtime, Storage, Studio and a mail catcher. They apply every migration, write local keys **without ever overwriting your `.env.local`**, and create your one Super Admin. An optional `Dockerfile` and `docker-compose.yml` run the app itself in Docker. |

## Run on live Supabase (SQL Editor)
1. Paste and run `supabase/migrations/0024_block18_people_teams_live.sql`. It is idempotent, so running it again is safe.
2. If it prints *"More than one active Super Admin…"*, demote the extra one in the SQL Editor and run it again. The unique index is only created when exactly one exists.
3. Check that it applied:
```sql
select
  (select count(*) from employees where role='SUPER_ADMIN' and status<>'EXITED') as super_admins,   -- 1
  (select count(*) from designations) as posts,                                                       -- 18
  (select count(*) from org_teams where team_key in ('seo','editing','developers') and chat_channel_id is not null) as teams_with_chat, -- 3
  exists(select 1 from pg_indexes where indexname='one_super_admin_per_org') as single_sa_index,      -- true
  exists(select 1 from pg_trigger where tgname='protect_sa_auth_user') as auth_guard;                 -- true
```
4. Optional: add `DEMO_EMAIL_DOMAIN` in Vercel, then redeploy.
5. Open Super Admin console → **Create demo team**, copy the logins, and use **Test login** on one of them.

## Run locally with Docker (your Windows PC)
```powershell
# Docker Desktop running, in the project folder:
./scripts/local-up.ps1 -Email you@vsmgrowth.com -Name "Your Name"
npm run dev        # http://localhost:3000
```
- Studio: http://127.0.0.1:54323
- Local email (reset and invite mails): http://127.0.0.1:54324
- Stop with `npx supabase stop`.

If you already have a `.env.local` (pointing at the cloud project), the script writes `.env.docker.local` instead and tells you how to switch. The bootstrap script refuses to run against anything other than a local Supabase.

## Verified in this workspace
- `tsc`: 0 errors.
- `next build`: success.
- Prettier: clean.
- Vitest: **122/122** (new: live clock, temporary passwords, demo team, wiring/security checks).
- PostgreSQL 16 with migrations 0001–0024 applied fresh plus an idempotent re-run of 0024: **295/295** checks (31 new). These cover:
  - SA demotion, deactivation, deletion, promotion of a second SA and overrides all blocked, including for HR and the service role
  - owner-session break-glass
  - auto IDs
  - SEO Executive → SEO department → SEO Team → chat group, and removal on leaving
  - reset-password rules
  - chat unread counts and clearing
- Production server smoke test:
  - `/login`, `/status`, `/api/status`, the manifest, icons and `sw.js` are public.
  - The app routes redirect to login.
  - `/api/chat/unread` returns 401 when signed out.
  - Login and status pages were screen-captured.

**Not verified here:**
- The real Supabase CLI or Docker run. The sandbox has no Docker and couldn't reach your PC.
- Live Realtime, push and email delivery.
- Creating auth users against the cloud project.

## 18.1 fix — "Already clocked in" but the clock shows Not clocked in
- Cause: the Clock in button (`record_attendance`) and the screens worked out "today" in two different places. When they disagreed, the database refused a second clock-in while the clock showed nothing.
- Fix (`0025_attendance_today.sql`):
  - The dashboard, attendance page and sidebar clock now all read through `my_attendance_today()`, which uses the **same** day boundary and timezone as `record_attendance`.
  - Error messages now say what state you are in, e.g. "You are already clocked in (since 09:42)".
- Diagnostics: `supabase/diagnostics/health_check.sql`. It is read-only and checks:
  - which migrations exist, the timezone and the Super Admin link
  - recent punches
  - every main table read *as the Super Admin through RLS* (exactly what the app does)
- `scripts/cleanup-stray.ps1` moves files that are not part of VSM Ops out of the project, which fixes `npm run typecheck`.

## 18.2 fix — live database repair (`supabase/repair/catch_up.sql`)
The health check on the live project showed two problems:
1. **`permission denied` for every table.** Newer Supabase projects no longer give the app's roles table access automatically, so every page read failed and came up empty.
2. **7 migrations missing:** 0007, 0011, 0014, 0018, 0021, 0023 and 0024 (plus 0012, 0015, 0019 and 0025, which depend on them).

`catch_up.sql` fixes both in **one transaction**, so either everything applies or nothing changes:
- Grants `authenticated` select/insert/update/delete and `service_role` full access on public tables. RLS still decides which rows each person sees. `anon` gets nothing.
- Applies every missing migration in order and skips the ones already applied. Applied migrations are recorded in `_vsm_migrations`.
- Re-applies all 39 column/table restrictions from the migrations, for example the unreadable webhook secrets and the read-only workflow runs.

Tested here:
- On a copy built to reproduce the live health check exactly, after the repair the schema, functions, policies and privileges are **identical** to a fresh install (`pg_dump` diff). The health check then shows no MISSING or ERROR lines, and running the repair a second time is a no-op.
- Security suite: 297/297 in normal mode, and 297/297 with `STRICT_GRANTS=1 ./scripts/test-db.sh`, which installs through the repair script with no automatic grants, like your project.

Regenerate the repair script after adding a migration: `python3 scripts/build-catch-up.py`. It refuses to build if the new migration has no "already applied" marker.

## 18.3 — bug fixes, profile menu, loader, onboarding, activity, Operations Center
- **Fixed** *"cannot add postgres_changes callbacks after subscribe()"*. Every Realtime channel now goes through `openChannel()`, which waits for the old channel with the same topic to be removed before creating a new one.
- **Fixed** *"Failed to fetch"* on login. Sign-in, forgot-password and new-password are now plain form posts to `/auth/sign-in`, `/auth/forgot` and `/auth/new-password`: same-origin checked, with friendly errors when the sign-in service can't be reached.
- **404** now shows the exact path, plus a Test connection button.
- **Profile menu** (top right): avatar, a short name ("Sushant M.") and **Owner** for the Super Admin (otherwise the post). The menu has My profile, My activity, My attendance, Notification settings, Change password and the admin links you're allowed, plus Sign out.
- **Loading:** the VSM wordmark fades in and out with "Initializing…" on every page load. A volt progress bar shows on every form submit and navigation.
- **New employee:**
  - The welcome email includes name, Employee ID, post, department, team, manager, joining date and login email.
  - It carries either a set-password link or a temporary password that must be changed at first sign-in.
- **Profile → Login & password:**
  - Create login & send welcome / Resend welcome
  - **Generate new password & email it** (also shown once)
  - Email a reset link
  - Generate without emailing
- **Profile → Activity** (0026): a timeline of clock-ins, tasks, leave and every change by or to the person. Visible to the person, their managers, HR and auditors; it never shows audit metadata.
- **Operations Center:** Teams right now (working vs members, link to team chat), Clients & leads today (new, follow-ups due, won this month), Communication & channels (messages today, deliveries per channel). It live-syncs leads and chat too.
- What's left: `docs/BLOCKS-DUE.md`.
- Verified here: tsc 0 errors · build ✓ · 127/127 unit tests · 300/300 DB checks in both normal and strict-grant mode · catch-up re-run on the simulated live DB ✓ · auth routes smoke-tested (303 redirects, cross-site refused).
