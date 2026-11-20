"use server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

export async function decide(fd: FormData) {
  await requireContext();
  const kind = str(fd, "kind"), id = str(fd, "id"), approve = str(fd, "decision") === "approve", note = optStr(fd, "note");
  const sb = await supabaseServer();
  const rpc = kind === "leave" ? "decide_leave" : kind === "correction" ? "decide_attendance_correction" : null;
  if (!rpc) flash("/approvals", "err", "Unknown request type.");
  const { error } = await sb.rpc(rpc, { p_id: id, p_approve: approve, p_note: note });
  if (error) flash("/approvals", "err", dbMessage(error));
  flash("/approvals", "ok", approve ? "Approved." : "Rejected.");
}
