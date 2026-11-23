import { requireContext, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { createCalendarEvent, respondToEvent } from "./actions";
import { fmtDateTime, localDate, zonedInstant } from "@/lib/engines/time";
export const metadata = { title: "Calendar" };
const iso = (d: Date) => d.toISOString().slice(0, 10),
  hourAt = (value: string, tz: string) =>
    Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(value))),
  plus = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)),
  startWeek = (d: Date) => plus(d, -((d.getUTCDay() + 6) % 7));
export default async function Calendar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requireContext(),
    sb = await supabaseServer();
  const view = (["month", "week", "day"].includes(sp.view ?? "") ? sp.view : "month") as "month" | "week" | "day";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : localDate(new Date(), ctx.timezone);
  const anchor = new Date(`${date}T12:00:00Z`);
  const first =
    view === "month" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)) : view === "week" ? startWeek(anchor) : anchor;
  const last =
    view === "month" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)) : view === "week" ? plus(first, 6) : anchor;
  const rangeStart = view === "month" ? startWeek(first) : first,
    rangeEnd = view === "month" ? plus(startWeek(last), 6) : last;
  const from = zonedInstant(iso(rangeStart), "00:00", ctx.timezone).toISOString(),
    to = zonedInstant(iso(rangeEnd), "23:59:59", ctx.timezone).toISOString();
  const [{ data: events }, { data: attendees }, { data: people }, { data: teams }, { data: departments }, { data: connections }] =
    await Promise.all([
      sb
        .from("calendar_events")
        .select(
          "id,title,description,event_type,visibility,starts_at,ends_at,location,meeting_url,organizer_id,status,recurrence_rule,recurrence_series_id",
        )
        .gte("ends_at", from)
        .lte("starts_at", to)
        .neq("status", "CANCELLED")
        .order("starts_at"),
      sb.from("calendar_attendees").select("event_id,employee_id,response"),
      sb.from("employee_directory").select("id,full_name").order("full_name"),
      sb.from("org_teams").select("id,name").eq("is_active", true).order("name"),
      sb.from("departments").select("id,name").order("name"),
      sb
        .from("calendar_provider_connections")
        .select("provider,account_email,last_synced_at,last_error")
        .eq("employee_id", ctx.employee_id),
    ]);
  const create = canAny(ctx, ["calendar.create", "calendar.manage"]);
  const byDay = new Map<string, any[]>();
  for (const e of events ?? []) {
    const k = localDate(new Date(e.starts_at), ctx.timezone);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const days = Array.from({ length: view === "day" ? 1 : view === "week" ? 7 : 42 }, (_, i) => plus(rangeStart, i));
  const prev =
    view === "month" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)) : plus(first, view === "week" ? -7 : -1);
  const next =
    view === "month" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)) : plus(first, view === "week" ? 7 : 1);
  const nav = (v: string, d: Date) => `/calendar?view=${v}&date=${iso(d)}`,
    todayAnchor = new Date(`${localDate(new Date(), ctx.timezone)}T12:00:00Z`);
  return (
    <>
      <PageHeader eyebrow="Planning & collaboration" title="Calendar">
        <a className="btn-ghost" href={`/api/reports/calendar?from=${iso(rangeStart)}&to=${iso(rangeEnd)}`}>
          Export .ics
        </a>
        <a className="btn-ghost" href="/meetings">
          Meetings →
        </a>
      </PageHeader>
      <Flash sp={sp} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <a className="btn-ghost" href={nav(view, prev)}>
            ←
          </a>
          <a className="btn-ghost" href={nav(view, todayAnchor)}>
            Today
          </a>
          <a className="btn-ghost" href={nav(view, next)}>
            →
          </a>
          <strong className="ml-2">{anchor.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
        </div>
        <div className="flex gap-1">
          {(["month", "week", "day"] as const).map((v) => (
            <a key={v} className={`btn-ghost capitalize ${view === v ? "border-volt" : ""}`} href={nav(v, anchor)}>
              {v}
            </a>
          ))}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        {create && (
          <Card title="Schedule an event">
            <form action={createCalendarEvent} className="grid gap-3">
              <Field label="Title">
                <input name="title" className="input" required maxLength={200} />
              </Field>
              <Field label="Type">
                <select name="event_type" className="input">
                  <option>MEETING</option>
                  <option>FOCUS</option>
                  <option>DEADLINE</option>
                  <option>TRAINING</option>
                  <option>OTHER</option>
                </select>
              </Field>
              <Field label="Visibility">
                <select name="visibility" className="input">
                  <option>INVITEES</option>
                  <option>ORG</option>
                  <option>DEPARTMENT</option>
                  <option>TEAM</option>
                  <option>PRIVATE</option>
                </select>
              </Field>
              <Field label="Department">
                <select name="department_id" className="input">
                  <option value="">Select department</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Team">
                <select name="team_id" className="input">
                  <option value="">Select team</option>
                  {(teams ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Invite attendees">
                <select name="attendee_ids" multiple className="input min-h-24">
                  {(people ?? [])
                    .filter((p) => p.id !== ctx.employee_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Date">
                <input name="date" type="date" defaultValue={date} className="input" required />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <input name="start" type="time" className="input" required />
                </Field>
                <Field label="End">
                  <input name="end" type="time" className="input" required />
                </Field>
              </div>
              <Field label="Repeat">
                <select name="recurrence" className="input">
                  <option value="">Does not repeat</option>
                  <option value="DAILY:5">Daily · 5 occurrences</option>
                  <option value="WEEKLY:8">Weekly · 8 occurrences</option>
                  <option value="MONTHLY:6">Monthly · 6 occurrences</option>
                </select>
              </Field>
              <Field label="Location">
                <input name="location" className="input" maxLength={200} />
              </Field>
              <Field label="Meeting URL">
                <input name="meeting_url" type="url" className="input" placeholder="https://…" />
              </Field>
              <Field label="Description">
                <textarea name="description" className="input" rows={2} maxLength={3000} />
              </Field>
              <button className="btn-primary">Create event & send invitations</button>
            </form>
          </Card>
        )}
        <Card
          title="Calendar integrations"
          hint="Connect a personal calendar. Events you organise in VSM Ops are copied to connected providers by the scheduled sync job."
        >
          <div className="flex flex-wrap gap-3">
            {(["GOOGLE", "MICROSOFT"] as const).map((provider) => {
              const connection = (connections ?? []).find((c) => c.provider === provider);
              const slug = provider.toLowerCase();
              return (
                <div key={provider} className="rounded-lg border border-line p-3">
                  <p className="font-semibold">{provider === "GOOGLE" ? "Google Calendar" : "Microsoft Outlook"}</p>
                  <p className="my-1 text-xs text-muted">
                    {connection
                      ? `${connection.account_email} · Last sync ${connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString("en-IN", { timeZone: ctx.timezone }) : "pending"}${connection.last_error ? ` · Sync issue: ${connection.last_error}` : ""}`
                      : "Not connected"}
                  </p>
                  <a className="btn-ghost" href={`/api/integrations/calendar/${slug}/connect`}>
                    {connection ? "Reconnect" : "Connect"}
                  </a>
                </div>
              );
            })}
          </div>
        </Card>
        <Card
          title={view === "month" ? "Month view" : view === "week" ? "Week view" : "Day view"}
          hint="Select Month, Week or Day above. All event times are displayed in your profile timezone."
        >
          {view === "month" && (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="bg-panel p-2 text-center text-xs font-semibold">
                  {d}
                </div>
              ))}
              {days.map((d) => {
                const key = iso(d),
                  items = byDay.get(key) ?? [],
                  inMonth = d.getUTCMonth() === anchor.getUTCMonth();
                return (
                  <a key={key} href={nav("day", d)} className={`min-h-24 bg-card p-2 hover:bg-panel ${inMonth ? "" : "opacity-45"}`}>
                    <div className="mb-1 text-xs font-semibold">{d.getUTCDate()}</div>
                    {items.slice(0, 3).map((e) => (
                      <div key={e.id} className="mb-1 truncate rounded bg-panel px-1 py-0.5 text-[10px]" title={e.title}>
                        {new Date(e.starts_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: ctx.timezone })}{" "}
                        {e.title}
                      </div>
                    ))}
                    {items.length > 3 && <p className="text-[10px] text-muted">+{items.length - 3} more</p>}
                  </a>
                );
              })}
            </div>
          )}
          {view !== "month" && (
            <div className={view === "week" ? "grid gap-2 md:grid-cols-7" : "space-y-3"}>
              {days.map((d) => {
                const key = iso(d),
                  items = byDay.get(key) ?? [];
                return (
                  <section key={key} className="min-w-0 rounded-xl border border-line p-2">
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <strong className="text-sm">
                        {d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                      </strong>
                      <span className="text-[10px] text-muted">{items.length}</span>
                    </div>
                    <div>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const matches = items.filter((e) => hourAt(e.starts_at, ctx.timezone) === hour);
                        return (
                          <div key={hour} className="grid min-h-9 grid-cols-[34px_1fr] border-t border-line/70">
                            <span className="pt-1 text-[10px] tabular-nums text-muted">{String(hour).padStart(2, "0")}:00</span>
                            <div className="min-w-0 py-0.5">
                              {matches.map((e) => (
                                <div key={e.id} className="mb-1 rounded-md bg-panel px-1.5 py-1 text-[11px]">
                                  {view === "day" ? (
                                    <Event e={e} ctx={ctx} attendees={attendees ?? []} />
                                  ) : (
                                    <p className="truncate font-semibold">
                                      {new Date(e.starts_at).toLocaleTimeString("en-IN", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        timeZone: ctx.timezone,
                                      })}{" "}
                                      {e.title}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {view === "month" && (
            <div className="mt-5 space-y-2">
              <h3 className="font-semibold">Selected day · {date}</h3>
              {(byDay.get(date) ?? []).map((e) => (
                <Event key={e.id} e={e} ctx={ctx} attendees={attendees ?? []} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
function Event({ e, ctx, attendees }: any) {
  const mine = attendees.find((a: any) => a.event_id === e.id && a.employee_id === ctx.employee_id);
  return (
    <article className="mb-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{e.title}</p>
          <p className="text-xs text-muted">
            {fmtDateTime(e.starts_at, ctx.timezone)} – {fmtDateTime(e.ends_at, ctx.timezone)}
          </p>
        </div>
        <Badge>{e.event_type}</Badge>
      </div>
      {e.description && <p className="mt-2 text-sm">{e.description}</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        {e.location && <span>⌖ {e.location}</span>}
        {e.meeting_url && (
          <a className="text-volt underline" href={e.meeting_url} target="_blank" rel="noreferrer">
            Join meeting
          </a>
        )}
        {e.recurrence_series_id && <span>Recurring</span>}
      </div>
      {mine && e.organizer_id !== ctx.employee_id && (
        <form action={respondToEvent} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="event_id" value={e.id} />
          <select name="response" defaultValue={mine.response} className="input max-w-[180px]">
            <option>ACCEPTED</option>
            <option>DECLINED</option>
            <option>TENTATIVE</option>
          </select>
          <button className="btn-ghost">Update response</button>
        </form>
      )}
    </article>
  );
}
