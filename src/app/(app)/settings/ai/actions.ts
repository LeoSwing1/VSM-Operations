"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash } from "@/lib/actions";

export async function saveAiSettings(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const p = z
    .object({
      enabled: z.enum(["on"]).optional(),
      model: z.string().regex(/^claude-[a-z0-9.-]{3,60}$/, "Model must look like claude-sonnet-5-5"),
      monthly_token_budget: z.coerce.number().int().min(10000).max(500000000),
      per_user_daily_requests: z.coerce.number().int().min(1).max(1000),
      default_language: z.enum(["HINGLISH", "ENGLISH", "HINDI"]),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash("/settings/ai", "err", p.error.issues[0]?.message ?? "Check the settings.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("ai_settings")
    .update({ ...p.data, enabled: p.data.enabled === "on", updated_at: new Date().toISOString() })
    .eq("org_id", ctx.org_id);
  if (error) flash("/settings/ai", "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: "ai.settings_changed",
    p_entity: "ai_settings",
    p_entity_id: ctx.org_id,
    p_metadata: { enabled: p.data.enabled === "on", model: p.data.model },
  });
  revalidatePath("/settings/ai");
  flash("/settings/ai", "ok", "AI settings saved.");
}
