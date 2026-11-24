import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/auth-forms";
import { localDate } from "@/lib/engines/time";
import { aiConfigured, runClaude } from "@/lib/ai/claude";
import { makeToolRunner } from "@/lib/ai/tools";
import { systemPrompt, toolSpecs, trimHistory } from "@/lib/ai/spec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .min(1)
    .max(40),
  language: z.enum(["HINGLISH", "ENGLISH", "HINDI"]).optional(),
});

/** Ask Ops: a permission-aware chat. Nothing typed here is stored — only token counts for the budget. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Message too long or empty." }, { status: 400 });
  if (!aiConfigured())
    return NextResponse.json({ error: "The AI assistant isn't set up yet (ask the admin to add the Anthropic API key)." }, { status: 503 });

  const sb = await supabaseServer();
  const { data: quota } = await sb.rpc("ai_quota");
  if (!quota?.allowed) return NextResponse.json({ error: quota?.reason ?? "AI is not available." }, { status: 403 });

  const history = trimHistory(body.data.messages);
  if (!history.length) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  const system = systemPrompt({
    orgName: ctx.org_name,
    userName: ctx.full_name,
    role: ctx.role,
    designation: ctx.designation,
    today: localDate(new Date(), ctx.timezone),
    language: body.data.language ?? quota.language,
  });
  try {
    const out = await runClaude({
      model: quota.model,
      system,
      messages: history,
      tools: toolSpecs,
      runTool: makeToolRunner(sb, ctx),
      maxTokens: 1200,
    });
    await sb.rpc("ai_record_usage", {
      p_feature: "ASK",
      p_model: out.model,
      p_in: out.inputTokens,
      p_out: out.outputTokens,
      p_tools: out.toolCalls,
      p_ok: true,
    });
    return NextResponse.json(
      { reply: out.text, usage: { in: out.inputTokens, out: out.outputTokens, tools: out.toolCalls } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    await sb.rpc("ai_record_usage", { p_feature: "ASK", p_model: quota.model, p_in: 0, p_out: 0, p_tools: 0, p_ok: false });
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
