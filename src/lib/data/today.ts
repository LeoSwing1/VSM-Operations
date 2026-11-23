import type { AttendanceEvent } from "@/lib/engines/attendance";
import type { supabaseServer } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof supabaseServer>>;

/** Today's punches exactly as record_attendance() sees them (same day boundary, same timezone). */
export async function myToday(sb: SB): Promise<AttendanceEvent[]> {
  const { data, error } = await sb.rpc("my_attendance_today");
  if (error) {
    console.error("[attendance] my_attendance_today failed:", error.message);
    return [];
  }
  return (data ?? []) as AttendanceEvent[];
}
