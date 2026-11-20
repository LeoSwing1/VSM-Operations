import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { retryFailed, testDatabase, testEmail } from "./actions";
import clsx from "clsx";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

interface Status { key: string; last_test_at: string | null; last_test_ok: boolean | null; last_success_at: string | null; last_failure_at: string | null; last_error: string | null; failure_count: number }

/** Planned integrations — shown honestly as not built, with the block that delivers them. */
const PLANNED: [string, string, number][] = [
  ["Supabase Realtime", "Chat, presence, live notifications", 2], ["Supabase Storage", "Attachments, documents, payslip PDFs", 3],
  ["Google Calendar + Meet", "Meetings sync and invites", 6], ["VSM Scholars API", "Training, students, certificates", 7],
  ["Automation scheduler", "Attendance, deadline and follow-up triggers", 8], ["WhatsApp", "Leads, reminders, alerts", 9],
  ["Web push", "Browser notifications", 9], ["Slack / Teams", "Team channel feed", 9], ["Outbound webhooks", "Zapier / n8n", 9],
  ["Meta Lead Ads", "Campaign leads into CRM", 9], ["Razorpay", "Payout references, client payments", 9], ["Analytics", "Product usage", 9],
  ["FCM / APNs push", "Mobile app notifications", 10],
];

