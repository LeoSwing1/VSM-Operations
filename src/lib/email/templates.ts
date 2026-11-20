/**
 * Email templates — HTML + plain text. Salary emails NEVER contain amounts: they link to the
 * authenticated payslip page. Every value is escaped.
 */
export interface Rendered { subject: string; html: string; text: string }
type P = Record<string, unknown>;

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const app = () => process.env.APP_URL ?? "https://ops.vsmgrowth.com";

function layout(title: string, body: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0c;font-family:Arial,Helvetica,sans-serif;color:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141416;border:1px solid #2a2a2e;border-radius:14px">
<tr><td style="padding:28px 32px 8px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D7FF3A">VSM Growth Operations</td></tr>
<tr><td style="padding:0 32px;font-size:26px;line-height:1.2;font-family:Georgia,serif">${esc(title)}</td></tr>
<tr><td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;color:#c9c9c4">${body}</td></tr>
${cta ? `<tr><td style="padding:16px 32px 28px"><a href="${esc(cta.href)}" style="display:inline-block;background:#D7FF3A;color:#0b0b0c;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${esc(cta.label)}</a></td></tr>` : ""}
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#7a7a76;border-top:1px solid #2a2a2e">VSM Growth · Meerut & Noida · vsmgrowth.com<br>You're receiving this because of your VSM Growth account or enquiry.</td></tr>
</table></td></tr></table></body></html>`;
}

export const templates: Record<string, (p: P) => Rendered> = {
  "lead.new_internal": (p) => ({
    subject: `New enquiry${p.duplicate ? " (possible duplicate)" : ""}: ${p.name}`,
    html: layout(`New enquiry from ${p.name}`, `Service: <b>${esc(p.service ?? "Not specified")}</b>${p.duplicate ? "<br>⚠ Matches an existing lead by email/phone." : ""}`,
      { label: "Open in CRM", href: `${app()}/leads/${p.lead_id}` }),
    text: `New enquiry from ${p.name}\nService: ${p.service ?? "Not specified"}\n${app()}/leads/${p.lead_id}`,
  }),
  "lead.acknowledgement": (p) => ({
    subject: "Thanks for reaching out to VSM Growth",
    html: layout(`Thank you, ${p.name}`, "We've received your enquiry. Someone from our team will get back to you within one working day.<br><br>For anything urgent, call +91 82795 74755."),
    text: `Thank you, ${p.name}.\nWe've received your enquiry and will get back to you within one working day.\nUrgent? Call +91 82795 74755.\n— VSM Growth`,
  }),
  "task.assigned": (p) => ({
    subject: `New task: ${p.title}`,
    html: layout("You have a new task", `<b>${esc(p.title)}</b>${p.deadline ? `<br>Due: ${esc(new Date(String(p.deadline)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}` : ""}`,
      { label: "Open task", href: `${app()}/tasks?focus=${p.task_id}` }),
    text: `New task: ${p.title}\n${app()}/tasks?focus=${p.task_id}`,
  }),
  "payroll.payslip_available": (p) => ({
    subject: "Your payslip is ready",
    html: layout("Your payslip is ready", `Your payslip for ${esc(p.period_start)} to ${esc(p.period_end)} is available. For your privacy, amounts are only shown after you sign in.`,
      { label: "View payslip", href: `${app()}/payroll/my-salary` }),
    text: `Your payslip for ${p.period_start} – ${p.period_end} is available. Sign in to view it: ${app()}/payroll/my-salary`,
  }),
  "auth.invite": (p) => ({
    subject: "Welcome to VSM Growth Operations",
    html: layout(`Welcome, ${p.name}`, "Your VSM Growth Operations account has been created. Use the invitation email from our sign-in provider to set your password."),
    text: `Welcome, ${p.name}. Your VSM Growth Operations account has been created.`,
  }),
};

export function render(template: string, payload: P): Rendered | null {
  const t = templates[template];
  return t ? t(payload) : null;
}
