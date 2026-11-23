import { describe, expect, it } from "vitest";
import { summariseAttendance, type ShiftPolicy } from "../src/lib/engines/attendance";
import { csvCell } from "../src/lib/reports/csv";
import { readFileSync } from "node:fs";

const standard: ShiftPolicy = {
  start_time: "09:00",
  end_time: "18:00",
  grace_minutes: 10,
  half_day_minutes: 240,
  full_day_minutes: 480,
  weekly_offs: [0],
};
const early: ShiftPolicy = { ...standard, start_time: "08:00", end_time: "17:00", weekly_offs: [6] };

describe("effective-dated shift schedules", () => {
  it("uses the assigned shift for that local date, including grace and weekly offs", () => {
    const s = summariseAttendance({
      events: [
        { event_type: "CLOCK_IN", occurred_at: "2026-11-23T02:00:00.000Z" },
        { event_type: "CLOCK_OUT", occurred_at: "2026-11-23T11:00:00.000Z" },
      ],
      shift: standard,
      shiftByDate: { "2026-11-23": early },
      start: "2026-11-23",
      end: "2026-11-23",
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-24",
      tz: "Asia/Kolkata",
    });
    expect(s.days[0]?.status).toBe("PRESENT");
    expect(s.days[0]?.lateMinutes).toBe(0);
  });
  it("preserves the default shift when there is no dated assignment", () => {
    const s = summariseAttendance({
      events: [],
      shift: standard,
      start: "2026-11-23",
      end: "2026-11-23",
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-24",
      tz: "Asia/Kolkata",
    });
    expect(s.days[0]?.status).toBe("ABSENT");
  });
});

describe("workforce block security and exports", () => {
  it("protects all new workforce tables with row-level security", () => {
    const sql = readFileSync("supabase/migrations/0014_workforce_collaboration_calendar.sql", "utf8");
    for (const table of [
      "org_teams",
      "org_team_members",
      "work_groups",
      "work_group_members",
      "schedule_assignments",
      "task_time_entries",
      "quality_checklists",
      "quality_assessments",
      "calendar_events",
      "calendar_attendees",
      "meeting_notes",
    ]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
    }
    expect(sql).toContain("cannot approve your own time");
    expect(sql).toContain("cross-organisation write denied");
    expect(sql).toContain("is_sensitive_permission");
    expect(sql).toContain("schedule dates overlap an existing assignment");
    expect(sql).toContain("create_calendar_event");
    expect(sql).toContain("calendar-response:");
  });
  it("neutralises formula-like timesheet CSV cells", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("normal value")).toBe('"normal value"');
    expect(csvCell(-125.5)).toBe('"-125.5"');
    expect(csvCell("  =SUM(A1:A2)")).toBe('"\'  =SUM(A1:A2)"');
  });
});
