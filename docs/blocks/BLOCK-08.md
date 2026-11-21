# Block 08 — Workforce operations, attendance, time, quality, teams and calendar

## Scope

This block extends the existing OPDesk workforce stack. It does not replace the attendance clocking engine, task workflow or existing project time approval features.

### Attendance and schedules
- Existing `record_attendance()` remains the only clock-in, clock-out, break-start and break-end entry point.
- Existing attendance page continues to calculate presence, absence, half days, late arrivals, early departures, breaks, missing clock-outs and loss of pay.
- Added effective-dated `schedule_assignments`; the attendance engine now selects the assigned shift policy per local work date, including start/end, grace, minimum hours and weekly offs.
- Existing employee `shift_id` remains the fallback when no effective-dated assignment applies.
- Existing attendance CSV export remains available. Shift assignment is permission-gated by `attendance.manage` and audited.

### Teams and groups
- `org_teams` and `org_team_members` model formal teams, department association, lead and member roles.
- `work_groups` and `work_group_members` model cross-functional working groups, committees and private groups.
- Team/group operations are organisation-scoped and tenant relationship triggers reject cross-org references.

### Work time and exports
- `task_time_entries` captures time allocated to an assigned task, with an optional matching project, date, duration, description, billable flag and approval state. Project-only time continues to use the existing `project_time_entries` workflow from Block 05.
- `decide_task_time_entry()` enforces team/all approval permissions, rejects self-approval and writes an audit event.
- `/time` provides submission, register and approval UI; `/api/reports/time` exports CSV within RLS scope and neutralises spreadsheet formula injection.
- Attendance clock events are presence records; task timesheets and the existing project timesheets are delivery allocation. They are intentionally separate to avoid silently treating every clocked minute as billable/project time.

### Quality
- `quality_checklists` stores organisation quality criteria as JSON arrays; authorised quality managers can create checklists in the quality UI.
- `quality_assessments` stores independent employee/task/project assessment, score, outcome, findings and evidence references.
- Self-assessment is blocked. Existing task review/quality score workflow remains authoritative for task completion.

### Calendar and meetings
- `calendar_events` supports meetings, focus blocks, deadlines, training and other events; visibility can be organisation, department, team, invitees or private.
- `create_calendar_event()` creates an event and its attendees atomically. `calendar_attendees` supports accepted/declined/tentative responses; invitees and organisers receive in-app MEETINGS notifications for invitations and responses.
- `meeting_notes` stores agenda, minutes, decisions and action items.
- `/calendar` and `/meetings` provide event scheduling, invitation response, join links and meeting notes.

## Permissions added
- `teams.view_all`, `teams.manage`, `teams.manage_team`, `teams.create_group`
- `time.view_all`, `time.view_team`, `time.approve_all`, `time.approve_team`
- `quality.view_all`, `quality.view_team`, `quality.review`, `quality.manage`
- `calendar.create`, `calendar.manage`

`time.approve_all`, `teams.manage`, `quality.manage`, and `calendar.manage` are treated as sensitive grants in the application permission catalogue. Database RLS remains the enforcement layer.

## Migration

`supabase/migrations/0014_workforce_collaboration_calendar.sql`

## Known limitations / follow-up
- The calendar UI is an upcoming-event agenda, not a full drag/drop month/week grid.
- `recurrence_rule` is stored for future recurrence support but recurring-event expansion/edit-this-or-series is not implemented.
- No Google/Microsoft calendar sync, conferencing provider integration, room/resource booking, calendar conflict resolver or email invitations yet. In-app notifications are emitted for invited attendees and meeting organisers.
- Timesheet timer start/stop, geofencing, biometric devices, kiosk mode, offline punch queue and mobile push are not implemented. Clock punches continue through existing authenticated web/mobile-source RPC rules.
- Quality evidence is metadata JSON; a dedicated evidence storage workflow, weighted checklist scoring and configurable review automation remain follow-up work. The current checklist builder stores criteria and reviewers record a manual score.
- PDF/XLSX exports are not implemented in this block; attendance and timesheets export CSV.

## Verification

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run test:db` in an environment with dependencies and PostgreSQL/Supabase local services. Apply migration 0014 to a staging database and run cross-tenant RLS tests before production. No production database or deployment is changed by source generation.

### Team and group governance
- Team leads can be transferred through `transfer_org_team_lead()`; the previous lead is demoted to a regular member and leadership membership is protected from deletion until transferred.
- Public working groups can be joined and left by employees. Private groups remain invitation-only; owners and global team administrators can add/remove members. Group ownership cannot be removed as a membership row.
