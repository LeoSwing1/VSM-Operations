# Block 09 — Advanced Calendar, Attendance, Evidence & Exports

## Delivered

- Calendar now has Month, Week and Day views with date navigation, timezone-aware event ranges, a month grid that links into day detail, and 24-hour time lanes in Week/Day views.
- Recurring meetings support bounded daily (5), weekly (8), and monthly (6) series. Series creation is atomic; each occurrence has its own attendees and queued invitation delivery.
- Google Calendar and Microsoft Outlook OAuth connections are available. Access and refresh tokens are AES-256-GCM encrypted at rest; browser roles cannot select token columns and the encryption key is server-only. Scheduled sync pushes OPDesk-organised events, applies edits, and imports provider events into a private OPDesk calendar with duplicate protection.
- Meeting email invitations use the configured Brevo/Resend provider through a retry-limited scheduled queue.
- Attendance punch controls remain mobile-responsive and support clock in/out and breaks; server actions remain the source of truth.
- Task timesheets support server-timestamped start/stop timers, one active timer per employee, work summaries, and existing approval workflow.
- Quality assessments accept up to 8 private evidence attachments, 15 MB each, allowlisted MIME types, SHA-256 integrity metadata, private Storage policies and short-lived signed download URLs.
- Attendance, timesheets, finance, payroll and quality exports support CSV, Excel XLSX and PDF. Calendar exports interoperable RFC 5545 ICS. Export routes preserve existing permission checks and add audit events.
- XLSX files are real OOXML workbooks with frozen headers, filters, bounded column widths, typed numeric cells and formula-safe inline strings. CSV values neutralise spreadsheet formula prefixes. PDFs are paginated, timestamped and include page numbering. All exports are private/no-store.

## Configuration

Set the Google and Microsoft OAuth client IDs/secrets, `CALENDAR_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64 or 64 hex chars), and existing email provider credentials. Register redirect URIs:

- `${APP_URL}/api/integrations/calendar/google/callback`
- `${APP_URL}/api/integrations/calendar/microsoft/callback`

Configure the Vercel cron jobs for `/api/cron/calendar-invitations` and `/api/cron/calendar-sync`; both require `CRON_SECRET`. The migration creates a private `quality-evidence` Storage bucket.

## Boundaries / operational notes

- Provider sync imports external meetings as private events; it does not automatically publish personal calendar items to the organisation.
- Provider sync processes a rolling 90-day window and at most 100 events per connected account per run. Provider API quotas, revoked consent and rate limits can delay sync; the connection displays the last sync error and reconnect is required when credentials are revoked. Provider-side deletion/cancellation propagation and historical backfill are not included in this block.
- Recurrence is bounded to prevent unbounded event creation. Editing/deleting a series as a series-wide operation is not yet provided; individual occurrences remain separate records.
- Email delivery requires a verified sender and configured Brevo/Resend API credentials. Delivery is asynchronous and retry-limited.
- Mobile clocking uses the responsive web interface and authenticated server-side punches. Geofencing, biometrics and offline punch queuing are not included.
- Evidence is stored privately; downloads use short-lived signed URLs. Antivirus scanning and OCR are not included.
- PDF uses standard Helvetica and therefore transliterates unsupported glyphs; XLSX and CSV preserve Unicode text.

## Migration

Apply `supabase/migrations/0015_advanced_calendar_time_quality_exports.sql` after Block 08. `supabase/all_migrations.sql` is regenerated as the ordered concatenation of all migrations.
