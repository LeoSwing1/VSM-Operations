# Block 33 — Speed (migration 0045)

- **Server region**: `vercel.json` now runs functions in **bom1 (Mumbai)**, next to the database. Before, every query went Tokyo ↔ India. If the Supabase project is in Singapore, use `sin1` instead (Supabase → Project Settings → General → Region).
- **Per request**:
  - Middleware verifies the session with `getClaims()`. That check is local, with no Auth round-trip, once the project uses asymmetric JWT signing keys; with the legacy secret it falls back to the previous behaviour.
  - `getContext()` no longer calls Auth a second time; `my_context()` alone decides.
  - The app layout loads context, the unread count and today's punch in parallel.
  - Static files (icons, fonts, sw.js, manifest) skip the middleware.
- **Database**:
  - 60+ missing foreign-key indexes for the joins and filters pages actually use, plus partial indexes for unread notifications and active employees.
  - RLS: 196 of 263 policies evaluate `current_org_id()`, `current_employee_id()`, `auth.uid()` and `has_perm('…')` once per query (sub-select initplan) instead of per row.
  - Tables referenced by other policies are deliberately left as they were, because wrapping them makes Postgres report false "infinite recursion".
