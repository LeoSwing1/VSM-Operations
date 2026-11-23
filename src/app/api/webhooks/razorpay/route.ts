import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyRazorpaySignature } from "@/lib/delivery/signatures";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhooks (signature-verified, idempotent by event id).
 *  • payment.captured / payment_link.paid → matched to a client invoice via notes.invoice_number.
 *  • payout.processed → matched to a payroll entry via notes.payroll_entry_id, amount checked.
 * Nothing is marked PAID automatically: finance/payroll see the verified event with its reference
 * and confirm it themselves (existing two-person rules stay in force).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !verifyRazorpaySignature(secret, raw, req.headers.get("x-razorpay-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const eventId = req.headers.get("x-razorpay-event-id") ?? "";
  const type = String(evt.event ?? "");
  if (!eventId || !type) return NextResponse.json({ error: "missing event id" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", process.env.ORG_SLUG ?? "vsm-growth")
    .maybeSingle();
  const entity = (evt.payload?.payment ?? evt.payload?.payment_link ?? evt.payload?.payout)?.entity ?? {};
  const notes = (entity.notes ?? {}) as Record<string, string>;
  const amountRupees = typeof entity.amount === "number" ? entity.amount / 100 : null;

  let matchKind: "INVOICE" | "PAYROLL_ENTRY" | null = null,
    matchId: string | null = null,
    status = "IGNORED",
    error: string | null = null;
  if (org && (type === "payment.captured" || type === "payment_link.paid") && notes.invoice_number) {
    const { data: inv } = await sb
      .from("client_invoices")
      .select("id, total_amount")
      .eq("org_id", org.id)
      .eq("invoice_number", notes.invoice_number)
      .maybeSingle();
    if (inv) {
      matchKind = "INVOICE";
      matchId = inv.id;
      status = "PROCESSED";
    } else {
      status = "FAILED";
      error = `No invoice ${notes.invoice_number}`;
    }
  }
  if (org && type === "payout.processed" && notes.payroll_entry_id) {
    const { data: pe } = await sb
      .from("payroll_entries")
      .select("id, net_amount")
      .eq("org_id", org.id)
      .eq("id", notes.payroll_entry_id)
      .maybeSingle();
    if (!pe) {
      status = "FAILED";
      error = "No matching payroll entry";
    } else if (amountRupees !== null && Math.abs(Number(pe.net_amount) - amountRupees) > 0.009) {
      status = "FAILED";
      error = `Amount mismatch: payout ₹${amountRupees} vs net ₹${pe.net_amount}`;
      matchKind = "PAYROLL_ENTRY";
      matchId = pe.id;
    } else {
      matchKind = "PAYROLL_ENTRY";
      matchId = pe.id;
      status = "PROCESSED";
    }
  }
  const { error: dup } = await sb.from("inbound_webhook_events").insert({
    org_id: org?.id ?? null,
    provider: "RAZORPAY",
    external_id: eventId,
    event_type: type,
    payload: {
      id: entity.id,
      amount: amountRupees,
      currency: entity.currency,
      method: entity.method,
      utr: entity.utr ?? entity.acquirer_data,
      notes,
    },
    status,
    error,
    match_kind: matchKind,
    match_id: matchId,
    processed_at: new Date().toISOString(),
  });
  if (!dup && org)
    await sb.rpc("record_integration_event", { p_org: org.id, p_key: "razorpay", p_ok: status !== "FAILED", p_error: error });
  return NextResponse.json({ ok: true, duplicate: !!dup, status });
}
