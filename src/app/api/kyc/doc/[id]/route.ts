import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Open a KYC document: 60-second signed link, created with the viewer's own session (owner or kyc.verify only). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  const sb = await supabaseServer();
  const { data: doc } = await sb.from("kyc_documents").select("id, employee_id, storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await sb.storage.from("kyc-documents").createSignedUrl(doc.storage_path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (doc.employee_id !== ctx.employee_id)
    await sb.rpc("log_audit", { p_action: "kyc.document_viewed", p_entity: "kyc_document", p_entity_id: doc.id, p_metadata: {} });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
