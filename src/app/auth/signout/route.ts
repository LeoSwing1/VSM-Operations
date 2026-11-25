import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (data.user?.email) await logAuthEvent("auth.sign_out", data.user.email, clientIp(req));
  await sb.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
