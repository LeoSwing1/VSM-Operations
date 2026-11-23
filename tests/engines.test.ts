import { describe, expect, it } from "vitest";
import { nextActions, summariseAttendance, summariseDayEvents, type ShiftPolicy } from "@/lib/engines/attendance";
import { computePerformance, validateWeights, DEFAULT_WEIGHTS, type TaskInput } from "@/lib/engines/performance";
import { calculatePayroll, slabPct, DEFAULT_SLABS, validateSlabs, type PayrollInput } from "@/lib/engines/payroll";
import { zonedInstant } from "@/lib/engines/time";

const shift: ShiftPolicy = {
  start_time: "09:00",
  end_time: "18:00",
  grace_minutes: 10,
  half_day_minutes: 240,
  full_day_minutes: 480,
  weekly_offs: [0],
};
const at = (d: string, t: string) => zonedInstant(d, t).toISOString();

describe("attendance engine", () => {
  it("stores UTC and evaluates lateness in IST", () => {
    // 09:15 IST = 03:45 UTC → 5 minutes late after 10m grace
    const s = summariseAttendance({
      events: [
        { event_type: "CLOCK_IN", occurred_at: "2026-11-02T03:45:00.000Z" },
        { event_type: "CLOCK_OUT", occurred_at: "2026-11-02T12:35:00.000Z" },
      ],
      shift,
      start: "2026-11-02",
      end: "2026-11-02",
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-10",
    });
    expect(s.days[0]!.lateMinutes).toBe(5);
    expect(s.days[0]!.status).toBe("PRESENT"); // 8h50m worked
    expect(s.days[0]!.earlyDepartureMinutes).toBe(0);
    expect(s.lateArrivals).toBe(1);
  });

  it("subtracts breaks and classifies half days", () => {
    const d = "2026-11-03";
    const s = summariseAttendance({
      events: [
        { event_type: "CLOCK_IN", occurred_at: at(d, "09:00") },
        { event_type: "BREAK_START", occurred_at: at(d, "11:00") },
        { event_type: "BREAK_END", occurred_at: at(d, "12:00") },
        { event_type: "CLOCK_OUT", occurred_at: at(d, "14:30") },
      ],
      shift,
      start: d,
      end: d,
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-10",
    });
    expect(s.days[0]!.breakMinutes).toBe(60);
    expect(s.days[0]!.workedMinutes).toBe(270);
    expect(s.days[0]!.status).toBe("HALF_DAY");
    expect(s.days[0]!.earlyDepartureMinutes).toBe(210);
    expect(s.lopDays).toBe(0.5);
  });

  it("detects missing clock-out on past days", () => {
    const d = "2026-11-04";
    const s = summariseAttendance({
      events: [{ event_type: "CLOCK_IN", occurred_at: at(d, "09:05") }],
      shift,
      start: d,
      end: d,
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-10",
    });
    expect(s.days[0]!.missingClockOut).toBe(true);
    expect(s.days[0]!.status).toBe("INCOMPLETE");
    expect(s.missingClockOuts).toBe(1);
  });

  it("handles weekly offs, holidays, paid & unpaid leave, absence, and pre-joining days", () => {
    const s = summariseAttendance({
      events: [],
      shift,
      start: "2026-11-01",
      end: "2026-11-07",
      holidays: ["2026-11-05"],
      leave: [
        { date: "2026-11-03", paid: true, half: false },
        { date: "2026-11-04", paid: false, half: false },
      ],
      joiningDate: "2026-11-02",
      today: "2026-11-30",
    });
    const st = Object.fromEntries(s.days.map((d) => [d.date, d.status]));
    expect(st).toEqual({
      "2026-11-01": "NOT_EMPLOYED",
      "2026-11-02": "ABSENT",
      "2026-11-03": "LEAVE",
      "2026-11-04": "LEAVE",
      "2026-11-05": "HOLIDAY",
      "2026-11-06": "ABSENT",
      "2026-11-07": "ABSENT",
    });
    expect(s.lopDays).toBe(4); // 3 absent + 1 unpaid leave
    expect(s.workingDays).toBe(5);
  });

  it("never treats an un-started today as absent", () => {
    const s = summariseAttendance({
      events: [],
      shift,
      start: "2026-11-10",
      end: "2026-11-10",
      holidays: [],
      leave: [],
      joiningDate: "2026-01-01",
      today: "2026-11-10",
    });
    expect(s.days[0]!.status).toBe("UPCOMING");
    expect(s.attendancePct).toBeNull();
  });

  it("offers valid next punches", () => {
    expect(nextActions([])).toEqual(["CLOCK_IN"]);
    expect(nextActions([{ event_type: "CLOCK_IN", occurred_at: "2026-11-02T03:30:00Z" }])).toEqual(["BREAK_START", "CLOCK_OUT"]);
    expect(
      nextActions([
        { event_type: "CLOCK_IN", occurred_at: "2026-11-02T03:30:00Z" },
        { event_type: "BREAK_START", occurred_at: "2026-11-02T06:30:00Z" },
      ]),
    ).toEqual(["BREAK_END"]);
  });

  it("ignores malformed sequences safely", () => {
    const r = summariseDayEvents([
      { event_type: "CLOCK_OUT", occurred_at: "2026-11-02T03:30:00Z" },
      { event_type: "BREAK_END", occurred_at: "2026-11-02T04:30:00Z" },
    ]);
    expect(r.workedMinutes).toBe(0);
  });
});

