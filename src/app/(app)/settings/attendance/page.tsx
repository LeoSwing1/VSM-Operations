import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { addHoliday, removeHoliday, saveShift, assignShift } from "./actions";

export const metadata = { title: "Shifts & holidays" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AttendanceSettings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("attendance.manage");
  const sb = await supabaseServer();
  const year = /^\d{4}$/.test(sp.year ?? "") ? sp.year! : localDate(new Date(), ctx.timezone).slice(0, 4);
  const [{ data: shifts }, { data: holidays }, { data: emps }, { data: schedulePeople }, { data: assignments }] = await Promise.all([
    sb.from("shifts").select("*").order("name"),
    sb
      .from("holidays")
      .select("id, holiday_date, name")
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date"),
    sb.from("employees").select("shift_id").neq("status", "EXITED"),
    sb.from("employee_directory").select("id,full_name").order("full_name"),
    sb
      .from("schedule_assignments")
      .select("id,employee_id,shift_id,effective_from,effective_to")
      .order("effective_from", { ascending: false })
      .limit(80),
  ]);
  const on = (id: string) => (emps ?? []).filter((e) => e.shift_id === id).length;
  const unassigned = (emps ?? []).filter((e) => !e.shift_id).length;
  const forms = [
    ...(shifts ?? []),
    {
      id: "",
      name: "",
      start_time: "09:00",
      end_time: "18:00",
      grace_minutes: 10,
      half_day_minutes: 240,
      full_day_minutes: 480,
      weekly_offs: [0],
    },
  ];

  return (
    <>
      <PageHeader eyebrow="Attendance rules" title="Shifts & holidays">
        <a href="/settings/attendance/field" className="btn-ghost">
          Field & mobile attendance →
        </a>
      </PageHeader>
      <Flash sp={sp} />
      {unassigned > 0 && (
        <p className="mb-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
          {unassigned} active employee(s) have no shift and fall back to 9:00–18:00 with Sunday off. Assign a shift in People → profile →
          Edit.
        </p>
      )}

      <h2 className="eyebrow mb-3">Shifts</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {forms.map((s: any) => (
          <Card key={s.id || "new"} title={s.id ? `${s.name} · ${on(s.id)} people` : "Add a shift"}>
            <form action={saveShift} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="id" value={s.id} />
              <Field label="Name" className="sm:col-span-3">
                <input name="name" defaultValue={s.name} required className="input" placeholder="Noida office 10–7" />
              </Field>
              <Field label="Start">
                <input type="time" name="start_time" defaultValue={s.start_time.slice(0, 5)} required className="input" />
              </Field>
              <Field label="End">
                <input type="time" name="end_time" defaultValue={s.end_time.slice(0, 5)} required className="input" />
              </Field>
              <Field label="Late after (grace, min)">
                <input type="number" name="grace_minutes" min={0} max={180} defaultValue={s.grace_minutes} className="input" />
              </Field>
              <Field label="Full day = hours worked">
                <input
                  type="number"
                  name="full_day_hours"
                  step="0.25"
                  min={1}
                  max={24}
                  defaultValue={s.full_day_minutes / 60}
                  className="input"
                />
              </Field>
              <Field label="Half day = at least hours">
                <input
                  type="number"
                  name="half_day_hours"
                  step="0.25"
                  min={0.5}
                  max={24}
                  defaultValue={s.half_day_minutes / 60}
                  className="input"
                />
              </Field>
              <fieldset className="sm:col-span-3">
                <legend className="label">Weekly offs</legend>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d, i) => (
                    <label key={d} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm">
                      <input type="checkbox" name="weekly_offs" value={i} defaultChecked={(s.weekly_offs as number[]).includes(i)} /> {d}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="sm:col-span-3">
                <button className={s.id ? "btn-ghost" : "btn-primary"}>{s.id ? "Save shift" : "Add shift"}</button>
              </div>
            </form>
          </Card>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Below the half-day hours counts as absent; between half and full is a half day (0.5 loss of pay). Changes apply to attendance
        reports and payroll from the next calculation.
      </p>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title="Assign effective-dated shift">
          <form action={assignShift} className="grid gap-3">
            <Field label="Employee">
              <select name="employee_id" className="input" required>
                {(schedulePeople ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Shift">
              <select name="shift_id" className="input" required>
                {(shifts ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective from">
              <input name="effective_from" type="date" className="input" required />
            </Field>
            <Field label="Effective to (optional)">
              <input name="effective_to" type="date" className="input" />
            </Field>
            <button className="btn-primary">Assign schedule</button>
          </form>
        </Card>
        <Card title="Recent shift assignments">
          {!assignments?.length ? (
            <Empty title="No effective-dated assignments" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Shift</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a: any) => (
                    <tr key={a.id}>
                      <td>{schedulePeople?.find((e) => e.id === a.employee_id)?.full_name ?? "—"}</td>
                      <td>{shifts?.find((s) => s.id === a.shift_id)?.name ?? "—"}</td>
                      <td>{a.effective_from}</td>
                      <td>{a.effective_to ?? "Ongoing"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <div className="mb-3 mt-10 flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">Holidays {year}</h2>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`?year=${Number(year) - 1}`}>
            ← {Number(year) - 1}
          </a>
          <a className="btn-ghost" href={`?year=${Number(year) + 1}`}>
            {Number(year) + 1} →
          </a>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          {!holidays?.length ? (
            <Empty title={`No holidays in ${year}`} hint="Holidays aren't counted as absent days or loss of pay." />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Holiday</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap">
                        {fmtDate(h.holiday_date)}{" "}
                        <span className="text-xs text-muted">{DAYS[new Date(`${h.holiday_date}T12:00:00Z`).getUTCDay()]}</span>
                      </td>
                      <td>{h.name}</td>
                      <td className="text-right">
                        <form action={removeHoliday}>
                          <input type="hidden" name="id" value={h.id} />
                          <button className="text-xs text-muted hover:text-danger">Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Add holiday">
          <form action={addHoliday} className="grid gap-3">
            <Field label="Date">
              <input type="date" name="holiday_date" required className="input" />
            </Field>
            <Field label="Name">
              <input name="name" required className="input" placeholder="Diwali" />
            </Field>
            <div>
              <button className="btn-primary">Add holiday</button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
