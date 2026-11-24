# Deploying VSM Growth Operations on Vercel

## 1. Before "Create Project"
- **Region:** `vercel.json` pins functions to `hnd1` (Tokyo). Put them next to your database: check Supabase → Project Settings → General → Region.
  - Mumbai (`ap-south-1`) → change `"hnd1"` to `"bom1"`.
  - Singapore (`ap-southeast-1`) → `"sin1"`.
- **Environment variables** (Production and Preview):

  | Key | Value |
  |---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API (anon/public) |
  | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (service_role) — **never** with `NEXT_PUBLIC_` |
  | `APP_URL` | `https://ops.vsmgrowth.com`, or `https://<project>.vercel.app` until the domain is connected |
  | `CRON_SECRET` | 40+ random characters (e.g. `openssl rand -hex 24`) |
  | `EMAIL_PROVIDER` | `brevo` |
  | `BREVO_API_KEY` | your **new** Brevo key |
  | `EMAIL_FROM` | `VSM Growth <leovsmgrowth@gmail.com>` (switch to `ops@vsmgrowth.com` once the domain is authenticated in Brevo) |
  | `EMAIL_REPLY_TO` | `leovsmgrowth@gmail.com` |
  | optional | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_TOKEN_ENCRYPTION_KEY` |

  "Import .env" with your `.env.local` works, but change `APP_URL` to the live address afterwards.

## 2. After the first deploy
1. Supabase → Authentication → URL Configuration:
   - Site URL = `APP_URL`
   - Redirect URLs: `APP_URL/auth/callback` and `APP_URL/login/reset`
2. Vercel → Settings → Domains → add `ops.vsmgrowth.com`, then add the DNS record Vercel shows at your domain provider.
3. Open `APP_URL/status`. Everything should be green.

## 3. Scheduled jobs
`vercel.json` runs every job **once a day**, which is the Hobby plan's limit.

**On Vercel Pro**, change the schedules back to the frequent ones:

| Job | Schedule |
|---|---|
| email | `*/5 * * * *` |
| calendar-invitations | `*/5 * * * *` |
| workflows | `*/5 * * * *` |
| calendar-sync | `*/15 * * * *` |
| reports | `*/15 * * * *` |

**On Hobby**, add free jobs at https://cron-job.org (or any scheduler). For each job:
- **URL:** `APP_URL/api/cron/<job>`
- **Method:** GET
- **Header:** `Authorization: Bearer <CRON_SECRET>`

| Job | Every |
|---|---|
| `/api/cron/email` | 5 min |
| `/api/cron/workflows` | 5 min |
| `/api/cron/calendar-invitations` | 5 min |
| `/api/cron/calendar-sync` | 15 min |
| `/api/cron/reports` | 15 min |

The daily digest stays on Vercel. To check it's working: Settings → Integrations shows the **Cron heartbeat** as recent.
