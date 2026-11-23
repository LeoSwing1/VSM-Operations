import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("finance_expenses")
    .select("receipt_path,receipt_name")
    .eq("id", id)
    .eq("org_id", ctx.org_id)
    .maybeSingle();
  if (error || !data?.receipt_path) return new NextResponse("Not found", { status: 404 });
  const { data: link, error: signError } = await sb.storage
    .from("finance-receipts")
    .createSignedUrl(data.receipt_path, 60, { download: data.receipt_name || true });
  if (signError || !link?.signedUrl) return new NextResponse("Receipt unavailable", { status: 403 });
  return NextResponse.redirect(link.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
