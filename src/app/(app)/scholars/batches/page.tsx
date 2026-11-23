import Link from "next/link";
import { redirect } from "next/navigation";
import { can, canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { saveBatch } from "../actions";
import { ScholarsNav } from "../nav";

export const metadata = { title: "Batches · VSM Scholars" };

export default async function Batches({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["scholars.view", "scholars.teach"])) redirect("/dashboard");
  const sb = await supabaseServer();
  const [{ data: batches }, { data: courses }, { data: staff }] = await Promise.all([
    sb
      .from("scholar_batches")
      .select(
        "id, name, status, mode, location, capacity, starts_on, ends_on, schedule, course:scholar_courses(name), trainer:employees(full_name), seats:scholar_enrollments(count)",
      )
      .order("starts_on", { ascending: false }),
    sb.from("scholar_courses").select("id, name").eq("is_active", true),
    sb.from("employee_directory").select("id, full_name, designation").order("full_name"),
  ]);
  return (
    <>
      <PageHeader eyebrow="VSM Scholars" title="Batches" />
      <ScholarsNav active="/scholars/batches" />
      <Flash sp={sp} />
      {can(ctx, "scholars.admin") && (
        <details className="card mb-6 p-5" open={sp.new === "1"}>
          <summary className="cursor-pointer font-semibold">+ New batch</summary>
          <form action={saveBatch} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Course">
              <select name="course_id" required className="input">
                {(courses ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Batch name">
              <input name="name" required placeholder="DM-Jan-2027-Meerut" className="input" />
            </Field>
            <Field label="Trainer">
              <select name="trainer_id" className="input">
                <option value="">—</option>
                {(staff ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.designation ? ` · ${p.designation}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seats">
              <input name="capacity" type="number" min={1} max={500} defaultValue={25} className="input" />
            </Field>
            <Field label="Starts">
              <input name="starts_on" type="date" required className="input" />
            </Field>
            <Field label="Ends">
              <input name="ends_on" type="date" className="input" />
            </Field>
            <Field label="Schedule">
              <input name="schedule" placeholder="Mon–Fri 4–6 PM" className="input" />
            </Field>
            <Field label="Mode">
              <select name="mode" className="input">
                <option>OFFLINE</option>
                <option>ONLINE</option>
                <option>HYBRID</option>
              </select>
            </Field>
            <Field label="Location">
              <select name="location" className="input">
                <option>Meerut</option>
                <option>Noida</option>
                <option>Online</option>
              </select>
            </Field>
            <div className="flex items-end">
              <button className="btn-primary">Create batch</button>
            </div>
          </form>
        </details>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(batches ?? []).map(
          (b: {
            id: string;
            name: string;
            status: string;
            mode: string;
            location: string | null;
            capacity: number;
            starts_on: string;
            ends_on: string | null;
            schedule: string | null;
            course: unknown;
            trainer: unknown;
            seats: { count: number }[];
          }) => (
            <Link key={b.id} href={`/scholars/batches/${b.id}`} className="card block p-5 hover:border-volt/50">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{b.name}</p>
                <Badge tone={b.status === "RUNNING" ? "green" : b.status === "PLANNED" ? "amber" : "grey"}>{b.status}</Badge>
              </div>
              <p className="mt-1 text-sm">{(b.course as { name: string } | null)?.name}</p>
              <p className="mt-2 text-xs text-muted">
                {fmtDate(b.starts_on)}
                {b.ends_on ? ` → ${fmtDate(b.ends_on)}` : ""} · {b.schedule ?? b.mode.toLowerCase()} · {b.location ?? ""}
              </p>
              <p className="text-xs text-muted">
                Trainer: {(b.trainer as { full_name: string } | null)?.full_name ?? "—"} · {b.seats?.[0]?.count ?? 0}/{b.capacity} seats
              </p>
            </Link>
          ),
        )}
        {!batches?.length && <p className="text-sm text-muted">No batches yet.</p>}
      </div>
    </>
  );
}
