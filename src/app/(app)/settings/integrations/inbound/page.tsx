import Link from "next/link";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { channelConfig } from "@/lib/delivery/worker";
import { IntegrationTabs } from "../tabs";
import { redirect } from "next/navigation";

export const metadata = { title: "Inbound events · Integrations" };
export const dynamic = "force-dynamic";
const PROVIDERS = ["ALL", "META_LEADS", "RAZORPAY", "WHATSAPP"] as const;

export default async function Inbound({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const admin = can(ctx, "settings.manage"),
    finance = can(ctx, "finance.view");
  if (!admin && !finance) redirect("/dashboard?e=" + encodeURIComponent("You don't have access to inbound integration events."));
  const provider = PROVIDERS.includes(sp.p as (typeof PROVIDERS)[number]) ? sp.p! : admin ? "ALL" : "RAZORPAY";
  const sb = await supabaseServer();
  let q = sb
    .from("inbound_webhook_events")
    .select("id, provider, external_id, event_type, status, error, match_kind, match_id, received_at, payload")
    .order("received_at", { ascending: false })
    .limit(50);
  if (provider !== "ALL") q = q.eq("provider", provider);
  const { data: events } = await q;
  const cfg = channelConfig();
  const base = process.env.APP_URL ?? "https://ops.vsmgrowth.com";
  type Ent = { amount?: number; currency?: string };
  const amount = (p: Record<string, unknown>) => {
    const pl = (p?.payload ?? {}) as Record<string, { entity?: Ent } | undefined>;
    const ent = (pl.payment ?? pl.payout)?.entity;
    return ent?.amount != null ? `${ent.currency ?? "INR"} ${(ent.amount / 100).toLocaleString("en-IN")}` : null;
  };
  const href = (k: string | null, id: string | null) =>
    !k || !id
      ? null
      : k === "INVOICE"
        ? `/finance/invoices`
        : k === "LEAD"
          ? `/leads/${id}`
          : k === "PAYROLL_ENTRY"
            ? `/payroll/runs`
            : null;

  return (
    <>
      <PageHeader eyebrow="Administration · integrations" title="Inbound events" />
      {admin && <IntegrationTabs active="/settings/integrations/inbound" />}
      <Flash sp={sp} />
      {admin && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card
            title="Meta Lead Ads → CRM"
            action={<Badge tone={cfg.meta_leads ? "green" : "grey"}>{cfg.meta_leads ? "CONFIGURED" : "NOT CONFIGURED"}</Badge>}
          >
            <p className="text-sm text-muted">
              Subscribe your Page to the <code>leadgen</code> field in the Meta app. Each lead is fetched with the Page token and created in
              the CRM with source CAMPAIGN; duplicates are ignored.
            </p>
            <p className="mt-2 break-all font-mono text-xs">Callback: {base}/api/webhooks/meta</p>
            <p className="mt-1 text-xs text-muted">
              Verify token = META_VERIFY_TOKEN · signature checked with META_APP_SECRET. The same URL receives WhatsApp delivery statuses.
            </p>
          </Card>
          <Card
            title="Razorpay → Finance"
            action={<Badge tone={cfg.razorpay ? "green" : "grey"}>{cfg.razorpay ? "CONFIGURED" : "NOT CONFIGURED"}</Badge>}
          >
            <p className="text-sm text-muted">
              Events: <code>payment.captured</code>, <code>payment_link.paid</code> (match invoice via <code>notes.invoice_number</code>)
              and <code>payout.processed</code> (match payroll entry via <code>notes.payroll_entry_id</code>, amount checked).
            </p>
            <p className="mt-2 break-all font-mono text-xs">Webhook URL: {base}/api/webhooks/razorpay</p>
            <p className="mt-1 text-xs text-ember">
              Nothing is marked paid automatically — a matched event is evidence for a finance user to confirm on the invoice or payroll
              run.
            </p>
          </Card>
        </div>
      )}
      <nav className="mb-3 flex gap-2">
        {PROVIDERS.filter((p) => admin || p === "RAZORPAY").map((p) => (
          <Link key={p} href={`?p=${p}`} className={p === provider ? "chip border-volt text-volt" : "chip border-line text-muted"}>
            {p.replace("_", " ").toLowerCase()}
          </Link>
        ))}
      </nav>
      <Card>
        {!events?.length ? (
          <p className="text-sm text-muted">No events received yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Provider</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Match</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const link = href(e.match_kind, e.match_id);
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(e.received_at, ctx.timezone)}</td>
                      <td className="text-xs">{e.provider.replace("_", " ").toLowerCase()}</td>
                      <td className="font-mono text-xs">{e.event_type}</td>
                      <td>
                        <Badge
                          tone={
                            e.status === "PROCESSED" ? "green" : e.status === "FAILED" ? "red" : e.status === "IGNORED" ? "grey" : "amber"
                          }
                        >
                          {e.status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap text-xs tabular-nums">
                        {e.provider === "RAZORPAY" ? (amount(e.payload as Record<string, unknown>) ?? "—") : "—"}
                      </td>
                      <td className="text-xs">
                        {link ? (
                          <Link href={link} className="text-volt hover:underline">
                            {e.match_kind!.toLowerCase().replace("_", " ")} → review
                          </Link>
                        ) : (
                          (e.match_kind ?? "—")
                        )}
                      </td>
                      <td className="max-w-xs break-words text-xs text-muted">{e.error}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
