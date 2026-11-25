import { appUrl } from "@/lib/app-url";
import { requireContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { GOOGLE_SCOPES, googleClient } from "@/lib/google/oauth";
import { IntegrationTabs } from "../tabs";
import { disconnectGoogle, runCalendarSyncNow, saveGoogleSettings } from "../google-actions";

export const metadata = { title: "Google Workspace · Integrations" };
export const dynamic = "force-dynamic";

export default async function GooglePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const admin = can(ctx, "settings.manage");
  const sb = await supabaseServer();
  const [{ data: mine }, { data: gws }] = await Promise.all([
    sb
      .from("calendar_provider_connections")
      .select("account_email, scopes, last_synced_at, last_error, sync_enabled")
      .eq("employee_id", ctx.employee_id)
      .eq("provider", "GOOGLE")
      .maybeSingle(),
    sb.from("google_workspace_settings").select("*").eq("org_id", ctx.org_id).maybeSingle(),
  ]);
  const has = (s: keyof typeof GOOGLE_SCOPES) => !!mine?.scopes?.includes(GOOGLE_SCOPES[s]);
  const connect = (services: string) => `/api/integrations/calendar/google/connect?services=${services}&next=/settings/integrations/google`;
  const configured = !!googleClient();
  // Admin-only overview (service role used only after the permission check).
  const [conns, queue] = admin
    ? await Promise.all([
        supabaseAdmin()
          .from("calendar_provider_connections")
          .select("employee_id, account_email, scopes, last_error, employee:employees(full_name)")
          .eq("org_id", ctx.org_id)
          .eq("provider", "GOOGLE"),
        supabaseAdmin()
          .from("calendar_sync_queue")
          .select("status")
          .eq("org_id", ctx.org_id)
          .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
          .limit(5000),
      ])
    : [{ data: null }, { data: null }];
  const gmailPeople = (conns.data ?? []).filter((c: { scopes: string[] }) => c.scopes.includes(GOOGLE_SCOPES.gmail));
  const q = (s: string) => (queue.data ?? []).filter((r: { status: string }) => r.status === s).length;

  return (
    <>
      <PageHeader eyebrow="Administration · integrations" title="Google Workspace" />
      {admin && <IntegrationTabs active="/settings/integrations/google" />}
      <Flash sp={sp} />
      {!configured && (
        <p className="mb-6 rounded-xl border border-ember/40 bg-ember/10 px-4 py-3 text-sm">
          Google isn&apos;t configured yet. Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{" "}
          <code>CALENDAR_TOKEN_ENCRYPTION_KEY</code> in Vercel (see RUNBOOK → Google Workspace), with redirect URI{" "}
          <code>{appUrl()}/api/integrations/calendar/google/callback</code>.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="My Google account" action={mine ? <Badge tone="green">CONNECTED</Badge> : <Badge tone="grey">NOT CONNECTED</Badge>}>
          {mine ? (
            <>
              <p className="text-sm">
                <b>{mine.account_email}</b>
                {mine.last_synced_at && (
                  <span className="text-xs text-muted"> · last sync {fmtDateTime(mine.last_synced_at, ctx.timezone)}</span>
                )}
              </p>
              {mine.last_error && <p className="mt-1 text-xs text-danger">{mine.last_error}</p>}
              <ul className="mt-3 space-y-2 text-sm">
                {(
                  [
                    ["calendar", "Calendar — your VSM meetings appear in Google Calendar; your Google events show in VSM"],
                    ["drive", "Drive — copy employee documents to the company folder (HR)"],
                    ["gmail", "Gmail — send company emails from this account (admin)"],
                  ] as const
                ).map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span>
                      {has(k) ? "✓" : "○"} {label}
                    </span>
                    {!has(k) && configured && (
                      <a
                        className="text-xs text-volt hover:underline"
                        href={connect(["calendar", ...(has("drive") ? ["drive"] : []), ...(has("gmail") ? ["gmail"] : []), k].join(","))}
                      >
                        Allow
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <form action={disconnectGoogle} className="mt-4">
                <button className="text-xs text-muted hover:text-danger">Disconnect Google</button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Connect once to sync meetings both ways. You can add Drive and Gmail later.</p>
              {configured && (
                <a href={connect("calendar")} className="btn-primary mt-3 inline-block">
                  Connect Google
                </a>
              )}
            </>
          )}
        </Card>
        {admin && (
          <Card title="Company settings">
            <form action={saveGoogleSettings} className="grid gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="calendar_two_way" defaultChecked={gws?.calendar_two_way ?? true} /> Two-way calendar sync for
                everyone who connects
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="drive_enabled" defaultChecked={!!gws?.drive_enabled} /> Allow copying employee documents to
                Google Drive
              </label>
              <Field label="Drive folder (ID or link)">
                <input
                  name="drive_folder_id"
                  defaultValue={gws?.drive_folder_id ?? ""}
                  placeholder="https://drive.google.com/drive/folders/…"
                  className="input"
                />
              </Field>
              <Field label="Send company emails through Gmail as">
                <select name="gmail_sender_employee_id" defaultValue={gws?.gmail_sender_employee_id ?? ""} className="input">
                  <option value="">— not used (Brevo / Resend) —</option>
                  {gmailPeople.map((c: { employee_id: string; account_email: string | null; employee: unknown }) => (
                    <option key={c.employee_id} value={c.employee_id}>
                      {(c.employee as { full_name: string } | null)?.full_name} · {c.account_email}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-muted">
                To use Gmail for all emails also set <code>EMAIL_PROVIDER=gmail</code> in Vercel. Gmail limits: ~2,000 messages/day on
                Workspace.
              </p>
              <div>
                <button className="btn-primary">Save</button>
              </div>
            </form>
          </Card>
        )}
      </div>
      {admin && (
        <Card
          title="Calendar sync · last 7 days"
          className="mt-6"
          action={
            <form action={runCalendarSyncNow}>
              <button className="text-xs text-volt hover:underline">Run now</button>
            </form>
          }
        >
          <div className="grid grid-cols-4 gap-2 text-center">
            {["DONE", "QUEUED", "FAILED", "SKIPPED"].map((s) => (
              <div key={s}>
                <p className={`display text-3xl tabular-nums ${s === "FAILED" && q(s) ? "text-danger" : ""}`}>{q(s)}</p>
                <p className="text-[10px] uppercase text-muted">{s.toLowerCase()}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 divide-y divide-line text-sm">
            {(conns.data ?? []).map(
              (c: {
                employee_id: string;
                account_email: string | null;
                scopes: string[];
                last_error: string | null;
                employee: unknown;
              }) => (
                <li key={c.employee_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {(c.employee as { full_name: string } | null)?.full_name}{" "}
                    <span className="text-xs text-muted">· {c.account_email}</span>
                  </span>
                  <span className="flex gap-1 text-[10px]">
                    {(["calendar", "drive", "gmail"] as const).map((k) => (
                      <span
                        key={k}
                        className={c.scopes.includes(GOOGLE_SCOPES[k]) ? "chip border-volt/50 text-volt" : "chip border-line text-muted"}
                      >
                        {k}
                      </span>
                    ))}
                    {c.last_error && (
                      <span className="chip border-danger/50 text-danger" title={c.last_error}>
                        error
                      </span>
                    )}
                  </span>
                </li>
              ),
            )}
            {!conns.data?.length && <li className="py-2 text-muted">Nobody has connected Google yet.</li>}
          </ul>
        </Card>
      )}
    </>
  );
}
