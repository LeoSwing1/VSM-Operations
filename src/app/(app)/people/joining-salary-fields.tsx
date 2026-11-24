"use client";
import { useState } from "react";
import { defaultSalaryDay, ordinal } from "@/lib/engines/salary-day";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plus7 = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
};
const valid = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(new Date(iso + "T00:00:00Z").getTime());

/**
 * Joining date (required) + salary date. When adding someone the salary day is filled in as joining date + 7
 * (1 Jan → 8th) and follows the joining date until HR types their own. It is then saved for that person.
 * Only HR / HR Manager / owners / admins can edit it; everyone else sees it read-only (the database enforces this).
 */
export function JoiningSalaryFields({
  joining,
  salaryDay,
  canEdit,
}: {
  joining?: string | null;
  salaryDay?: number | null;
  canEdit: boolean;
}) {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [join, setJoin] = useState(joining ?? today);
  const [day, setDay] = useState<string>(String(salaryDay ?? defaultSalaryDay(joining ?? today)));
  // Editing an existing person: their saved day stays put. Adding: follow the joining date until changed by hand.
  const [touched, setTouched] = useState(salaryDay != null);
  const n = Number(day);
  const ok = Number.isInteger(n) && n >= 1 && n <= 31;
  const suggested = valid(join) ? defaultSalaryDay(join) : null;

  return (
    <>
      <label className="block">
        <span className="label">Joining date *</span>
        <input
          name="joining_date"
          type="date"
          required
          value={join}
          onChange={(e) => {
            setJoin(e.target.value);
            if (!touched && valid(e.target.value)) setDay(String(defaultSalaryDay(e.target.value)));
          }}
          className="input"
        />
      </label>
      <label className="block">
        <span className="label">Salary date (day of every month) *</span>
        <input
          name="salary_day"
          type="number"
          min={1}
          max={31}
          required
          readOnly={!canEdit}
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setTouched(true);
          }}
          className={`input${canEdit ? "" : " cursor-not-allowed opacity-70"}`}
        />
        <span className="mt-1 block text-xs text-muted">
          {ok ? `Paid on the ${ordinal(n)} of every month` : "Enter a day from 1 to 31"}
          {valid(join) && suggested != null && ` · joining + 7 days = ${fmt(plus7(join))}`}
          {canEdit && touched && suggested != null && n !== suggested && (
            <>
              {" · "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setDay(String(suggested));
                  setTouched(false);
                }}
              >
                use {ordinal(suggested)}
              </button>
            </>
          )}
          {!canEdit && " · only HR, HR Manager, owners and admins can change it"}
        </span>
      </label>
    </>
  );
}
