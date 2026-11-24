import Link from "next/link";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, PageHeader } from "@/components/ui";
import { localDate } from "@/lib/engines/time";
import { aiConfigured } from "@/lib/ai/claude";
import { AskOps, ReportTool, SummaryTool } from "./assistant-ui";

export const metadata = { title: "AI assistant" };

export default async function Assistant() {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: quota }, { data: projects }] = await Promise.all([
    sb.rpc("ai_quota"),
    sb.from("projects").select("id,name,client:clients(name)").in("status", ["PLANNING", "ACTIVE", "ON_HOLD"]).order("name"),
  ]);
  const today = localDate(new Date(), ctx.timezone);
  const yesterday = localDate(new Date(Date.now() - 864e5), ctx.timezone);
  const lang = (quota?.language as string) ?? "HINGLISH";

  return (
    <>
      <PageHeader eyebrow="Powered by Claude" title="AI assistant" />
      {!aiConfigured() || !quota?.allowed ? (
        <Empty
          title="The assistant isn't available right now"
          hint={!aiConfigured() ? "The admin needs to add the Anthropic API key (ANTHROPIC_API_KEY) on Vercel." : (quota?.reason as string)}
        >
          {can(ctx, "settings.manage") && (
            <Link className="btn" href="/settings/ai">
              Open AI settings
            </Link>
          )}
        </Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <Card title="Ask Ops" hint={`${quota.today}/${quota.daily_limit} requests used today`}>
            <AskOps language={lang} />
          </Card>
          <div className="grid content-start gap-6">
            <Card
              title="Summarise daily updates"
              hint="For managers: everything your team wrote, boiled down to done / blockers / tomorrow."
            >
              <SummaryTool today={today} yesterday={yesterday} language={lang} />
            </Card>
            <Card
              title="Draft a client update"
              hint="Report, email or WhatsApp from the project's milestones and updates. You review and send it yourself."
            >
              <ReportTool
                projects={(projects ?? []).map((p) => ({
                  id: p.id,
                  name: p.name,
                  client: (Array.isArray(p.client) ? p.client[0]?.name : (p.client as { name?: string } | null)?.name) ?? null,
                }))}
                language={lang}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
