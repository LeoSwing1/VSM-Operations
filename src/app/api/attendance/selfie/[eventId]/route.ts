import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/** Opens a punch selfie through a 60-second signed link. RLS on the event and storage decides who may see it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  await requireContext();
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: ev } = await sb.from("attendance_events").select("selfie_path").eq("id", eventId).maybeSingle();
  if (!ev?.selfie_path) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await sb.storage.from("attendance-selfies").createSignedUrl(ev.selfie_path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  return NextResponse.redirect(data.signedUrl, { headers: { "cache-control": "no-store" } });
}
