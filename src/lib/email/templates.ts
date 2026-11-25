import { appUrl } from "@/lib/app-url";
/**
 * Email templates — HTML + plain text. Salary emails NEVER contain amounts: they link to the
 * authenticated payslip page. Every value is escaped.
 */
export interface Rendered {
  subject: string;
  html: string;
  text: string;
}
type P = Record<string, unknown>;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const app = () => appUrl();

function layout(title: string, body: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0c;font-family:Arial,Helvetica,sans-serif;color:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141416;border:1px solid #2a2a2e;border-radius:14px">
<tr><td style="padding:28px 32px 8px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D7FF3A">VSM Growth Operations</td></tr>
<tr><td style="padding:0 32px;font-size:26px;line-height:1.2;font-family:Georgia,serif">${esc(title)}</td></tr>
<tr><td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;color:#c9c9c4">${body}</td></tr>
${cta ? `<tr><td style="padding:16px 32px 28px"><a href="${esc(cta.href)}" style="display:inline-block;background:#D7FF3A;color:#0b0b0c;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${esc(cta.label)}</a><p style="margin:12px 0 0;font-size:12px;color:#7a7a76">Button not working? Open <a href="${esc(cta.href)}" style="color:#D7FF3A">${esc(cta.href.length > 70 ? app() + "/login" : cta.href)}</a></p></td></tr>` : ""}
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#7a7a76;border-top:1px solid #2a2a2e">VSM Growth · Meerut & Noida · vsmgrowth.com<br>You're receiving this because of your VSM Growth account or enquiry.</td></tr>
</table></td></tr></table></body></html>`;
}

export const templates: Record<string, (p: P) => Rendered> = {
  "lead.new_internal": (p) => ({
    subject: `New enquiry${p.duplicate ? " (possible duplicate)" : ""}: ${p.name}`,
    html: layout(
      `New enquiry from ${p.name}`,
      `Service: <b>${esc(p.service ?? "Not specified")}</b>${p.duplicate ? "<br>⚠ Matches an existing lead by email/phone." : ""}`,
      { label: "Open in CRM", href: `${app()}/leads/${p.lead_id}` },
    ),
    text: `New enquiry from ${p.name}\nService: ${p.service ?? "Not specified"}\n${app()}/leads/${p.lead_id}`,
  }),
  "lead.acknowledgement": (p) => ({
    subject: "Thanks for reaching out to VSM Growth",
    html: layout(
      `Thank you, ${p.name}`,
      "We've received your enquiry. Someone from our team will get back to you within one working day.<br><br>For anything urgent, call +91 82795 74755.",
    ),
    text: `Thank you, ${p.name}.\nWe've received your enquiry and will get back to you within one working day.\nUrgent? Call +91 82795 74755.\n— VSM Growth`,
  }),
  "task.assigned": (p) => ({
    subject: `New task: ${p.title}`,
    html: layout(
      "You have a new task",
      `<b>${esc(p.title)}</b>${p.deadline ? `<br>Due: ${esc(new Date(String(p.deadline)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}` : ""}`,
      { label: "Open task", href: `${app()}/tasks?focus=${p.task_id}` },
    ),
    text: `New task: ${p.title}\n${app()}/tasks?focus=${p.task_id}`,
  }),
  "payroll.payslip_available": (p) => ({
    subject: "Your payslip is ready",
    html: layout(
      "Your payslip is ready",
      `Your payslip for ${esc(p.period_start)} to ${esc(p.period_end)} is available. For your privacy, amounts are only shown after you sign in.`,
      { label: "View payslip", href: `${app()}/payroll/my-salary` },
    ),
    text: `Your payslip for ${p.period_start} – ${p.period_end} is available. Sign in to view it: ${app()}/payroll/my-salary`,
  }),
  "report.ready": (p) => ({
    subject: `Report ready: ${p.report}`,
    html: layout(
      `${p.report} is ready`,
      `Hi ${esc(p.name)}, your scheduled report for <b>${esc(p.period)}</b> has been generated. For privacy, the figures are only available after you sign in.`,
      { label: "Download report", href: `${app()}/api/reports/runs/${p.run_id}` },
    ),
    text: `Hi ${p.name}, your report "${p.report}" for ${p.period} is ready. Sign in to download: ${app()}/api/reports/runs/${p.run_id}`,
  }),
  "chat.unread_reminder": (p) => {
    const chats = (Array.isArray(p.chats) ? p.chats : []) as { name?: string; count?: number }[];
    const list = chats.map((c) => `${esc(c.name ?? "Chat")} — ${Number(c.count ?? 0)} new`).join("<br>");
    return {
      subject: `You have ${p.total} unread message${Number(p.total) === 1 ? "" : "s"} on VSM Ops`,
      html: layout(
        `${p.total} unread message${Number(p.total) === 1 ? "" : "s"}`,
        `Hi ${esc(p.name)}, these chats have messages waiting for you for over 2 hours:<br><br>${list}`,
        { label: "Open chats", href: `${app()}/chat` },
      ),
      text: `Hi ${p.name}, you have ${p.total} unread messages waiting for over 2 hours:\n${chats.map((c) => `- ${c.name}: ${c.count} new`).join("\n")}\nOpen: ${app()}/chat`,
    };
  },
  "digest.daily": (p) => {
    const items = (Array.isArray(p.items) ? p.items : []) as { template: string; payload: P; category: string }[];
    const rows = items.map((i) => ({ category: i.category, subject: templates[i.template]?.(i.payload ?? {}).subject ?? i.template }));
    return {
      subject: `Your VSM daily summary: ${rows.length} update${rows.length === 1 ? "" : "s"}`,
      html: layout(
        `Hi ${p.name ?? "there"}, here's your day`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows
          .map(
            (r) =>
              `<tr><td style="padding:6px 0;border-bottom:1px solid #2a2a2e;font-size:11px;letter-spacing:.12em;color:#7a7a76;width:110px">${esc(r.category)}</td><td style="padding:6px 0;border-bottom:1px solid #2a2a2e">${esc(r.subject)}</td></tr>`,
          )
          .join("")}</table>
         <p style="font-size:12px;color:#7a7a76;margin-top:16px">You get these as a daily summary because of your notification preferences.</p>`,
        { label: "Open VSM Ops", href: `${app()}/notifications` },
      ),
      text:
        `Your VSM daily summary (${p.date}):\n` +
        rows.map((r) => `- [${r.category}] ${r.subject}`).join("\n") +
        `\n\n${app()}/notifications\nChange how you receive these: ${app()}/notifications/preferences`,
    };
  },
  "integration.test": (p) => ({
    subject: "VSM Ops email test ✓",
    html: layout(
      "Email is working",
      `This test was sent by ${esc(p.by)} from the Integrations panel at ${esc(p.at)} using ${esc(p.provider)}.`,
    ),
    text: `Email is working. Sent by ${p.by} via ${p.provider} at ${p.at}.`,
  }),
  "auth.invite": (p) => ({
    subject: "Welcome to VSM Growth Operations",
    html: layout(
      `Welcome, ${p.name}`,
      "Your VSM Growth Operations account has been created. Use the invitation email from our sign-in provider to set your password.",
    ),
    text: `Welcome, ${p.name}. Your VSM Growth Operations account has been created.`,
  }),
};

const detailRows = (rows: [string, unknown][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 4px;border-collapse:collapse">${rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#7a7a76;font-size:13px;width:40%">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#f4f4f2"><b>${esc(v)}</b></td></tr>`,
    )
    .join("")}</table>`;

templates["employee.welcome"] = (p) => ({
  subject: `Welcome to VSM Growth, ${String(p.first_name ?? p.name)} — your login`,
  html: layout(
    `Welcome to the team, ${String(p.first_name ?? p.name)}`,
    `Your VSM Growth Operations account is ready. Here are your details:` +
      detailRows([
        ["Name", p.name],
        ["Employee ID", p.code],
        ["Post", p.post],
        ["Department", p.department],
        ["Team", p.team],
        ["Reports to", p.manager],
        ["Joining date", p.joining_label ?? p.joining],
        ["Salary date", p.salary_label],
        ["Login page", `${app()}/login`],
        ["Login email", p.email],
        ["Temporary password", p.password],
      ]) +
      (p.password
        ? `<p style="color:#c9c9c4">Sign in with the temporary password above — you'll be asked to choose your own straight away.</p>`
        : `<p style="color:#c9c9c4">Click the button to set your password. The link works once and expires in 24 hours.</p>`) +
      `<p style="color:#c9c9c4"><b>First task:</b> complete your KYC (Menu → My KYC) — fill the form and upload your documents so HR can verify them.</p>` +
      `<p style="color:#7a7a76;font-size:13px">On day one: clock in from the Attendance page, turn on desktop notifications, and say hi in your team chat.</p>`,
    { label: p.password ? "Log in to VSM Operations" : "Set my password", href: String(p.link || `${app()}/login`) },
  ),
  text: `Welcome to VSM Growth, ${p.name}.\nEmployee ID: ${p.code}\nPost: ${p.post ?? "-"}\nJoining date: ${p.joining_label ?? p.joining ?? "-"}\nSalary date: ${p.salary_label ?? "-"}\nLogin page: ${app()}/login\nLogin email: ${p.email}\n${
    p.password
      ? `Temporary password: ${p.password} (you must change it at first sign-in)\nSign in: ${app()}/login`
      : `Set your password: ${p.link}`
  }\nFirst task: complete your KYC (Menu → My KYC).`,
});

templates["auth.new_password"] = (p) => ({
  subject: "Your new VSM Ops password",
  html: layout(
    `New password for ${String(p.name)}`,
    `Your administrator generated a new temporary password for your VSM Ops account.` +
      detailRows([
        ["Login email", p.email],
        ["Temporary password", p.password],
      ]) +
      `<p style="color:#c9c9c4">You'll be asked to choose your own password when you sign in. If you didn't expect this, tell HR.</p>`,
    { label: "Log in to VSM Operations", href: `${app()}/login` },
  ),
  text: `New temporary password for ${p.email}: ${p.password}\nSign in at ${app()}/login — you'll be asked to choose your own.`,
});

export function render(template: string, payload: P): Rendered | null {
  const t = templates[template];
  return t ? t(payload) : null;
}
