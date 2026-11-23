import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { ORG_EVENTS } from "@/lib/delivery/events";
import { EVENT_LABEL } from "@/lib/delivery/messages";
import { IntegrationTabs } from "../tabs";
import { deleteWebhook, pingWebhook, toggleWebhook } from "../channel-actions";
import { CreateWebhookForm, RotateSecret } from "./secret-forms";

export const metadata = { title: "Webhooks · Integrations" };
export const dynamic = "force-dynamic";

export default async function Webhooks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const [{ data: hooks }, { data: log }] = await Promise.all([
    sb
      .from("webhook_endpoints")
      .select("id, name, url, events, enabled, consecutive_failures, disabled_reason, last_success_at, last_failure_at, created_at")
      .order("created_at"),
    sb
      .from("delivery_outbox")
      .select("id, target_ref, event_key, status, attempts, last_error, created_at, sent_at")
      .eq("channel", "WEBHOOK")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const name = (id: string | null) => hooks?.find((h) => h.id === id)?.name ?? "deleted endpoint";
  const events = ORG_EVENTS.map((e) => ({ key: e, label: EVENT_LABEL[e] ?? e }));

  return (
    <>
      <PageHeader eyebrow="Administration · integrations" title="Outbound webhooks" />
      <IntegrationTabs active="/settings/integrations/webhooks" />
      <Flash sp={sp} />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Add an endpoint" hint="Zapier, Make, n8n or your own server. https only; private and internal addresses are blocked.">
          <CreateWebhookForm events={events} />
        </Card>
        <Card title="Verifying deliveries">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>
              Each POST carries <code>X-VSM-Event</code>, <code>X-VSM-Delivery</code> and{" "}
              <code>X-VSM-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>.
            </li>
            <li>
              Compute HMAC-SHA256 of{" "}
              <code>
                `${"{t}"}.${"{raw body}"}`
              </code>{" "}
              with your secret and compare in constant time.
            </li>
            <li>
              Reject if <code>t</code> is older than 5 minutes. Use <code>X-VSM-Delivery</code> to ignore duplicates.
            </li>
            <li>Reply 2xx within 10 s. Failures retry 5 times; 20 failures in a row disable the endpoint.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">Payroll events carry the period and headcount only — never amounts.</p>
        </Card>
      </div>

      <h2 className="eyebrow mb-3 mt-8">Endpoints</h2>
      {!hooks?.length ? (
        <Card>
          <p className="text-sm text-muted">No endpoints yet.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {hooks.map((h) => (
            <Card
              key={h.id}
              title={h.name}
              action={
                <Badge tone={h.enabled ? (h.consecutive_failures ? "amber" : "green") : "grey"}>
                  {h.enabled ? (h.consecutive_failures ? `${h.consecutive_failures} FAILURES` : "ACTIVE") : "DISABLED"}
                </Badge>
              }
            >
              <p className="break-all font-mono text-xs">{h.url}</p>
              <p className="mt-2 flex flex-wrap gap-1">
                {h.events.map((e: string) => (
                  <span key={e} className="chip border-line text-[10px] text-muted">
                    {e}
                  </span>
                ))}
              </p>
              {h.disabled_reason && <p className="mt-2 text-xs text-ember">{h.disabled_reason}</p>}
              <p className="mt-2 text-xs text-muted">
                Last success {h.last_success_at ? fmtDateTime(h.last_success_at, ctx.timezone) : "—"} · last failure{" "}
                {h.last_failure_at ? fmtDateTime(h.last_failure_at, ctx.timezone) : "—"}
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <form action={pingWebhook}>
                  <input type="hidden" name="id" value={h.id} />
                  <button className="btn-ghost text-xs" disabled={!h.enabled}>
                    Send ping
                  </button>
                </form>
                <form action={toggleWebhook}>
                  <input type="hidden" name="id" value={h.id} />
                  <input type="hidden" name="enable" value={h.enabled ? "0" : "1"} />
                  <button className="btn-ghost text-xs">{h.enabled ? "Disable" : "Enable"}</button>
                </form>
                <details className="text-xs">
                  <summary className="cursor-pointer py-2 text-muted hover:text-danger">Delete…</summary>
                  <form action={deleteWebhook} className="mt-2 flex gap-2">
                    <input type="hidden" name="id" value={h.id} />
                    <input name="confirm" placeholder="Type DELETE" className="input py-1 text-xs" />
                    <button className="btn-ghost text-xs text-danger">Delete</button>
                  </form>
                </details>
              </div>
              <div className="mt-2">
                <RotateSecret id={h.id} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card title="Delivery log · latest 30" className="mt-6">
        {!log?.length ? (
          <p className="text-sm text-muted">Nothing delivered yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Endpoint</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(l.created_at, ctx.timezone)}</td>
                    <td className="text-xs">{name(l.target_ref)}</td>
                    <td className="font-mono text-xs">{l.event_key}</td>
                    <td>
                      <Badge>{l.status}</Badge>
                    </td>
                    <td className="tabular-nums">{l.attempts}</td>
                    <td className="max-w-xs break-words text-xs text-danger">{l.last_error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
