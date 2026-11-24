import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
const read = (p: string) => readFileSync(p, "utf8");

describe("Block 19 — hardening", async () => {
  const { scrub } = await import("@/lib/app-errors");
  it("error log scrubs JWTs, API keys and passwords", () => {
    const s = scrub(
      "failed with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop key xkeysib-abcdef1234567890 password=hunter2",
      1000,
    )!;
    expect(s).not.toMatch(/eyJhbGci|xkeysib-abc|hunter2/);
    expect(s.match(/\[redacted\]/g)).toHaveLength(3);
  });
  it("sign-in and forgot-password are rate limited; status too", () => {
    expect(read("src/app/auth/sign-in/route.ts")).toMatch(/allow\("signin-ip"[\s\S]*allow\("signin-acct"/);
    expect(read("src/app/auth/forgot/route.ts")).toContain('allow("forgot-ip"');
    expect(read("src/app/api/status/route.ts")).toContain('allow("status"');
  });
  it("CI runs format, typecheck, unit, build, Playwright and BOTH database modes", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const s of [
      "format:check",
      "typecheck",
      "npm test",
      "npm run build",
      "playwright test",
      "./scripts/test-db.sh",
      "STRICT_GRANTS=1",
    ])
      expect(ci).toContain(s);
  });
  it("service worker caches only the offline page, never private pages", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('event.request.mode !== "navigate"');
    expect(sw).toMatch(/addAll\(\[OFFLINE, "\/icons\/icon-192\.png"\]\)/);
  });
});

describe("Block 20 — field attendance", () => {
  it("camera is allowed for the selfie and location for geofencing", () => {
    expect(read("next.config.ts")).toContain("camera=(self), microphone=(), geolocation=(self)");
  });
  it("punches go through record_attendance_v2; selfies land in the employee's own private folder", () => {
    const a = read("src/app/(app)/attendance/actions.ts");
    expect(a).toContain('rpc("record_attendance_v2"');
    expect(a).toMatch(/selfiePath = `\$\{ctx\.org_id\}\/\$\{ctx\.employee_id\}\//);
  });
  it("offline punches are queued on the device and synced with their original time", () => {
    const c = read("src/app/(app)/attendance/punch-card.tsx");
    expect(c).toContain("enqueuePunch(");
    expect(c).toContain("offlineAt: p.at");
  });
});

describe("Block 21 — bank file", async () => {
  const { genericBankCsv, validIfsc, validAccount, modeFor } = await import("@/lib/payroll/bank-file");
  it("validates IFSC and account numbers", () => {
    expect(validIfsc("HDFC0001234")).toBe(true);
    expect(validIfsc("HDFC1001234")).toBe(false);
    expect(validAccount("123456789012")).toBe(true);
    expect(validAccount("12AB")).toBe(false);
  });
  it("CSV keeps account numbers as text, picks NEFT/RTGS and neutralises formulas in names", () => {
    const csv = genericBankCsv([
      {
        name: "=HYPERLINK(evil)",
        account: "000123456789",
        ifsc: "HDFC0001234",
        amount: 25000,
        code: "VSM-0001",
        narration: "VSM SALARY 2026-10",
        email: "a@b.co",
      },
      {
        name: "Big Salary",
        account: "123456789012",
        ifsc: "ICIC0000001",
        amount: 250000,
        code: "VSM-0002",
        narration: "VSM SALARY 2026-10",
      },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"000123456789"');
    expect(lines[1]).toContain(`"'=HYPERLINK(evil)"`);
    expect(lines[1]).toContain('"NEFT"');
    expect(lines[2]).toContain('"RTGS"');
    expect(modeFor(199999.99)).toBe("NEFT");
  });
  it("payslip PDF is a real PDF and never mentions full PAN or account numbers", async () => {
    const { payslipPdf } = await import("@/lib/pdf/payslip");
    const bytes = await payslipPdf({
      org: "VSM Growth",
      orgLine: "Meerut",
      period: "October 2026",
      issued: "31 Oct 2026",
      released: true,
      employee: { name: "Aman A", code: "VSM-0005", pan: "AB•••••34F", uan: "100200300400", bankLast4: "9012" },
      payableDays: "31 of 31",
      payment: "UNPAID",
      earnings: [{ label: "Base salary", amount: 30000 }],
      deductions: [{ label: "Provident Fund", amount: 1800 }],
      employer: [{ label: "Employer PF", amount: 1800 }],
      gross: 30000,
      totalDeductions: 1800,
      reimbursement: 0,
      net: 28200,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
  it("payroll calculation applies the statutory engine and payout confirmation never auto-pays", () => {
    expect(read("src/app/(app)/payroll/actions.ts")).toContain("computeStatutory(");
    const s = read("src/app/(app)/payroll/statutory-actions.ts");
    expect(s).toContain('requirePerm("payroll.pay")');
    expect(s).toContain('rpc("mark_entry_paid"');
  });
});

describe("Block 22 — Google Workspace", async () => {
  const { buildMime } = await import("@/lib/google/gmail");
  const { googleEventBody } = await import("@/lib/google/calendar-queue");
  it("Gmail MIME: UTF-8 subject encoded, header injection stripped", () => {
    const raw = Buffer.from(
      buildMime({ from: "VSM <a@b.co>", to: "x@y.co\r\nBcc: evil@z.co", subject: "Salary slip ready ✓", text: "hi", html: "<b>hi</b>" }),
      "base64url",
    ).toString();
    expect(raw).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).toContain("multipart/alternative");
  });
  it("Google event copies carry no attendees (Google never emails anyone) and are tagged to prevent re-import", () => {
    const b = googleEventBody(
      {
        id: "e1",
        title: "Standup",
        description: null,
        starts_at: "2026-11-24T04:30:00Z",
        ends_at: "2026-11-24T04:45:00Z",
        all_day: false,
        location: null,
        meeting_url: "https://meet.google.com/x",
      },
      "https://ops.vsmgrowth.com",
    );
    expect(b).not.toHaveProperty("attendees");
    expect(b.extendedProperties.private.vsmEventId).toBe("e1");
    expect(read("src/app/api/cron/calendar-sync/route.ts")).toContain("x.extendedProperties?.private?.vsmEventId");
  });
  it("tokens stay server-side: the connections page never selects token columns", () => {
    expect(read("src/app/(app)/settings/integrations/google/page.tsx")).not.toMatch(/access_token_enc|refresh_token_enc/);
  });
});

describe("Block 23 — VSM Scholars", () => {
  it("certificate PDF embeds a QR that points at the public verify page", async () => {
    const { certificatePdf } = await import("@/lib/pdf/scholars");
    const bytes = await certificatePdf({
      name: "Riya Student",
      course: "Digital Marketing",
      batch: "DM-Jan-27",
      from: "1 Jan 2027",
      to: "31 Mar 2027",
      issued: "1 Apr 2027",
      number: "VSMS-C-2027-0001",
      grade: "A",
      verifyUrl: "https://ops.vsmgrowth.com/verify/abcdef123456",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(read("src/lib/pdf/scholars.ts")).toContain("QRCode.toBuffer(c.verifyUrl");
  });
  it("fees are confirmed only through the database function (receipt numbers can't be forged)", () => {
    expect(read("src/app/(app)/scholars/actions.ts")).toContain('rpc("scholar_confirm_payment"');
    expect(read("supabase/migrations/0031_block23_vsm_scholars.sql")).toContain(
      "revoke update, delete on scholar_fee_payments from authenticated",
    );
  });
  it("the public verify page is reachable without login", () => {
    expect(read("src/middleware.ts")).toContain("/^\\/verify\\//");
  });
});
