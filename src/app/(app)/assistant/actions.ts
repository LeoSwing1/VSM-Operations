"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { localDate } from "@/lib/engines/time";
import { aiConfigured, runClaude } from "@/lib/ai/claude";
import { LANG_RULE, clip } from "@/lib/ai/spec";

export type AiState = { text?: string; error?: string; at?: number };

async function gate() {
  const ctx = await requireContext();
  if (!aiConfigured()) return { error: "The AI assistant isn't set up yet (Anthropic API key missing)." } as const;
  const sb = await supabaseServer();
  const { data: quota } = await sb.rpc("ai_quota");
  if (!quota?.allowed) return { error: (quota?.reason as string) ?? "AI is not available." } as const;
  return { ctx, sb, quota } as const;
}

/** Summarise daily updates the person can see (their team, or the whole company for HR/ops). */
export async function summariseUpdates(_: AiState, fd: FormData): Promise<AiState> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const { ctx, sb, quota } = g;
  const p = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      language: z.enum(["HINGLISH", "ENGLISH", "HINDI"]),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Pick the dates." };
  const [{ data: ups, error }, { data: people }] = await Promise.all([
    sb
      .from("daily_updates")
      .select("employee_id,work_date,completed,in_progress,blockers,tomorrow")
      .gte("work_date", p.data.from)
      .lte("work_date", p.data.to)
      .order("work_date")
      .limit(200),
    sb.from("employees").select("id,full_name,designation"),
  ]);
  if (error) return { error: "Can't read daily updates." };
  if (!ups?.length) return { error: "No daily updates in that range that you can see." };
  const name = new Map((people ?? []).map((x) => [x.id, `${x.full_name}${x.designation ? " (" + x.designation + ")" : ""}`]));
  const rows = ups.map((u) => ({ ...u, employee: name.get(u.employee_id), employee_id: undefined }));
  try {
    const out = await runClaude({
      model: quota.model,
      maxTokens: 1500,
      system: [
        `You write a manager's summary of daily work updates for ${ctx.org_name}. Only use the updates given. No praise filler.`,
        "Structure: 1) Headline (2 lines) 2) Done — grouped by person, one line each 3) Blockers that need the manager (who, what, since when) 4) Tomorrow's focus 5) Missing updates if obvious.",
        LANG_RULE[p.data.language],
      ].join("\n"),
      messages: [{ role: "user", content: `Daily updates ${p.data.from} to ${p.data.to}:\n${clip(rows, 60000)}` }],
    });
    await sb.rpc("ai_record_usage", {
      p_feature: "DAILY_SUMMARY",
      p_model: out.model,
      p_in: out.inputTokens,
      p_out: out.outputTokens,
      p_tools: 0,
      p_ok: true,
    });
    return { text: out.text, at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI request failed." };
  }
}

/** Draft a client progress report or email from a project's milestones and updates. A human always sends it. */
export async function draftClientReport(_: AiState, fd: FormData): Promise<AiState> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const { ctx, sb, quota } = g;
  const p = z
    .object({
      project_id: z.string().uuid(),
      kind: z.enum(["REPORT", "EMAIL", "WHATSAPP"]),
      language: z.enum(["HINGLISH", "ENGLISH", "HINDI"]),
      notes: z.string().max(1500).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Pick a project." };
  const { data: project } = await sb
    .from("projects")
    .select("id,name,status,start_date,deadline,description,client:clients(name)")
    .eq("id", p.data.project_id)
    .maybeSingle();
  if (!project) return { error: "You can't see that project." };
  const since = new Date(Date.now() - 31 * 864e5).toISOString();
  const [{ data: ms }, { data: ups }, { data: done }] = await Promise.all([
    sb.from("project_milestones").select("title,due_date,status,completed_at").eq("project_id", project.id).order("due_date"),
    sb
      .from("project_updates")
      .select("update_type,body,created_at")
      .eq("project_id", project.id)
      .gte("created_at", since)
      .order("created_at"),
    sb
      .from("tasks")
      .select("title,completed_at")
      .eq("project_id", project.id)
      .eq("status", "COMPLETED")
      .gte("completed_at", since)
      .limit(60),
  ]);
  const format = {
    REPORT: "a monthly progress report with headings: Summary, What we delivered, In progress, Next 2 weeks, What we need from you",
    EMAIL: "a short client email (subject line + body, under 180 words)",
    WHATSAPP: "a WhatsApp message under 90 words with 3–5 bullet points",
  }[p.data.kind];
  try {
    const out = await runClaude({
      model: quota.model,
      maxTokens: 1400,
      system: [
        `You are the account manager at ${ctx.org_name}, a digital marketing agency (SEO, social media, video, websites).`,
        `Write ${format} for the client. Use only the facts given. Never mention internal blockers, staff names other than the sender, costs, or invoices.`,
        "Warm, confident, specific. Sign off as the sender.",
        LANG_RULE[p.data.language],
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `Sender: ${ctx.full_name}. Today: ${localDate(new Date(), ctx.timezone)}.\nProject: ${clip(project)}\nMilestones: ${clip(ms)}\nUpdates (last 31 days): ${clip(ups, 20000)}\nCompleted tasks (last 31 days): ${clip(done)}\nExtra notes from sender: ${p.data.notes ?? "-"}`,
        },
      ],
    });
    await sb.rpc("ai_record_usage", {
      p_feature: "CLIENT_REPORT",
      p_model: out.model,
      p_in: out.inputTokens,
      p_out: out.outputTokens,
      p_tools: 0,
      p_ok: true,
    });
    return { text: out.text, at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI request failed." };
  }
}
