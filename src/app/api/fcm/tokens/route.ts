import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/** GET current employee's FCM tokens */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sb = await supabaseServer();
  const { data, error } = await sb.from("fcm_tokens")
    .select("*")
    .eq("employee_id", ctx.employee_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data || [] });
}

/** POST register a new FCM token */
export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const { token, device_info } = body;

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const sb = await supabaseServer();
  const { data, error } = await sb.from("fcm_tokens").upsert({
    employee_id: ctx.employee_id,
    token,
    device_info: device_info || null,
    platform: body.platform || "web",
    active: true,
    last_used_at: new Date().toISOString(),
  }, { onConflict: "employee_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data });
}

/** DELETE remove an FCM token */
export async function DELETE(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { token } = await req.json();
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const sb = await supabaseServer();
  const { error } = await sb.from("fcm_tokens")
    .delete()
    .eq("employee_id", ctx.employee_id)
    .eq("token", token);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}