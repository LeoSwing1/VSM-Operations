import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyMetaSignature } from "@/lib/delivery/signatures";

export const dynamic = "force-dynamic";

/**
 * One Meta webhook for both products:
 *  • Lead Ads (field "leadgen") → fetch the lead from the Graph API → CRM lead, source CAMPAIGN.
 *  • WhatsApp Cloud API (field "messages" → statuses) → update our delivery rows (delivered/read/failed).
 * Verification: GET hub.challenge with META_VERIFY_TOKEN. Every POST must carry a valid
 * X-Hub-Signature-256 made with META_APP_SECRET. Each external event is stored once (idempotent).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.META_VERIFY_TOKEN ?? "";
  const given = p.get("hub.verify_token") ?? "";
  const ok =
    p.get("hub.mode") === "subscribe" &&
    expected.length > 0 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  return ok ? new NextResponse(p.get("hub.challenge") ?? "", { status: 200 }) : NextResponse.json({ error: "forbidden" }, { status: 403 });
}

type LeadField = { name: string; values?: string[] };
const pick = (fields: LeadField[], ...names: string[]) =>
  fields.find((f) => names.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || undefined;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  if (!secret || !verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: { object?: string; entry?: { id?: string; changes?: { field: string; value: Record<string, unknown> }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const slug = process.env.ORG_SLUG ?? "vsm-growth";
  const { data: org } = await sb.from("organizations").select("id").eq("slug", slug).maybeSingle();
  let handled = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === "leadgen" && typeof v.leadgen_id === "string") {
        const { error: dup } = await sb.from("inbound_webhook_events").insert({
          org_id: org?.id ?? null,
          provider: "META_LEADS",
          external_id: v.leadgen_id,
          event_type: "leadgen",
          payload: v,
        });
        if (dup) continue; // already processed (unique provider + external_id)
        try {
          const token = process.env.META_PAGE_TOKEN;
          if (!token) throw new Error("META_PAGE_TOKEN not configured");
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${encodeURIComponent(v.leadgen_id)}?fields=field_data,form_id,ad_id,created_time`,
            {
              headers: { authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(8000),
            },
          );
          const lead = (await r.json()) as { field_data?: LeadField[]; form_id?: string; ad_id?: string; error?: { message: string } };
          if (!r.ok || lead.error) throw new Error(lead.error?.message ?? `Graph ${r.status}`);
          const f = lead.field_data ?? [];
          const { data: res, error } = await sb.rpc("ingest_campaign_lead", {
            p_org_slug: slug,
            p: {
              name: pick(f, "full_name", "name", "first_name"),
              email: pick(f, "email", "work_email"),
              phone: pick(f, "phone_number", "phone"),
              company: pick(f, "company_name", "company"),
              service: pick(f, "service", "service_interest", "what_service_are_you_looking_for?"),
              message: pick(f, "message", "requirements", "comments"),
              form_id: lead.form_id ?? v.form_id,
              ad_id: lead.ad_id ?? v.ad_id,
            },
          });
          if (error) throw new Error(error.message);
          await sb
            .from("inbound_webhook_events")
            .update({
              status: "PROCESSED",
              processed_at: new Date().toISOString(),
              match_kind: "LEAD",
              match_id: (res as { lead_id?: string })?.lead_id ?? null,
            })
            .eq("provider", "META_LEADS")
            .eq("external_id", v.leadgen_id);
          if (org) await sb.rpc("record_integration_event", { p_org: org.id, p_key: "meta_leads", p_ok: true, p_error: null });
          handled++;
        } catch (e) {
          await sb
            .from("inbound_webhook_events")
            .update({ status: "FAILED", error: (e as Error).message.slice(0, 300) })
            .eq("provider", "META_LEADS")
            .eq("external_id", v.leadgen_id);
          if (org)
            await sb.rpc("record_integration_event", {
              p_org: org.id,
              p_key: "meta_leads",
              p_ok: false,
              p_error: (e as Error).message.slice(0, 300),
            });
        }
      }
      if (change.field === "messages" && Array.isArray(v.statuses)) {
        for (const s of v.statuses as { id: string; status: string; timestamp?: string; errors?: { title?: string }[] }[]) {
          const { error: dup } = await sb.from("inbound_webhook_events").insert({
            org_id: org?.id ?? null,
            provider: "WHATSAPP",
            external_id: `${s.id}:${s.status}`,
            event_type: `status.${s.status}`,
            payload: s,
            status: "PROCESSED",
            processed_at: new Date().toISOString(),
            match_kind: "DELIVERY",
          });
          if (dup) continue;
          if (s.status === "failed") {
            await sb
              .from("delivery_outbox")
              .update({
                status: "FAILED",
                next_attempt_at: "infinity",
                last_error: `WhatsApp: ${s.errors?.[0]?.title ?? "delivery failed"}`.slice(0, 300),
              })
              .eq("provider_message_id", s.id);
          }
          handled++;
        }
      }
    }
  }
  return NextResponse.json({ ok: true, handled });
}
