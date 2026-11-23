import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Outbound: header X-VSM-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** For receivers (documented in the panel): reject if older than 5 minutes or signature differs. */
export function verifyWebhookSignature(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now - t) > 300 || !parts.v1) return false;
  return safeEqual(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"), parts.v1);
}

/** Meta (Lead Ads + WhatsApp): X-Hub-Signature-256: sha256=<hex HMAC of raw body with app secret>. */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`, header);
}

/** Razorpay: X-Razorpay-Signature = hex HMAC-SHA256 of raw body with the webhook secret. */
export function verifyRazorpaySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  return safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), header);
}
