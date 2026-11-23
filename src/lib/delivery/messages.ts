/**
 * Message builders for each channel (pure functions, unit-tested).
 * Organisation channels receive allow-listed events only; amounts were already stripped in the DB.
 */
export type Payload = Record<string, unknown>;
const appUrl = () => process.env.APP_URL ?? "https://ops.vsmgrowth.com";
/** Same-origin app path only: "/x" yes, "//host" or "/\\host" no. */
export const localPath = (link: unknown): string | null =>
  typeof link === "string" && /^\/(?![/\\])/.test(link) ? link.slice(0, 500) : null;
const abs = (link: unknown) => `${appUrl()}${localPath(link) ?? ""}`;
const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);

export const EVENT_LABEL: Record<string, string> = {
  "lead.created": "New lead",
  "lead.won": "Lead won",
  "employee.joined": "New team member",
  "leave.approved": "Leave approved",
  "payroll.approved": "Payroll approved",
  "announcement.published": "Announcement",
  "task.completed": "Task completed",
  "integration.failing": "Integration failing",
};

export function orgEventText(event: string, p: Payload): string {
  switch (event) {
    case "lead.created":
      return `🆕 New lead: *${str(p.name)}*${p.company ? ` (${str(p.company)})` : ""}${p.service ? ` · ${str(p.service)}` : ""} · source ${str(p.source)}`;
    case "lead.won":
      return `🏆 Lead won: *${str(p.name)}*${p.company ? ` (${str(p.company)})` : ""}`;
    case "employee.joined":
      return `👋 Welcome *${str(p.name)}*${p.designation ? `, ${str(p.designation)}` : ""} — joining ${str(p.joining_date)}`;
    case "leave.approved":
      return `🌴 ${str(p.name)} is on leave ${str(p.from)}${p.to && p.to !== p.from ? ` → ${str(p.to)}` : ""}${p.half_day ? " (half day)" : ""}`;
    case "payroll.approved":
      return `✅ Payroll approved for ${str(p.period_start)} – ${str(p.period_end)} (${str(p.employees)} employees). Payslips are available in VSM Ops.`;
    case "announcement.published":
      return `📣 ${str(p.title)}`;
    case "task.completed":
      return `✔️ ${str(p.assignee)} completed “${str(p.title)}”${p.quality ? ` · quality ${str(p.quality)}` : ""}`;
    case "integration.test":
      return `🔧 ${str(p.title) || "VSM Ops test"} — ${str(p.summary || p.body)}`;
    case "integration.failing":
      return `⚠️ Integration *${str(p.integration)}* has failed 3 times in a row: ${str(p.error)}`;
    default:
      return str(EVENT_LABEL[event] ?? event);
  }
}

export function slackMessage(event: string, p: Payload) {
  const text = orgEventText(event, p);
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "context", elements: [{ type: "mrkdwn", text: `<${abs(p.link)}|Open in VSM Ops> · ${EVENT_LABEL[event] ?? event}` }] },
    ],
  };
}

/** Teams: works with Workflows ("Post to a channel when a webhook request is received") and legacy connectors. */
export function teamsMessage(event: string, p: Payload) {
  const text = orgEventText(event, p).replace(/\*/g, "**");
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text, wrap: true }],
          actions: [{ type: "Action.OpenUrl", title: "Open in VSM Ops", url: abs(p.link) }],
        },
      },
    ],
  };
}

/** WhatsApp Cloud API template message. The template must be approved in Meta with 2 body variables. */
export function whatsappTemplate(to: string, p: Payload) {
  return {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE ?? "vsm_notification",
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: str(p.title, 120) || "VSM Ops update" },
            { type: "text", text: abs(p.link) },
          ],
        },
      ],
    },
  };
}

export function pushPayload(p: Payload) {
  return JSON.stringify({
    title: str(p.title, 120) || "VSM Ops",
    body: str(p.body, 240),
    url: localPath(p.link) ?? "/notifications",
    tag: str(p.notification_id, 64),
  });
}

/** Analytics: collapse ids so no personal identifiers leave the app. */
export function sanitizePath(path: string): string {
  return path
    .split("?")[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{3,}(?=\/|$)/g, "/:n")
    .replace(/[^\w\-/:.]/g, "");
}
