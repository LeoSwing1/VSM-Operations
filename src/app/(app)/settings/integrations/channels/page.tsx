import Link from "next/link";
import clsx from "clsx";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { channelConfig } from "@/lib/delivery/worker";
import { ORG_EVENTS } from "@/lib/delivery/events";
import { EVENT_LABEL } from "@/lib/delivery/messages";
import { IntegrationTabs } from "../tabs";
import { retryChannel, saveTeamChannel, testPush, testTeamChannel, testWhatsApp } from "../channel-actions";

export const metadata = { title: "Channels · Integrations" };
export const dynamic = "force-dynamic";
const CHANNELS = ["WHATSAPP", "PUSH", "SLACK", "TEAMS", "WEBHOOK"] as const;
const STATUSES = ["SENT", "QUEUED", "SENDING", "FAILED", "SKIPPED"] as const;

export default async function Channels({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: rows }, { data: failed }, { data: settings }, { data: statuses }, { count: optins }, { count: devices }] =
    await Promise.all([
      sb.from("delivery_outbox").select("channel, status").gte("created_at", since).limit(5000),
      sb
        .from("delivery_outbox")
        .select("id, channel, event_key, attempts, last_error, created_at")
        .eq("status", "FAILED")
        .order("created_at", { ascending: false })
        .limit(12),
      sb.from("integration_settings").select("key, enabled, events, updated_at"),
      sb.from("integration_status").select("key, last_success_at, last_failure_at, last_error, failure_count"),
      sb.from("whatsapp_optins").select("employee_id", { count: "exact", head: true }).eq("opted_in", true),
      sb.from("push_subscriptions").select("id", { count: "exact", head: true }).is("revoked_at", null),
    ]);
  const cfg = channelConfig();
  const n = (ch: string, s: string) => (rows ?? []).filter((r) => r.channel === ch && r.status === s).length;
  const st = (k: string) => statuses?.find((s) => s.key === k);
  const setting = (k: "slack" | "teams") => settings?.find((s) => s.key === k);
  const health = (configured: boolean, k: string) => {
    const s = st(k);
    if (!configured) return <Badge tone="grey">NOT CONFIGURED</Badge>;
    if (!s?.last_success_at && !s?.last_failure_at) return <Badge tone="amber">NOT TESTED</Badge>;
    if (s.last_failure_at && (!s.last_success_at || s.last_failure_at > s.last_success_at)) return <Badge tone="red">FAILING</Badge>;
    return <Badge tone="green">HEALTHY</Badge>;
  };
  const Last = ({ k }: { k: string }) => {
    const s = st(k);
    return (
      <p className="mt-2 text-xs text-muted">
        Last success {s?.last_success_at ? fmtDateTime(s.last_success_at, ctx.timezone) : "—"} · last failure{" "}
        {s?.last_failure_at ? fmtDateTime(s.last_failure_at, ctx.timezone) : "—"}
        {s?.last_error && <span className="block break-words text-danger">{s.last_error}</span>}
      </p>
    );
  };
  const Env = ({ names }: { names: string[] }) => (
    <p className="mt-1 flex flex-wrap gap-1">
      {names.map((v) => (
        <code
          key={v}
          className={clsx("rounded px-1.5 py-0.5 text-[10px]", process.env[v] ? "bg-volt/15 text-volt" : "bg-white/5 text-muted")}
        >
          {v} {process.env[v] ? "✓" : "missing"}
        </code>
      ))}
    </p>
  );

  return (
    <>
      <PageHeader eyebrow="Administration · integrations" title="Delivery channels" />
      <IntegrationTabs active="/settings/integrations/channels" />
      <Flash sp={sp} />

      <Card
        title="Delivery queue · last 7 days"
        hint="Every message is written to the outbox inside the same transaction as the business event, then sent by the worker with retries (1, 5, 15, 60, 240 min)."
      >
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Channel</th>
                {STATUSES.map((s) => (
                  <th key={s} className="text-right">
                    {s.toLowerCase()}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((c) => (
                <tr key={c}>
                  <td className="font-medium">{c.toLowerCase()}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className={clsx("text-right tabular-nums", s === "FAILED" && n(c, s) > 0 && "text-danger")}>
                      {n(c, s)}
                    </td>
                  ))}
                  <td className="text-right">
                    {n(c, "FAILED") > 0 && (
                      <form action={retryChannel}>
                        <input type="hidden" name="channel" value={c} />
                        <button className="text-xs text-volt hover:underline">Retry {n(c, "FAILED")}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="WhatsApp Business · Cloud API" action={health(cfg.whatsapp, "whatsapp")}>
          <p className="text-sm text-muted">
            Personal alerts (approvals, leave, payslip ready, shift reminders) to employees who opted in. Uses the approved template{" "}
            <code>{process.env.WHATSAPP_TEMPLATE ?? "vsm_notification"}</code> with 2 variables: title and link. Amounts are never sent.
          </p>
          <Env names={["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_TEMPLATE"]} />
          <p className="mt-2 text-xs">{optins ?? 0} employees opted in.</p>
          <Last k="whatsapp" />
          <form action={testWhatsApp} className="mt-3">
            <button className="btn-ghost" disabled={!cfg.whatsapp}>
              Send test to my WhatsApp
            </button>
          </form>
        </Card>
        <Card title="Web push · VAPID" action={health(cfg.push, "push")}>
          <p className="text-sm text-muted">
            Browser and installed-app notifications on desktop and Android (iOS 16.4+ when installed to the home screen). Expired devices
            are removed automatically.
          </p>
          <Env names={["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]} />
          <p className="mt-2 text-xs">{devices ?? 0} active devices across the organisation.</p>
          <Last k="push" />
          <form action={testPush} className="mt-3">
            <button className="btn-ghost" disabled={!cfg.push}>
              Send test push to my devices
            </button>
          </form>
        </Card>

        {(["slack", "teams"] as const).map((k) => {
          const s = setting(k);
          const active = new Set(
            s?.events ?? ["lead.created", "lead.won", "employee.joined", "announcement.published", "integration.failing"],
          );
          const configured = k === "slack" ? cfg.slack : cfg.teams;
          return (
            <Card key={k} title={k === "slack" ? "Slack" : "Microsoft Teams"} action={health(configured, k)}>
              <p className="text-sm text-muted">
                {k === "slack"
                  ? "Incoming webhook into one channel (e.g. #vsm-ops)."
                  : "Teams Workflows “Post to a channel when a webhook request is received” (or a legacy connector URL)."}{" "}
                Company-level events only — no salaries, no personal data beyond names.
              </p>
              <Env names={[k === "slack" ? "SLACK_WEBHOOK_URL" : "TEAMS_WEBHOOK_URL"]} />
              <form action={saveTeamChannel} className="mt-3 space-y-2">
                <input type="hidden" name="key" value={k} />
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name="enabled" defaultChecked={!!s?.enabled} className="h-4 w-4 accent-[#D7FF3A]" /> Send events to{" "}
                  {k === "slack" ? "Slack" : "Teams"}
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {ORG_EVENTS.map((e) => (
                    <label key={e} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name={`ev:${e}`} defaultChecked={active.has(e)} className="accent-[#D7FF3A]" />
                      {EVENT_LABEL[e]}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="btn-primary">Save routing</button>
                </div>
              </form>
              <form action={testTeamChannel} className="mt-2">
                <input type="hidden" name="key" value={k} />
                <button className="btn-ghost" disabled={!configured}>
                  Send test message
                </button>
              </form>
              <Last k={k} />
            </Card>
          );
        })}
      </div>

      {!!failed?.length && (
        <Card title="Recent failed deliveries" className="mt-6">
          <ul className="divide-y divide-line text-sm">
            {failed.map((f) => (
              <li key={f.id} className="grid gap-1 py-2 sm:grid-cols-[140px_90px_1fr]">
                <span className="text-xs text-muted">{fmtDateTime(f.created_at, ctx.timezone)}</span>
                <span className="text-xs font-semibold">{f.channel.toLowerCase()}</span>
                <span className="text-xs">
                  <span className="font-mono">{f.event_key}</span> · {f.attempts} attempts ·{" "}
                  <span className="text-danger">{f.last_error}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-6 text-xs text-muted">
        Employees choose WhatsApp and push per category in{" "}
        <Link href="/notifications/preferences" className="text-volt hover:underline">
          Notification preferences
        </Link>
        .
      </p>
    </>
  );
}