const task = (o: Partial<TaskInput> & { id: string }): TaskInput => ({
  status: "COMPLETED",
  deadline: "2026-10-20T12:00:00Z",
  completed_at: "2026-10-19T10:00:00Z",
  quality_score: 80,
  estimated_hours: 4,
  actual_hours: 4,
  reopen_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  ...o,
});
const att = { attendancePct: 100, punctualityPct: 100, presentDays: 20, workingDays: 20 };

describe("performance engine", () => {
  it("default weights total 100; bad weights are rejected", () => {
    expect(validateWeights(DEFAULT_WEIGHTS)).toEqual([]);
    expect(validateWeights({ task_quality: 60 })[0]).toMatch(/total 100/);
  });

  it("missing data is never a perfect score", () => {
    const r = computePerformance({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      tasks: [],
      attendance: { attendancePct: null, punctualityPct: null, presentDays: 0, workingDays: 0 },
      dailyUpdatesSubmitted: 0,
      managerRating: null,
    });
    expect(r.score).toBeNull();
    expect(r.insufficientData).toBe(true);
    expect(r.coverage).toBe(0);
  });

  it("excludes cancelled tasks and de-duplicates", () => {
    const r = computePerformance({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      tasks: [
        task({ id: "a" }),
        task({ id: "a" }),
        task({ id: "c", status: "CANCELLED" }),
        task({ id: "d", status: "IN_PROGRESS", completed_at: null, quality_score: null }),
      ],
      attendance: att,
      dailyUpdatesSubmitted: 20,
      managerRating: 80,
    });
    const tc = r.components.find((c) => c.key === "task_completion")!;
    expect(tc.detail).toBe("1 of 2 tasks completed");
    expect(tc.score).toBe(50);
  });

  it("completion does not imply quality", () => {
    const r = computePerformance({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      tasks: [task({ id: "a", quality_score: null }), task({ id: "b", quality_score: null })],
      attendance: att,
      dailyUpdatesSubmitted: 20,
      managerRating: 80,
    });
    expect(r.components.find((c) => c.key === "task_completion")!.score).toBe(100);
    expect(r.components.find((c) => c.key === "task_quality")!.score).toBeNull();
    expect(r.coverage).toBe(75); // 25% weight missing
  });

  it("computes a transparent weighted score that sums from contributions", () => {
    const r = computePerformance({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      tasks: [
        task({ id: "a", quality_score: 90 }),
        task({ id: "b", quality_score: 70, completed_at: "2026-10-22T10:00:00Z", submitted_at: "2026-10-22T10:00:00Z", actual_hours: 8 }),
      ],
      attendance: { attendancePct: 95, punctualityPct: 80, presentDays: 19, workingDays: 20 },
      dailyUpdatesSubmitted: 17,
      managerRating: 75,
    });
    const sum = r.components.reduce((a, c) => a + (c.contribution ?? 0), 0);
    expect(r.score).toBeCloseTo(sum, 1);
    expect(r.components.find((c) => c.key === "on_time_delivery")!.score).toBe(50);
    expect(r.components.find((c) => c.key === "productivity")!.score).toBe(66.67);
    expect(r.category).not.toBeNull();
    expect(r.improvements.length).toBeGreaterThan(0);
  });
});

