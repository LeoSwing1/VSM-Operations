import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { brevoPayload, brevoProvider, getProvider, parseAddress, EmailError } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";

const msg = { from: "VSM Growth <ops@mail.vsmgrowth.com>", to: "Lead@Example.com", subject: "Hi", html: "<p>x</p>", text: "x", refId: "job-1", tags: ["lead"] };

describe("email providers", () => {
  it("parses display-name addresses", () => {
    expect(parseAddress("VSM Growth <ops@vsmgrowth.com>")).toEqual({ name: "VSM Growth", email: "ops@vsmgrowth.com" });
    expect(parseAddress("ops@vsmgrowth.com")).toEqual({ email: "ops@vsmgrowth.com" });
    expect(() => parseAddress("not an email")).toThrow(EmailError);
  });

  it("builds the Brevo v3 payload", () => {
    expect(brevoPayload(msg)).toEqual({
      sender: { name: "VSM Growth", email: "ops@mail.vsmgrowth.com" }, to: [{ email: "Lead@Example.com" }],
      subject: "Hi", htmlContent: "<p>x</p>", textContent: "x", headers: { "X-Entity-Ref-Id": "job-1" }, tags: ["lead"],
    });
  });

  it("sends with the api-key header and returns the messageId", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ messageId: "<abc@relay>" }), { status: 201 }));
    const r = await brevoProvider("k-123", f as unknown as typeof fetch).send(msg);
    expect(r.messageId).toBe("<abc@relay>");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("k-123");
  });

  it("classifies failures: 400/401 permanent, 429/5xx retryable", async () => {
    for (const [status, permanent] of [[400, true], [401, true], [429, false], [503, false]] as const) {
      const p = brevoProvider("k", (async () => new Response("err", { status })) as unknown as typeof fetch);
      await expect(p.send(msg)).rejects.toMatchObject({ permanent, status });
    }
  });

  it("picks Brevo when configured, nothing when not", async () => {
    expect((await getProvider({ BREVO_API_KEY: "x" } as any))?.name).toBe("brevo");
    expect(await getProvider({ EMAIL_PROVIDER: "brevo" } as any)).toBeNull();
    expect(await getProvider({} as any)).toBeNull();
  });

  it("payslip email never contains amounts", () => {
    const r = render("payroll.payslip_available", { period_start: "2026-10-01", period_end: "2026-10-31", net_amount: 99999 })!;
    expect(r.html + r.text).not.toMatch(/99999|₹/);
  });
});
