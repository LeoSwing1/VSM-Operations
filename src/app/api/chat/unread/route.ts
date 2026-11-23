import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Chat inbox counts for the signed-in employee: total unread and per conversation. */
export async function GET() {
  try {
    await requireContext();
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc("chat_unread_summary");
    if (error) return NextResponse.json({ total: 0, channels: {} }, { status: 200, headers: { "cache-control": "no-store" } });
    const rows = (data ?? []) as { channel_id: string; unread: number }[];
    const channels = Object.fromEntries(rows.filter((r) => r.unread > 0).map((r) => [r.channel_id, r.unread]));
    return NextResponse.json({ total: rows.reduce((a, r) => a + r.unread, 0), channels }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ total: 0, channels: {} }, { status: 401 });
  }
}
