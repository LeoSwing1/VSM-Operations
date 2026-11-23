import { ROLE_LABEL, type Role } from "@/lib/auth";
import { Field } from "@/components/ui";

export interface Option {
  id: string;
  name: string;
}
export function EmployeeFields({
  e,
  departments,
  managers,
  shifts,
  assignable,
  posts = [],
  nextCode,
}: {
  e?: Record<string, any>;
  departments: Option[];
  managers: Option[];
  shifts: Option[];
  assignable: { role: Role; label: string }[];
  posts?: string[];
  nextCode?: string;
}) {
  // Only roles below the editor's level are offered; the current role stays selectable so a save doesn't change it.
  const roles =
    assignable.some((a) => a.role === e?.role) || !e
      ? assignable
      : [{ role: e.role as Role, label: ROLE_LABEL[e.role as Role] }, ...assignable];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Full name">
        <input name="full_name" defaultValue={e?.full_name} required className="input" />
      </Field>
      <Field label="Official email">
        <input name="official_email" type="email" defaultValue={e?.official_email} required className="input" />
      </Field>
      <Field label={e ? "Employee ID" : "Employee ID (blank = automatic)"}>
        <input name="employee_code" defaultValue={e?.employee_code} required={!!e} className="input" placeholder={nextCode ?? "VSM-0012"} />
      </Field>
      <Field label="Post / designation">
        <input name="designation" defaultValue={e?.designation ?? ""} className="input" list="vsm-posts" placeholder="e.g. SEO Executive" />
        <datalist id="vsm-posts">
          {posts.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
      <Field label="Department">
        <select name="department_id" defaultValue={e?.department_id ?? ""} className="input">
          <option value="">—</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reporting manager">
        <select name="manager_id" defaultValue={e?.manager_id ?? ""} className="input">
          <option value="">—</option>
          {managers
            .filter((m) => m.id !== e?.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Role">
        <select
          name="role"
          defaultValue={e?.role ?? (roles.some((r) => r.role === "EMPLOYEE") ? "EMPLOYEE" : roles.at(-1)?.role)}
          className="input"
        >
          {roles.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Employment type">
        <select name="employment_type" defaultValue={e?.employment_type ?? "FULL_TIME"} className="input">
          {["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"].map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Joining date">
        <input
          name="joining_date"
          type="date"
          defaultValue={e?.joining_date ?? new Date().toISOString().slice(0, 10)}
          required
          className="input"
        />
      </Field>
      <Field label="Phone">
        <input name="phone" defaultValue={e?.phone ?? ""} className="input" />
      </Field>
      <Field label="Shift">
        <select name="shift_id" defaultValue={e?.shift_id ?? shifts[0]?.id ?? ""} className="input">
          <option value="">—</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Work location">
        <input name="work_location" defaultValue={e?.work_location ?? ""} className="input" placeholder="Meerut / Noida / Remote" />
      </Field>
    </div>
  );
}
