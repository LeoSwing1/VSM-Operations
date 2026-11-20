import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "Meetings" };

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get upcoming meetings user is attending
  const { data: upcomingMeetings } = await sb.from("meetings")
    .select(`
      id,
      title,
      description,
      starts_at,
      ends_at,
      status,
      timezone,
      provider,
      meeting_attendees!inner(
        status,
        response_status
      )
    `)
    .in("meeting_attendees.employee_id", [ctx.employee_id, null])
    .or(`meetings.organizer_id.eq.${ctx.employee_id},meetings.id.in.(select.meeting_id from meeting_attendees where employee_id=${ctx.employee_id})`)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(20);

  // Get past meetings
  const { data: pastMeetings } = await sb.from("meetings")
    .select(`
      id,
      title,
      starts_at,
      status,
      meeting_attendees!inner(status)
    `)
    .in("meeting_attendees.employee_id", [ctx.employee_id, null])
    .or(`meetings.organizer_id.eq.${ctx.employee_id},meetings.id.in.(select.meeting_id from meeting_attendees where employee_id=${ctx.employee_id})`)
    .lt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(10);

  return (
    <>
      <PageHeader title="Meetings" />
      <Flash sp={sp} />

      {(!upcomingMeetings || upcomingMeetings.length === 0) && (!pastMeetings || pastMeetings.length === 0) ? (
        <Card>
          <p className="text-muted">No meetings found.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {upcomingMeetings && upcomingMeetings.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Upcoming</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingMeetings.map((m) => (
                  <Card key={m.id} className="hover:border-ink/30 transition">
                    <div className="flex justify-between items-start">
                      <h3 className="font-medium text-sm">{m.title}</h3>
                      <span className="text-xs text-muted">
                        {m.starts_at ? new Date(m.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1 line-clamp-2">
                      {m.description || "No description"}
                    </p>
                    <div className="mt-3 flex gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">{m.provider}</span>
                      <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">{m.status}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {pastMeetings && pastMeetings.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Past</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pastMeetings.map((m) => (
                  <Card key={m.id}>
                    <h3 className="font-medium text-sm">{m.title}</h3>
                    <p className="text-xs text-muted mt-1">
                      {m.starts_at ? new Date(m.starts_at).toLocaleDateString() : ""}
                    </p>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}