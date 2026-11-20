import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/** GET current employee's Google Calendar sync status */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sb = await supabaseServer();
  const { data, error } = await sb.from("calendar_sync")
    .select("*")
    .eq("employee_id", ctx.employee_id)
    .eq("provider", "GOOGLE");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sync: data?.[0] || null });
}

/** POST sync meetings to Google Calendar */
export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const { start_date, end_date } = body;

  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sb = await supabaseServer();

  // Get or create calendar_sync record
  // Note: Supabase upsert with composite unique key requires selecting the columns
  const { data: sync, error: syncError } = await sb.from("calendar_sync")
    .upsert([
      { employee_id: ctx.employee_id, org_id: ctx.org_id, provider: "GOOGLE" }
    ], { onConflict: "org_id,employee_id,provider" })
    .select()
    .single();

  if (syncError) {
    return NextResponse.json({ error: syncError.message }, { status: 500 });
  }

  // Get meetings for this employee
  const { data: meetings, error: meetingsError } = await sb.from("meetings")
    .select(`
      id, title, description, starts_at, ends_at, timezone,
      provider, provider_event_id, organizer_id
    `)
    .eq("organizer_id", ctx.employee_id)
    .gte("starts_at", start_date || new Date().toISOString())
    .lte("starts_at", end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

  if (meetingsError) {
    return NextResponse.json({ error: meetingsError.message }, { status: 500 });
  }

  // TODO: Call Google Calendar API to sync events
  // This would require the Google OAuth token stored in integrations table
  const integration = await sb.from("integrations")
    .select("config")
    .eq("org_id", ctx.org_id)
    .eq("kind", "GOOGLE_CALENDAR")
    .single();

  return NextResponse.json({
    sync: sync,
    meetings: meetings || [],
    message: integration ? "Calendar sync configured - Google Calendar API integration needed" : "No Google Calendar integration configured",
  });
}

/** DELETE remove calendar sync */
export async function DELETE(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sb = await supabaseServer();
  const { error } = await sb.from("calendar_sync")
    .delete()
    .eq("employee_id", ctx.employee_id)
    .eq("provider", "GOOGLE");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}