import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));

const { isPrivateAddress, assertSafeUrlSyntax, UnsafeUrlError } = await import("@/lib/delivery/ssrf");
const sig = await import("@/lib/delivery/signatures");
const msg = await import("@/lib/delivery/messages");
const { ORG_EVENTS } = await import("@/lib/delivery/events");
const read = (p: string) => readFileSync(p, "utf8");

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "172.16.0.9",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "142.250.183.14", "2606:4700:4700::1111"])("allows public %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
  it.each([
    "http://example.com/x",
    "https://user:pw@example.com",
    "https://localhost/x",
    "https://127.0.0.1/",
    "https://example.com:22/",
    "ftp://example.com",
    "https://metadata.google.internal/",
  ])("rejects %s", (u) => expect(() => assertSafeUrlSyntax(u)).toThrow(UnsafeUrlError));
  it("accepts a normal https URL", () =>
    expect(assertSafeUrlSyntax("https://hooks.zapier.com/hooks/catch/1/abc").hostname).toBe("hooks.zapier.com"));
});

describe("signatures", () => {
  const secret = "whsec_" + "x".repeat(40);
  it("round-trips the outbound webhook signature", () => {
    const body = JSON.stringify({ a: 1 });
    const h = sig.signWebhook(secret, body);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(sig.verifyWebhookSignature(secret, body, h)).toBe(true);
    expect(sig.verifyWebhookSignature(secret, body + " ", h)).toBe(false);
    expect(sig.verifyWebhookSignature("wrong" + secret, body, h)).toBe(false);
  });
  it("rejects stale timestamps (replay)", () => {
    const h = sig.signWebhook(secret, "{}", 1_000);
    expect(sig.verifyWebhookSignature(secret, "{}", h, 1_000 + 301)).toBe(false);
    expect(sig.verifyWebhookSignature(secret, "{}", h, 1_000 + 60)).toBe(true);
  });
  it("verifies Meta X-Hub-Signature-256", () => {
    const body = '{"object":"page"}';
    const good = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(sig.verifyMetaSignature("app-secret", body, good)).toBe(true);
    expect(sig.verifyMetaSignature("app-secret", body, "sha256=" + "0".repeat(64))).toBe(false);
    expect(sig.verifyMetaSignature("app-secret", body, null)).toBe(false);
  });
  it("verifies Razorpay signatures", () => {
    const body = '{"event":"payment.captured"}';
    const good = createHmac("sha256", "rzp").update(body).digest("hex");
    expect(sig.verifyRazorpaySignature("rzp", body, good)).toBe(true);
    expect(sig.verifyRazorpaySignature("rzp", body, good.slice(0, -1) + "0")).toBe(false);
    expect(sig.verifyRazorpaySignature("rzp", body, null)).toBe(false);
  });
});

describe("channel messages", () => {
  it("every routable event has a label and a non-default text", () => {
    for (const e of ORG_EVENTS) {
      expect(msg.EVENT_LABEL[e]).toBeTruthy();
      expect(msg.orgEventText(e, { name: "A", title: "T" })).not.toBe(e);
    }
  });
  it("payroll text never contains an amount even if one sneaks in", () => {
    const t = msg.orgEventText("payroll.approved", {
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      employees: 9,
      net_amount: 123456,
    });
    expect(t).not.toContain("123456");
    expect(JSON.stringify(msg.slackMessage("payroll.approved", { employees: 9, salary: 98765 }))).not.toContain("98765");
  });
  it("links are absolute and only to the app", () => {
    process.env.APP_URL = "https://ops.vsmgrowth.com";
    expect(JSON.stringify(msg.slackMessage("lead.created", { name: "X", link: "/leads/1" }))).toContain(
      "https://ops.vsmgrowth.com/leads/1",
    );
    expect(JSON.stringify(msg.slackMessage("lead.created", { name: "X", link: "https://evil.example" }))).not.toContain("evil.example");
    expect(JSON.parse(msg.pushPayload({ title: "t", link: "//evil.example" })).url).toBe("/notifications");
  });
  it("WhatsApp uses an approved template with 2 params", () => {
    const m = msg.whatsappTemplate("+919876543210", { title: "Leave approved", link: "/leave" });
    expect(m.to).toBe("919876543210");
    expect(m.type).toBe("template");
    expect(m.template.components[0]!.parameters).toHaveLength(2);
  });
  it("analytics paths drop ids and query strings", () => {
    expect(msg.sanitizePath("/people/6f1c2b9e-1111-4a2b-9c3d-0123456789ab/edit?tab=salary")).toBe("/people/:id/edit");
    expect(msg.sanitizePath("/leads/12345")).toBe("/leads/:n");
  });
});

describe("Block 17 wiring", () => {
  it("cron drains both outboxes; webhooks and sw.js are public", () => {
    expect(read("src/app/api/cron/email/route.ts")).toMatch(/drainDeliveries/);
    const mw = read("src/middleware.ts");
    for (const p of ["api\\/webhooks", "sw\\.js"]) expect(mw).toContain(p);
  });
  it("webhook secrets are never selected back from the browser-facing client", () => {
    const page = read("src/app/(app)/settings/integrations/webhooks/page.tsx");
    expect(page).not.toMatch(/select\([^)]*secret/);
  });
  it("service worker only opens same-origin paths", () => {
    expect(read("public/sw.js")).toMatch(/target.origin === self.location.origin/);
  });
  it("analytics sends no personal identifiers", () => {
    const a = read("src/components/analytics.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(a).not.toMatch(/email|full_name|phone/);
    expect(a).toMatch(/sanitizePath/);
  });
});
