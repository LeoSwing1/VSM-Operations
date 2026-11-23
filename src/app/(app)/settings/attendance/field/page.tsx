import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { saveFieldSettings, saveOffice, setRemoteAllowed, toggleOffice } from "../field-actions";
import { UseMyLocation } from "./use-location";

export const metadata = { title: "Field attendance" };

export default async function FieldAttendance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("attendance.manage");
  const sb = await supabaseServer();
  const [{ data: s }, { data: offices }, { data: people }] = await Promise.all([
    sb.from("attendance_settings").select("*").eq("org_id", ctx.org_id).maybeSingle(),
    sb.from("office_locations").select("*").order("name"),
    sb.from("employees").select("id, full_name, designation, remote_allowed").neq("status", "EXITED").order("full_name"),
  ]);
  return (
    <>
      <PageHeader eyebrow="Attendance rules" title="Field & mobile attendance">
        <Link href="/settings/attendance" className="btn-ghost">
          ← Shifts & holidays
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Rules" hint="Applied by the database on every punch — phones can't bypass them.">
          <form action={saveFieldSettings} className="grid gap-3">
            <Field label="Office geofence">
              <select name="geofence_mode" defaultValue={s?.geofence_mode ?? "WARN"} className="input">
                <option value="OFF">Off — don't check location</option>
                <option value="WARN">Warn — save the punch, flag it for the manager if outside the office</option>
                <option value="ENFORCE">Enforce — refuse clock-in/out outside the office (remote-allowed people excepted)</option>
              </select>
            </Field>
            <Field label="Selfie at clock-in">
              <select name="selfie_mode" defaultValue={s?.selfie_mode ?? "OFF"} className="input">
                <option value="OFF">Off</option>
                <option value="OPTIONAL">Optional</option>
                <option value="REQUIRED">Required</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="require_location" defaultChecked={!!s?.require_location} /> Location must be shared to punch
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allow_offline" defaultChecked={s?.allow_offline ?? true} /> Allow offline punches (saved on the
              phone, synced later, always flagged)
            </label>
            <Field label="Accept offline punches up to (hours old)">
              <input name="offline_max_hours" type="number" min={1} max={48} defaultValue={s?.offline_max_hours ?? 12} className="input" />
            </Field>
            <div>
              <button className="btn-primary">Save rules</button>
            </div>
          </form>
          <p className="mt-4 text-xs text-muted">
            Selfies are stored privately; only the employee, their manager and HR can open them. Location is saved only at the moment of a
            punch — never tracked in between.
          </p>
        </Card>
        <Card title="Offices" hint="Stand inside the office and use your current location for the most accurate centre point.">
          <ul className="mb-4 divide-y divide-line text-sm">
            {(offices ?? []).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{o.name}</b>{" "}
                  <span className="text-xs text-muted">
                    · {Number(o.latitude).toFixed(5)}, {Number(o.longitude).toFixed(5)} · {o.radius_m} m
                  </span>{" "}
                  <a
                    className="text-xs text-volt hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`}
                  >
                    map
                  </a>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={o.is_active ? "green" : "grey"}>{o.is_active ? "ACTIVE" : "OFF"}</Badge>
                  <form action={toggleOffice}>
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="active" value={o.is_active ? "0" : "1"} />
                    <button className="text-xs text-muted hover:text-ink">{o.is_active ? "Switch off" : "Switch on"}</button>
                  </form>
                </span>
              </li>
            ))}
            {!offices?.length && (
              <li className="py-2 text-muted">
                No offices yet — add Meerut and Noida below. Until then, location is recorded but nothing is flagged.
              </li>
            )}
          </ul>
          <form action={saveOffice} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required placeholder="Meerut office" className="input" />
            </Field>
            <Field label="Radius (m)">
              <input name="radius_m" type="number" min={30} max={5000} defaultValue={150} className="input" />
            </Field>
            <Field label="Latitude">
              <input id="office-lat" name="latitude" required inputMode="decimal" className="input" />
            </Field>
            <Field label="Longitude">
              <input id="office-lng" name="longitude" required inputMode="decimal" className="input" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input name="address" className="input" />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <button className="btn-primary">Save office</button>
              <UseMyLocation />
            </div>
          </form>
        </Card>
      </div>
      <Card
        title="Remote work allowed"
        className="mt-6"
        hint="These people can punch from anywhere without being flagged (e.g. field sales, remote developers)."
      >
        <ul className="grid gap-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {(people ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <span className="truncate">
                {p.full_name} <span className="text-xs text-muted">{p.designation ?? ""}</span>
              </span>
              <form action={setRemoteAllowed}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="allowed" value={p.remote_allowed ? "0" : "1"} />
                <button className={p.remote_allowed ? "chip border-volt text-volt" : "chip border-line text-muted"}>
                  {p.remote_allowed ? "Remote ✓" : "Office"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
