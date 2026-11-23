import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { drainOutbox } from "@/lib/email/worker";

/**
 * Public website → CRM intake (vsmgrowth.com forms POST here).
 * Order of operations: validate → rate-limit → PERSIST lead (+ queued emails) → best-effort send.
 * An email failure can never lose the enquiry.
 */
const Enquiry = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200).optional().or(z.literal("")),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,20}$/)
      .optional()
      .or(z.literal("")),
    company: z.string().trim().max(160).optional(),
    service: z.string().trim().max(120).optional(),
    message: z.string().trim().max(5000).optional(),
    kind: z.enum(["contact", "project"]).default("contact"),
    page: z.string().trim().max(300).optional(),
    website: z.string().max(0).optional(), // honeypot — must stay empty
  })
  .refine((v) => v.email || v.phone, { message: "Email or phone is required" });

function cors(origin: string | null) {
  const allowed = (process.env.ENQUIRY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Intake-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function keyMatches(given: string | null) {
  const expected = process.env.ENQUIRY_INTAKE_KEY;
  if (!expected || !given) return false;
  const a = Buffer.from(given),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const allowedOrigin = "Access-Control-Allow-Origin" in headers;
  // Browser posts must come from an allowed origin; server-to-server posts must carry the intake key.
  if (!allowedOrigin && !keyMatches(req.headers.get("x-intake-key"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  }

  let body: unknown;
  try {
    body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json()
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400, headers });
  }

  const parsed = Enquiry.safeParse(body);
  if (!parsed.success) {
    if ((body as Record<string, unknown>)?.website) return NextResponse.json({ ok: true }, { headers }); // silently drop bots
    return NextResponse.json({ error: "validation", issues: parsed.error.flatten().fieldErrors }, { status: 422, headers });
  }

  const sb = supabaseAdmin();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
  const bucket =
    "enquiry:" +
    createHash("sha256")
      .update(ip + (process.env.ENQUIRY_INTAKE_KEY ?? ""))
      .digest("hex")
      .slice(0, 32);
  const { data: allowed } = await sb.rpc("hit_rate_limit", { p_bucket: bucket, p_limit: 5, p_window_seconds: 600 });
  if (allowed === false) return NextResponse.json({ error: "too many requests" }, { status: 429, headers });

  const { website: _hp, ...payload } = parsed.data;
  const { data, error } = await sb.rpc("ingest_enquiry", {
    p_org_slug: process.env.ORG_SLUG ?? "vsm-growth",
    p: payload,
    p_alert_email: process.env.ALERT_EMAIL ?? null,
  });
  if (error) {
    console.error("[enquiry] persist failed", error.code);
    return NextResponse.json({ error: "could not save enquiry" }, { status: 500, headers });
  }

  // Best-effort immediate delivery; the cron worker retries anything that fails.
  try {
    await drainOutbox(5);
  } catch (e) {
    console.error("[enquiry] email deferred", (e as Error).message);
  }

  return NextResponse.json(
    {
      ok: true,
      reference: String(data?.lead_id ?? "")
        .slice(0, 8)
        .toUpperCase(),
    },
    { status: 201, headers },
  );
}
