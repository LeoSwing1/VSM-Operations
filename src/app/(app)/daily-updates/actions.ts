"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";
import { localDate } from "@/lib/engines/time";

export async function submitUpdate(fd: FormData) {
  const ctx = await requireContext();
  const completed = str(fd, "completed");
  if (completed.length < 5) flash("/daily-updates", "err", "Describe what you completed (5+ characters).");
  const minutes = num(fd, "hours");
  const row = {
    org_id: ctx.org_id, employee_id: ctx.employee_id, work_date: localDate(new Date(), ctx.timezone), completed: completed.slice(0, 5000),
    in_progress: optStr(fd, "in_progress"), blockers: optStr(fd, "blockers"), tomorrow: optStr(fd, "tomorrow"),
    minutes_spent: minutes === null ? null : Math.round(Math.min(24, Math.max(0, minutes)) * 60),
  };
  const sb = await supabaseServer();
  const { error } = await sb.from("daily_updates").upsert(row, { onConflict: "employee_id,work_date" });
  if (error) flash("/daily-updates", "err", dbMessage(error, "Couldn't save — updates lock once reviewed."));
  flash("/daily-updates", "ok", "Daily update saved.");
}

export async function commentUpdate(fd: FormData) {
  const ctx = await requireContext();
  const id = z.string().uuid().parse(str(fd, "id"));
  const comment = str(fd, "comment");
  if (comment.length < 2) flash("/daily-updates?view=team", "err", "Comment is empty.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("daily_updates").update({ manager_comment: comment.slice(0, 2000), reviewed_by: ctx.employee_id, reviewed_at: new Date().toISOString() })
    .eq("id", id).neq("employee_id", ctx.employee_id).select("id");
  if (error || !data?.length) flash("/daily-updates?view=team", "err", dbMessage(error, "You can only review your team's updates."));
  flash("/daily-updates?view=team", "ok", "Feedback added.");
}
