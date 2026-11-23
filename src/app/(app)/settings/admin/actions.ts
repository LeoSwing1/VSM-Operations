"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { createDemoWorkspace, removeDemoWorkspace, type DemoCredential } from "@/lib/demo";

export type DemoState = { ok: boolean; message: string; creds?: DemoCredential[] } | null;

async function superAdmin() {
  const ctx = await requireContext();
  if (ctx.role !== "SUPER_ADMIN") throw new Error("Super Admin only");
  return ctx;
}

export async function createDemo(_p: DemoState, _fd: FormData): Promise<DemoState> {
  const ctx = await superAdmin();
  try {
    const creds = await createDemoWorkspace(ctx.org_id, ctx.employee_id);
    const sb = await supabaseServer();
    await sb.rpc("log_audit", {
      p_action: "demo.workspace_created",
      p_entity: "organization",
      p_entity_id: ctx.org_id,
      p_metadata: { people: creds.length },
    });
    revalidatePath("/settings/admin");
    return {
      ok: true,
      message: "Demo team ready. Copy these logins now — passwords are not stored and won't be shown again (run again to issue new ones).",
      creds,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function removeDemo(_p: DemoState, fd: FormData): Promise<DemoState> {
  const ctx = await superAdmin();
  if (fd.get("confirm") !== "REMOVE") return { ok: false, message: "Type REMOVE to confirm." };
  const r = await removeDemoWorkspace(ctx.org_id);
  const sb = await supabaseServer();
  await sb.rpc("log_audit", { p_action: "demo.workspace_removed", p_entity: "organization", p_entity_id: ctx.org_id, p_metadata: r });
  revalidatePath("/settings/admin");
  return {
    ok: true,
    message: `Demo removed: ${r.removed} deleted${r.archived ? `, ${r.archived} archived (they had chat history)` : ""}. Their logins are deleted.`,
  };
}
