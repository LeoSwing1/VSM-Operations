# Block 13 — Integration Control Centre

## Delivered

- Replaced the generic integrations list with a central, permission-gated Integration Control Centre at `/settings/integrations`.
- Added live, operator-triggered checks for the authenticated database round-trip, Supabase Storage bucket inventory, Supabase Auth Admin API and a temporary Supabase Realtime channel handshake.
- Storage diagnostics confirm the expected private `employee-private`, `finance-receipts`, `chat-files` and `quality-evidence` buckets exist; the UI never displays stored files or user records.
- Auth diagnostics call `auth.admin.listUsers` with a one-user page solely to prove service-role API access; returned user details are not exposed.
- Realtime diagnostics create a short-lived channel, record the handshake result and always attempt channel cleanup. This proves transport availability only; it does not claim chat has switched from polling to realtime subscriptions.
- Added organisation-scoped diagnostic history with status, latency, safe message, timestamp and operator. RLS restricts reads/inserts to `settings.manage` users in the current organisation.
- Added readiness visibility for Google/Microsoft OAuth credentials, encryption key presence, actual linked calendar accounts, last sync and provider errors.
- Added operational summaries for email outbox, failed email retry, cron heartbeat, website intake configuration and recent diagnostic checks.
- Replaced inaccurate planned integrations list with explicitly labelled not-integrated providers and their prerequisites.

## Migration

- `0018_integration_control_centre.sql` adds `integration_check_runs` with organisation-scoped RLS and indexes.
- `supabase/all_migrations.sql` is regenerated as the exact ordered concatenation of all 18 migration files.

## Security

- All new server actions require `settings.manage`.
- Service-role operations remain server-only; no service key, OAuth secret, intake key or object content is returned to the browser.
- The Auth check does not disclose user information. Storage check only returns required/missing bucket names.
- Diagnostic history is tenant-scoped and operator-attributed.

## Important boundaries

- Checks must be run by an administrator; the page does not silently probe external providers on every render.
- A passing Realtime handshake does not verify publication membership for every table or mean chat is using realtime yet.
- OAuth credential presence does not prove consent or token validity. Actual linked account status and last sync errors are displayed separately.
- Cron status is based on recorded worker heartbeat. The page does not invoke production cron endpoints.
- Website intake status uses environment readiness and last recorded website lead; it is not a synthetic end-to-end post from the marketing website.
- Production credentials, Supabase migration execution and Vercel deployment remain operator steps.

## Validation

- Added static contract tests in `tests/block13.test.ts`.
- ZIP integrity and source syntax checks are run for the packaged block.
- Full Next.js build, Vitest and live database/RLS checks require installed dependencies and a configured Supabase/Postgres environment; do not interpret static checks as production verification.