export default async function Integrations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: statuses }, { data: outbox }, { data: failures }, { data: lastLead }] = await Promise.all([
    sb.from("integration_status").select("*"),
    sb.from("email_outbox").select("status").gte("created_at", since),
    sb.from("email_outbox").select("id, template, to_email, attempts, last_error, created_at").eq("status", "FAILED").order("created_at", { ascending: false }).limit(10),
    sb.from("leads").select("created_at").eq("source", "WEBSITE").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const st = (k: string) => (statuses ?? []).find((s) => s.key === k) as Status | undefined;
  const count = (s: string) => (outbox ?? []).filter((o) => o.status === s).length;
  const provider = (process.env.EMAIL_PROVIDER ?? (process.env.BREVO_API_KEY ? "brevo" : "resend")).toLowerCase();
  const emailConfigured = !!process.env.EMAIL_FROM && (provider === "brevo" ? !!process.env.BREVO_API_KEY : !!process.env.RESEND_API_KEY);
  const tz = ctx.timezone;
  const cron = st("cron");
  const cronStale = !cron?.last_success_at || Date.now() - Date.parse(cron.last_success_at) > 26 * 3600_000;

  /** State rule: never "Connected" until a real test or delivery succeeded. */
  const state = (configured: boolean, s?: Status) => {
    if (!configured) return { label: "NOT CONFIGURED", tone: "grey" as const };
    if (!s || (!s.last_success_at && !s.last_failure_at)) return { label: "UNTESTED", tone: "amber" as const };
    if (s.last_failure_at && (!s.last_success_at || s.last_failure_at > s.last_success_at)) return { label: "FAILING", tone: "red" as const };
    return { label: "HEALTHY", tone: "green" as const };
  };
  const Meta = ({ s }: { s?: Status }) => (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted">Last success</dt><dd>{s?.last_success_at ? fmtDateTime(s.last_success_at, tz) : "—"}</dd>
      <dt className="text-muted">Last failure</dt><dd>{s?.last_failure_at ? fmtDateTime(s.last_failure_at, tz) : "—"}</dd>
      <dt className="text-muted">Failures in a row</dt><dd className={clsx(s?.failure_count && "text-danger")}>{s?.failure_count ?? 0}</dd>
      {s?.last_error && <><dt className="text-muted">Last error</dt><dd className="break-words text-danger">{s.last_error}</dd></>}
    </dl>
  );
  const Head = ({ title, s }: { title: string; s: { label: string; tone: "grey" | "amber" | "red" | "green" } }) => (
    <div className="flex items-start justify-between gap-2"><p className="font-display text-2xl">{title}</p><Badge tone={s.tone}>{s.label}</Badge></div>
  );

  return (
    <>
      <PageHeader eyebrow="Administration · real test results only" title="Integrations" />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Head title="Database · Supabase" s={state(true, st("database"))} />
          <p className="mt-1 text-sm text-muted">Postgres with row-level security on every table.</p>
          <Meta s={st("database")} />
          <form action={testDatabase} className="mt-4"><button className="btn-ghost">Run check</button></form>
        </Card>

        <Card>
          <Head title={`Email · ${provider === "brevo" ? "Brevo" : "Resend"}`} s={state(emailConfigured, st("email"))} />
          <p className="mt-1 text-sm text-muted">From <span className="text-ink">{process.env.EMAIL_FROM ?? "— not set"}</span> · API key {emailConfigured ? "set" : "missing"}</p>
          <Meta s={st("email")} />
          <form action={testEmail} className="mt-4"><button className="btn-primary">Send test email to {ctx.email}</button></form>
        </Card>

        <Card>
          <Head title="Scheduler · cron" s={!process.env.CRON_SECRET ? { label: "NOT CONFIGURED", tone: "grey" } : !cron?.last_success_at ? { label: "NO RUN YET", tone: "amber" } : cronStale ? { label: "STALE", tone: "red" } : { label: "RUNNING", tone: "green" }} />
          <p className="mt-1 text-sm text-muted">Sends queued emails every 5 min and the daily summary at 7 pm IST. On Vercel Hobby, use cron-job.org (see RUNBOOK §5).</p>
          <Meta s={cron} />
        </Card>

        <Card>
          <Head title="Website enquiries · vsmgrowth.com" s={!process.env.ENQUIRY_ALLOWED_ORIGINS ? { label: "NOT CONFIGURED", tone: "grey" } : lastLead ? { label: "RECEIVING", tone: "green" } : { label: "NO ENQUIRIES YET", tone: "amber" }} />
          <p className="mt-1 text-sm text-muted">Allowed origins: <span className="text-ink">{process.env.ENQUIRY_ALLOWED_ORIGINS ?? "— not set"}</span></p>
          <p className="mt-2 text-xs">Last enquiry: {lastLead ? fmtDateTime(lastLead.created_at, tz) : "none"}</p>
          <p className="mt-2 text-xs text-muted">Test with the curl command in RUNBOOK §7.</p>
        </Card>

        <Card>
          <Head title="Sign-in emails · Supabase Auth" s={{ label: "CHECK IN SUPABASE", tone: "amber" }} />
          <p className="mt-1 text-sm text-muted">Invites and password resets are sent by Supabase, not this app, so they can&apos;t be tested from here. Set Supabase → Authentication → SMTP to Brevo, then invite a test employee to confirm.</p>
        </Card>

        <Card title="Email outbox · last 7 days" action={count("FAILED") > 0 ? <form action={retryFailed}><button className="btn-ghost">Retry {count("FAILED")} failed</button></form> : undefined}>
          <div className="grid grid-cols-5 gap-2 text-center">
            {["SENT", "QUEUED", "SENDING", "FAILED", "SKIPPED"].map((s) => (
              <div key={s}><p className={clsx("display text-3xl tabular-nums", s === "FAILED" && count(s) > 0 && "text-danger")}>{count(s)}</p><p className="text-[10px] text-muted">{s.toLowerCase()}</p></div>))}
          </div>
          <p className="mt-3 text-xs text-muted">Skipped = muted by the recipient&apos;s preferences.</p>
        </Card>
      </div>

      {!!failures?.length && (
        <Card title="Recent failed emails" className="mt-6">
          <TableWrap><table className="table min-w-[640px]">
            <thead><tr><th>When</th><th>Template</th><th>To</th><th>Attempts</th><th>Error</th></tr></thead>
            <tbody>{failures.map((f) => (
              <tr key={f.id}><td className="whitespace-nowrap text-xs">{fmtDateTime(f.created_at, tz)}</td><td className="font-mono text-xs">{f.template}</td>
                <td className="text-xs">{f.to_email.replace(/^(.{2}).*(@.*)$/, "$1…$2")}</td><td>{f.attempts}</td><td className="text-xs text-danger">{f.last_error}</td></tr>))}</tbody>
          </table></TableWrap>
        </Card>
      )}

      <Card title="Coming in later blocks" className="mt-6">
        {!PLANNED.length ? <Empty title="All built" /> : <TableWrap><table className="table">
          <thead><tr><th>Integration</th><th>Powers</th><th>Block</th></tr></thead>
          <tbody>{PLANNED.map(([n, p, b]) => <tr key={n} className="text-muted"><td className="text-ink">{n}</td><td className="text-sm">{p}</td><td>{b}</td></tr>)}</tbody>
        </table></TableWrap>}
      </Card>
    </>
  );
}
