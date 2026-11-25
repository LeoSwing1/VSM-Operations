import { appUrl } from "@/lib/app-url";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { retryFailed, testAuthAdmin, testDatabase, testEmail, testRealtime, testStorage } from "./actions";
import clsx from "clsx";
import { IntegrationTabs } from "./tabs";
import { channelConfig } from "@/lib/delivery/worker";
import Link from "next/link";

export const metadata = { title: "Integration Control Centre" };
export const dynamic = "force-dynamic";
interface Status {
  key: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  failure_count: number;
}
const FUTURE = [
  ["VSM Scholars", "Training, student and certificate sync", "Not integrated", "Documented API contract and service credentials"],
  [
    "FCM / APNs (native apps)",
    "Push for future native iOS/Android apps",
    "Web push covers installed PWAs",
    "Firebase project and Apple push credentials",
  ],
] as const;

export default async function Integrations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: statuses }, { data: outbox }, { data: failures }, { data: lastLead }, { data: calendar }, { data: checks }] =
    await Promise.all([
      sb.from("integration_status").select("*"),
      sb.from("email_outbox").select("status").gte("created_at", since),
      sb
        .from("email_outbox")
        .select("id, template, to_email, attempts, last_error, created_at")
        .eq("status", "FAILED")
        .order("created_at", { ascending: false })
        .limit(10),
      sb.from("leads").select("created_at").eq("source", "WEBSITE").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("calendar_provider_connections").select("provider,account_email,last_synced_at,last_error,sync_enabled"),
      sb
        .from("integration_check_runs")
        .select("id,integration_key,status,latency_ms,message,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
  const st = (k: string) => (statuses ?? []).find((s) => s.key === k) as Status | undefined;
  const count = (s: string) => (outbox ?? []).filter((o) => o.status === s).length;
  const provider = (process.env.EMAIL_PROVIDER ?? (process.env.BREVO_API_KEY ? "brevo" : "resend")).toLowerCase();
  const emailConfigured = !!process.env.EMAIL_FROM && (provider === "brevo" ? !!process.env.BREVO_API_KEY : !!process.env.RESEND_API_KEY);
  const oauth = [
    {
      key: "GOOGLE",
      label: "Google Calendar",
      configured: !!process.env.GOOGLE_CALENDAR_CLIENT_ID && !!process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    },
    {
      key: "MICROSOFT",
      label: "Microsoft Outlook",
      configured: !!process.env.MICROSOFT_CALENDAR_CLIENT_ID && !!process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
    },
  ];
  const state = (configured: boolean, s?: Status) => {
    if (!configured) return { label: "NOT CONFIGURED", tone: "grey" as const };
    if (!s || (!s.last_success_at && !s.last_failure_at)) return { label: "NOT TESTED", tone: "amber" as const };
    if (s.last_failure_at && (!s.last_success_at || s.last_failure_at > s.last_success_at))
      return { label: "FAILING", tone: "red" as const };
    return { label: "HEALTHY", tone: "green" as const };
  };
  const cfg = channelConfig();
  const cron = st("cron"),
    cronConfigured = !!process.env.CRON_SECRET;
  const cronStale = !cron?.last_success_at || Date.now() - Date.parse(cron.last_success_at) > 26 * 3600_000;
  const Head = ({ title, label, tone }: { title: string; label: string; tone: "grey" | "amber" | "red" | "green" }) => (
    <div className="flex items-start justify-between gap-2">
      <p className="font-display text-xl">{title}</p>
      <Badge tone={tone}>{label}</Badge>
    </div>
  );
  const Meta = ({ s }: { s?: Status }) => (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted">Last success</dt>
      <dd>{s?.last_success_at ? fmtDateTime(s.last_success_at, ctx.timezone) : "—"}</dd>
      <dt className="text-muted">Last failure</dt>
      <dd>{s?.last_failure_at ? fmtDateTime(s.last_failure_at, ctx.timezone) : "—"}</dd>
      <dt className="text-muted">Consecutive failures</dt>
      <dd className={clsx(s?.failure_count && "text-danger")}>{s?.failure_count ?? 0}</dd>
      {s?.last_error && (
        <>
          <dt className="text-muted">Last error</dt>
          <dd className="break-words text-danger">{s.last_error}</dd>
        </>
      )}
    </dl>
  );
  return (
    <>
      <PageHeader eyebrow="Administration · diagnostics and readiness" title="Integration Control Centre" />
      <IntegrationTabs active="/settings/integrations" />
      <Flash sp={sp} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-xs text-muted">Connected calendar accounts</p>
          <p className="display text-3xl">{(calendar ?? []).length}</p>
          <p className="text-xs text-muted">Across this organisation</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Email failures · 7 days</p>
          <p className={clsx("display text-3xl", count("FAILED") > 0 && "text-danger")}>{count("FAILED")}</p>
          <p className="text-xs text-muted">
            Queued {count("QUEUED")} · Sent {count("SENT")}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Recent diagnostic checks</p>
          <p className="display text-3xl">{(checks ?? []).length}</p>
          <p className="text-xs text-muted">Latest 20 saved results</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Cron heartbeat</p>
          <p className="display text-2xl">{!cronConfigured ? "Not configured" : cronStale ? "Stale / not seen" : "Recent"}</p>
          <p className="text-xs text-muted">
            Last success {cron?.last_success_at ? fmtDateTime(cron.last_success_at, ctx.timezone) : "not recorded"}
          </p>
        </Card>
      </div>

      <h2 className="eyebrow mb-3">Core platform · run live checks</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Head title="Database · Supabase" {...state(true, st("database"))} />
          <p className="mt-1 text-sm text-muted">Authenticated database round-trip using the current session and organisation RLS.</p>
          <Meta s={st("database")} />
          <form action={testDatabase} className="mt-4">
            <button className="btn-ghost">Run database check</button>
          </form>
        </Card>
        <Card>
          <Head title={`Email · ${provider === "brevo" ? "Brevo" : "Resend"}`} {...state(emailConfigured, st("email"))} />
          <p className="mt-1 text-sm text-muted">
            Sender: <span className="text-ink">{process.env.EMAIL_FROM ?? "not set"}</span> · key {emailConfigured ? "present" : "missing"}
          </p>
          <Meta s={st("email")} />
          <form action={testEmail} className="mt-4">
            <button className="btn-primary">Send real test email to {ctx.email}</button>
          </form>
        </Card>
        <Card>
          <Head
            title="Supabase Storage"
            {...state(!!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY, st("storage"))}
          />
          <p className="mt-1 text-sm text-muted">
            Checks service-role access and required private buckets: employee-private, finance-receipts, chat-files and quality-evidence.
          </p>
          <Meta s={st("storage")} />
          <form action={testStorage} className="mt-4">
            <button className="btn-ghost">Check Storage buckets</button>
          </form>
        </Card>
        <Card>
          <Head
            title="Supabase Auth Admin"
            {...state(!!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY, st("auth"))}
          />
          <p className="mt-1 text-sm text-muted">Checks service-role access to the Auth Admin API. No user details are displayed.</p>
          <Meta s={st("auth")} />
          <form action={testAuthAdmin} className="mt-4">
            <button className="btn-ghost">Check Auth Admin API</button>
          </form>
        </Card>
        <Card>
          <Head
            title="Supabase Realtime"
            {...state(!!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY, st("realtime"))}
          />
          <p className="mt-1 text-sm text-muted">
            Tests a temporary channel handshake. This verifies transport availability, not that chat is already using live subscriptions.
          </p>
          <Meta s={st("realtime")} />
          <form action={testRealtime} className="mt-4">
            <button className="btn-ghost">Test Realtime handshake</button>
          </form>
        </Card>
        <Card>
          <Head
            title="Scheduler · Vercel Cron"
            label={!cronConfigured ? "NOT CONFIGURED" : !cron?.last_success_at ? "NO HEARTBEAT" : cronStale ? "STALE" : "HEALTHY"}
            tone={!cronConfigured ? "grey" : cronStale ? "red" : "green"}
          />
          <p className="mt-1 text-sm text-muted">
            Protected by CRON_SECRET. Heartbeats are recorded by scheduled workers; this panel does not trigger production jobs manually.
          </p>
          <Meta s={cron} />
          <p className="mt-3 text-xs text-muted">Configure CRON_SECRET and ensure all cron routes are scheduled in the deployed project.</p>
        </Card>
      </div>

      <h2 className="eyebrow mb-3 mt-8">Calendar provider connections</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {oauth.map((p) => {
          const accounts = (calendar ?? []).filter((c) => c.provider === p.key);
          const failed = accounts.filter((c) => !!c.last_error).length;
          return (
            <Card key={p.key}>
              <Head
                title={p.label}
                label={
                  !p.configured
                    ? "CREDENTIALS MISSING"
                    : accounts.length
                      ? failed
                        ? "SYNC ISSUES"
                        : "ACCOUNTS LINKED"
                      : "READY · NO ACCOUNTS"
                }
                tone={!p.configured ? "grey" : failed ? "red" : accounts.length ? "green" : "amber"}
              />
              <p className="mt-1 text-sm text-muted">
                OAuth credentials {p.configured ? "present" : "missing"}; encryption key{" "}
                {process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ? "present" : "missing"}.
              </p>
              {accounts.length ? (
                <div className="mt-3 space-y-2">
                  {accounts.map((a, i) => (
                    <div key={`${a.provider}-${a.account_email}-${i}`} className="rounded-lg border border-line p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <strong>{a.account_email}</strong>
                        <Badge tone={a.sync_enabled ? (a.last_error ? "red" : "green") : "grey"}>
                          {a.sync_enabled ? (a.last_error ? "SYNC ERROR" : "SYNC ENABLED") : "PAUSED"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Last sync: {a.last_synced_at ? fmtDateTime(a.last_synced_at, ctx.timezone) : "not yet synced"}
                      </p>
                      {a.last_error && <p className="mt-1 break-words text-xs text-danger">{a.last_error}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">No user calendar accounts are linked to this organisation yet.</p>
              )}
              <p className="mt-3 text-xs text-muted">
                Redirect URI: {appUrl()}/api/integrations/calendar/
                {p.key === "GOOGLE" ? "google" : "microsoft"}/callback
              </p>
            </Card>
          );
        })}
      </div>

      <h2 className="eyebrow mb-3 mt-8">Website → CRM intake</h2>
      <Card>
        <Head
          title="Public enquiry endpoint"
          label={
            !process.env.ENQUIRY_ALLOWED_ORIGINS || !process.env.ORG_SLUG
              ? "CONFIGURATION INCOMPLETE"
              : lastLead
                ? "LEADS RECEIVED"
                : "CONFIGURED · NO RECENT LEADS"
          }
          tone={!process.env.ENQUIRY_ALLOWED_ORIGINS || !process.env.ORG_SLUG ? "grey" : lastLead ? "green" : "amber"}
        />
        <p className="mt-2 text-sm text-muted">
          Organisation slug: <span className="text-ink">{process.env.ORG_SLUG ?? "missing"}</span> · Allowed origins:{" "}
          <span className="text-ink">{process.env.ENQUIRY_ALLOWED_ORIGINS ?? "missing"}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          Last website lead: {lastLead ? fmtDateTime(lastLead.created_at, ctx.timezone) : "none recorded"}. The intake key is never
          displayed.
        </p>
      </Card>

      <h2 className="eyebrow mb-3 mt-8">Email operations</h2>
      <Card
        title="Email outbox · last 7 days"
        action={
          count("FAILED") > 0 ? (
            <form action={retryFailed}>
              <button className="btn-ghost">Retry {count("FAILED")} failed</button>
            </form>
          ) : undefined
        }
      >
        <div className="grid grid-cols-5 gap-2 text-center">
          {["SENT", "QUEUED", "SENDING", "FAILED", "SKIPPED"].map((s) => (
            <div key={s}>
              <p className={clsx("display text-3xl tabular-nums", s === "FAILED" && count(s) > 0 && "text-danger")}>{count(s)}</p>
              <p className="text-[10px] text-muted">{s.toLowerCase()}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Retry requeues failed messages; the scheduled email worker performs delivery.</p>
      </Card>
      {!!failures?.length && (
        <Card title="Recent failed emails" className="mt-4">
          <TableWrap>
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Template</th>
                  <th>To</th>
                  <th>Attempts</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(f.created_at, ctx.timezone)}</td>
                    <td className="font-mono text-xs">{f.template}</td>
                    <td className="text-xs">{f.to_email.replace(/^(.{2}).*(@.*)$/, "$1…$2")}</td>
                    <td>{f.attempts}</td>
                    <td className="text-xs text-danger">{f.last_error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <h2 className="eyebrow mb-3 mt-8">Diagnostic history</h2>
      <Card title="Latest integration checks">
        {!checks?.length ? (
          <p className="text-sm text-muted">No saved checks yet. Run one of the tests above to start the history.</p>
        ) : (
          <TableWrap>
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Integration</th>
                  <th>Result</th>
                  <th>Latency</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(c.created_at, ctx.timezone)}</td>
                    <td className="font-medium">{c.integration_key.toUpperCase()}</td>
                    <td>
                      <Badge tone={c.status === "HEALTHY" ? "green" : c.status === "FAILED" ? "red" : "amber"}>{c.status}</Badge>
                    </td>
                    <td>{c.latency_ms == null ? "—" : `${c.latency_ms} ms`}</td>
                    <td className="text-xs">{c.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <h2 className="eyebrow mb-3 mt-8">Channels and external systems</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["WhatsApp Business", "whatsapp", cfg.whatsapp, "/settings/integrations/channels"],
            ["Web push", "push", cfg.push, "/settings/integrations/channels"],
            ["Slack", "slack", cfg.slack, "/settings/integrations/channels"],
            ["Microsoft Teams", "teams", cfg.teams, "/settings/integrations/channels"],
            ["Outbound webhooks", "webhooks", true, "/settings/integrations/webhooks"],
            ["Meta Lead Ads", "meta_leads", cfg.meta_leads, "/settings/integrations/inbound"],
            ["Razorpay", "razorpay", cfg.razorpay, "/settings/integrations/inbound"],
            ["Product analytics · PostHog", "analytics", cfg.analytics, "/settings/integrations"],
          ] as const
        ).map(([label, key, ok, href]) => (
          <Link key={label} href={href} className="card flex items-center justify-between gap-2 p-4 hover:border-volt/50">
            <span className="text-sm font-semibold">{label}</span>
            <Badge tone={ok ? state(true, st(key)).tone : "grey"}>{ok ? state(true, st(key)).label : "NOT CONFIGURED"}</Badge>
          </Link>
        ))}
      </div>

      <h2 className="eyebrow mb-3 mt-8">Integration roadmap · not connected yet</h2>
      <Card>
        <TableWrap>
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Integration</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Required before implementation</th>
              </tr>
            </thead>
            <tbody>
              {FUTURE.map(([name, purpose, status, req]) => (
                <tr key={name}>
                  <td className="font-medium">{name}</td>
                  <td className="text-sm">{purpose}</td>
                  <td>
                    <Badge tone="grey">{status}</Badge>
                  </td>
                  <td className="text-xs text-muted">{req}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