const baseInput = (o: Partial<PayrollInput> = {}): PayrollInput => ({
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  joiningDate: "2025-01-01",
  structure: {
    id: "s",
    pay_type: "FIXED_PLUS_VARIABLE",
    base_monthly: 31000,
    allowances: [{ name: "Travel", amount: 3100 }],
    deductions: [],
    target_incentive: 10000,
    attendance_incentive: 1000,
  },
  policy: { id: "p", slabs: DEFAULT_SLABS, cap_amount: null, prorate: true },
  snapshot: { id: "x", status: "APPROVED", final_score: 84 },
  lopDays: 0,
  attendanceIncentiveEligible: true,
  adjustments: [],
  ...o,
});

describe("payroll engine", () => {
  it("applies the example slab policy (configurable, not hard-coded)", () => {
    expect([49, 50, 64, 65, 79, 80, 89, 90, 100].map((s) => slabPct(s, DEFAULT_SLABS))).toEqual([0, 25, 25, 50, 50, 75, 75, 100, 100]);
    expect(slabPct(70, [{ min: 0, pct: 10 }])).toBe(10);
    expect(
      validateSlabs([
        { min: 50, pct: 25 },
        { min: 50, pct: 30 },
      ]),
    ).toContain("Slab minimums must be unique");
  });

  it("full month: base + allowance + 75% incentive + attendance incentive", () => {
    const r = calculatePayroll(baseInput());
    expect(r.base).toBe(31000);
    expect(r.allowances).toBe(3100);
    expect(r.incentive).toBe(7500);
    expect(r.attendanceIncentive).toBe(1000);
    expect(r.gross).toBe(42600);
    expect(r.net).toBe(42600);
  });

  it("loss of pay prorates base and allowances, and voids attendance incentive", () => {
    const r = calculatePayroll(baseInput({ lopDays: 2 }));
    expect(r.payableDays).toBe(29);
    expect(r.base).toBe(29000);
    expect(r.allowances).toBe(2900);
    expect(r.attendanceIncentive).toBe(0);
  });

  it("prorates mid-month joiners", () => {
    const r = calculatePayroll(baseInput({ joiningDate: "2026-10-17" }));
    expect(r.employedDays).toBe(15);
    expect(r.base).toBe(15000);
    expect(r.incentive).toBe(3629.03); // 7500 × 15/31
  });

  it("withholds incentive without an APPROVED snapshot", () => {
    const r = calculatePayroll(baseInput({ snapshot: { id: "x", status: "DRAFT", final_score: 95 } }));
    expect(r.incentive).toBe(0);
    expect(r.warnings.join()).toMatch(/not approved/);
  });

  it("respects incentive caps and incentive-only pay", () => {
    const capped = calculatePayroll(
      baseInput({
        snapshot: { id: "x", status: "APPROVED", final_score: 95 },
        policy: { id: "p", slabs: DEFAULT_SLABS, cap_amount: 6000, prorate: true },
      }),
    );
    expect(capped.incentive).toBe(6000);
    const io = calculatePayroll(
      baseInput({
        structure: {
          id: "s",
          pay_type: "INCENTIVE_ONLY",
          base_monthly: 0,
          allowances: [],
          deductions: [],
          target_incentive: 20000,
          attendance_incentive: 0,
        },
      }),
    );
    expect(io.base).toBe(0);
    expect(io.gross).toBe(15000);
  });

  it("fixed pay ignores performance entirely", () => {
    const r = calculatePayroll(
      baseInput({
        structure: {
          id: "s",
          pay_type: "FIXED",
          base_monthly: 25000,
          allowances: [],
          deductions: [{ name: "Advance recovery", amount: 2000 }],
          target_incentive: 5000,
          attendance_incentive: 0,
        },
        snapshot: null,
      }),
    );
    expect(r.incentive).toBe(0);
    expect(r.deductions).toBe(2000);
    expect(r.net).toBe(23000);
  });

  it("is exact to the paisa and never negative", () => {
    const r = calculatePayroll(
      baseInput({
        structure: {
          id: "s",
          pay_type: "FIXED",
          base_monthly: 33333.33,
          allowances: [],
          deductions: [{ name: "x", amount: 999999 }],
          target_incentive: 0,
          attendance_incentive: 0,
        },
        lopDays: 1,
      }),
    );
    expect(r.base).toBe(32258.06);
    expect(r.net).toBe(0);
    expect(r.warnings.join()).toMatch(/review required/);
  });

  it("always declares that statutory deductions are not auto-computed", () => {
    expect(calculatePayroll(baseInput()).lines.some((l) => l.label === "Statutory deductions")).toBe(true);
  });
});
