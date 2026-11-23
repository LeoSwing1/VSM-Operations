"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";
export async function createCalendarEvent(fd: FormData) {
  const ctx = await requirePerm("calendar.create", "calendar.manage");
  const p = z
    .object({
      title: z.string().trim().min(2).max(200),
      description: z.string().max(3000),
      event_type: z.enum(["MEETING", "FOCUS", "DEADLINE", "TRAINING", "OTHER"]),
      visibility: z.enum(["ORG", "DEPARTMENT", "TEAM", "INVITEES", "PRIVATE"]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      location: z.string().max(200),
      meeting_url: z.string().url().optional(),
      department_id: z.string().uuid().optional(),
      team_id: z.string().uuid().optional(),
      attendee_ids: z.array(z.string().uuid()).max(100),
      recurrence: z.enum(["", "DAILY:5", "WEEKLY:8", "MONTHLY:6"]),
    })
    .safeParse({
      title: str(fd, "title"),
      description: str(fd, "description"),
      event_type: str(fd, "event_type") || "MEETING",
      visibility: str(fd, "visibility") || "INVITEES",
      date: str(fd, "date"),
      start: str(fd, "start"),
      end: str(fd, "end"),
      location: str(fd, "location"),
      meeting_url: optStr(fd, "meeting_url") || undefined,
      department_id: optStr(fd, "department_id") || undefined,
      team_id: optStr(fd, "team_id") || undefined,
      attendee_ids: fd.getAll("attendee_ids").map(String),
      recurrence: str(fd, "recurrence"),
    });
  if (!p.success) flash("/calendar", "err", "Check the event details and time.");
  const starts = zonedInstant(p.data.date, p.data.start, ctx.timezone),
    ends = zonedInstant(p.data.date, p.data.end, ctx.timezone);
  if (ends <= starts) flash("/calendar", "err", "End time must be after start time.");
  if (p.data.visibility === "DEPARTMENT" && !p.data.department_id) flash("/calendar", "err", "Choose a department for a department event.");
  if (p.data.visibility === "TEAM" && !p.data.team_id) flash("/calendar", "err", "Choose a team for a team event.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("create_calendar_event", {
    p_title: p.data.title,
    p_description: p.data.description,
    p_event_type: p.data.event_type,
    p_visibility: p.data.visibility,
    p_starts_at: starts.toISOString(),
    p_ends_at: ends.toISOString(),
    p_location: p.data.location || null,
    p_meeting_url: p.data.meeting_url || null,
    p_department: p.data.department_id || null,
    p_team: p.data.team_id || null,
    p_attendees: p.data.attendee_ids.filter((id) => id !== ctx.employee_id),
    p_recurrence: p.data.recurrence || null,
  });
  if (error) flash("/calendar", "err", dbMessage(error));
  revalidatePath("/calendar");
  revalidatePath("/meetings");
  flash("/calendar", "ok", "Calendar event series created. Email invitations are queued for delivery.");
}
export async function respondToEvent(fd: FormData) {
  const ctx = await requireContext();
  const response = z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]).safeParse(str(fd, "response"));
  if (!response.success) flash("/calendar", "err", "Invalid response.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("calendar_attendees")
    .update({ response: response.data, responded_at: new Date().toISOString() })
    .eq("event_id", str(fd, "event_id"))
    .eq("employee_id", ctx.employee_id)
    .select("event_id")
    .maybeSingle();
  if (error) flash("/calendar", "err", dbMessage(error));
  if (!data) flash("/calendar", "err", "You are not an attendee of that event.");
  revalidatePath("/calendar");
  flash("/calendar", "ok", "Meeting response saved.");
}
