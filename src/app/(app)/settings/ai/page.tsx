import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/claude";
import { saveAiSettings } from "./actions";

export const metadata = { title: "AI assistant settings" };

export default async function AiSettings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data: s }, { data: usage }, { data: people }] = await Promise.all([
    sb.from("ai_settings").select("*").maybeSingle(),
    sb
      .from("ai_usage")
      .select("employee_id,feature,input_tokens,output_tokens,ok,created_at")
      .gte("created_at", monthStart.toISOString())
      .limit(5000),
    sb.from("employees").select("id,full_name"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const used = (usage ?? []).reduce((a, u) => a + u.input_tokens + u.output_tokens, 0);
  const byPerson = new Map<string, { n: number; tokens: number }>();
  for (const u of usage ?? []) {
    const r = byPerson.get(u.employee_id) ?? { n: 0, tokens: 0 };
    r.n++;
    r.tokens += u.input_tokens + u.output_tokens;
    byPerson.set(u.employee_id, r);
  }
  const budget = s?.monthly_token_budget ?? 3000000;

  return (
    <>
      <PageHeader eyebrow="Admin" title="AI assistant" />
      <Flash sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="API key"
          value={aiConfigured() ? "Set" : "Missing"}
          hint={aiConfigured() ? "ANTHROPIC_API_KEY on the server" : "Add ANTHROPIC_API_KEY on Vercel"}
          tone={aiConfigured() ? "volt" : "danger"}
        />
        <Stat
          label="Tokens this month"
          value={used.toLocaleString("en-IN")}
          hint={`${Math.round((used / budget) * 100)}% of ${budget.toLocaleString("en-IN")}`}
        />
        <Stat label="Requests this month" value={(usage ?? []).length} hint={`${(usage ?? []).filter((u) => !u.ok).length} failed`} />
      </div>
      <Card
        title="Settings"
        hint="The assistant reads data with each person's own access, can't change anything, never sees payroll or bank details, and stores no chat text — only token counts."
      >
        <form action={saveAiSettings} className="grid gap-4 sm:grid-cols-5">
          <label className="flex items-center gap-2 text-sm sm:col-span-5">
            <input type="checkbox" name="enabled" defaultChecked={s?.enabled} /> Switch the AI assistant on for everyone with the{" "}
            <code>ai.use</code> permission
          </label>
          <Field label="Model">
            <input name="model" defaultValue={s?.model ?? "claude-sonnet-5-5"} className="input" />
          </Field>
          <Field label="Monthly token budget">
            <input name="monthly_token_budget" type="number" min={10000} step={10000} defaultValue={budget} className="input" />
          </Field>
          <Field label="Requests per person per day">
            <input
              name="per_user_daily_requests"
              type="number"
              min={1}
              max={1000}
              defaultValue={s?.per_user_daily_requests ?? 40}
              className="input"
            />
          </Field>
          <Field label="Default language">
            <select name="default_language" defaultValue={s?.default_language ?? "HINGLISH"} className="input">
              <option value="HINGLISH">Hinglish</option>
              <option value="ENGLISH">English</option>
              <option value="HINDI">Hindi</option>
            </select>
          </Field>
          <div className="flex items-end">
            <button className="btn">Save</button>
          </div>
        </form>
        <p className="mt-4 text-xs text-muted">
          Rough cost guide: a typical question uses 3,000–8,000 tokens (most of it the data looked up). Interns don&apos;t get{" "}
          <code>ai.use</code> by default; change that in Access control.
        </p>
      </Card>
      <Card className="mt-6" title="Usage by person (this month)">
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2">Person</th>
                <th>Requests</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...byPerson.entries()]
                .sort((a, b) => b[1].tokens - a[1].tokens)
                .map(([id, r]) => (
                  <tr key={id}>
                    <td className="py-2">{name.get(id) ?? "—"}</td>
                    <td className="tabular-nums">{r.n}</td>
                    <td className="tabular-nums">{r.tokens.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              {!byPerson.size && (
                <tr>
                  <td colSpan={3} className="py-4 text-muted">
                    No usage yet. <Badge>{s?.enabled ? "ON" : "OFF"}</Badge>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
