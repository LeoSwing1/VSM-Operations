"use server";
import { revalidatePath } from "next/cache";
import { requireContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
export async function saveMeetingNotes(fd: FormData) {
  const ctx = await requireContext(),
    event_id = str(fd, "event_id");
  const sb = await supabaseServer();
  const { data: event } = await sb.from("calendar_events").select("id,organizer_id").eq("id", event_id).maybeSingle();
  if (!event || (event.organizer_id !== ctx.employee_id && !can(ctx, "calendar.manage")))
    flash("/meetings", "err", "Only the meeting organiser or calendar administrator can edit minutes.");
  const lines = (key: string) =>
    str(fd, key)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
  const { error } = await sb.from("meeting_notes").upsert(
    {
      org_id: ctx.org_id,
      event_id,
      agenda: str(fd, "agenda"),
      minutes: str(fd, "minutes"),
      decisions: lines("decisions"),
      action_items: lines("action_items"),
      updated_by: ctx.employee_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" },
  );
  if (error) flash("/meetings", "err", dbMessage(error));
  revalidatePath("/meetings");
  flash("/meetings", "ok", "Meeting notes saved.");
}
