import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/** Marks a conversation read and clears its chat notifications (bell + chat inbox badges drop together). */
export async function POST(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    await requireContext();
    const { channelId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) return NextResponse.json({ ok: false }, { status: 400 });
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc("mark_chat_read", { p_channel: channelId });
    if (error) return NextResponse.json({ ok: false }, { status: 403 });
    return NextResponse.json({ ok: true, cleared: data ?? 0 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
