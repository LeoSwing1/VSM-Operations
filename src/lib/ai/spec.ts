/**
 * AI assistant — tool catalogue and prompt rules (pure; no I/O). Every tool is READ-ONLY and runs with the
 * signed-in person's own database session, so row-level security decides what the model can see.
 * Payroll, salaries, bank and tax details are deliberately not exposed to the model at all.
 */

export type ChatMsg = { role: "user" | "assistant"; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const dateProp = { type: "string", description: "Date as YYYY-MM-DD" };

export const toolSpecs: ToolSpec[] = [
  {
    name: "my_tasks",
    description: "The signed-in person's own open tasks (not completed/cancelled), soonest deadline first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "team_tasks",
    description: "Open tasks the person can see for their team/company, optionally only overdue ones or for one assignee name.",
    input_schema: {
      type: "object",
      properties: { overdue_only: { type: "boolean" }, assignee_name: { type: "string" } },
    },
  },
  {
    name: "attendance_today",
    description: "Who has clocked in, is on break or clocked out today (only people the user may see).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "daily_updates",
    description: "Daily work updates (completed, in progress, blockers, tomorrow) for a date range, optionally one person.",
    input_schema: {
      type: "object",
      properties: { from: dateProp, to: dateProp, employee_name: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "leads",
    description:
      "CRM leads the user can see. Filter by status (NEW, CONTACTED, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST) or a search word.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string" }, search: { type: "string" }, follow_up_due: { type: "boolean" } },
    },
  },
  {
    name: "project_status",
    description: "A project's status, milestones and latest updates by (part of) its name; without a name lists active projects.",
    input_schema: { type: "object", properties: { name: { type: "string" } } },
  },
  {
    name: "leave_calendar",
    description: "Approved and pending leave between two dates for people the user may see.",
    input_schema: { type: "object", properties: { from: dateProp, to: dateProp }, required: ["from", "to"] },
  },
  {
    name: "okrs",
    description: "Objectives and key results for the current quarter that the user can see, with progress.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "kpis",
    description: "KPI values for a month (YYYY-MM-01) for people the user may see.",
    input_schema: { type: "object", properties: { month: { type: "string" }, employee_name: { type: "string" } } },
  },
  {
    name: "scholars_pipeline",
    description: "VSM Scholars students by stage and upcoming follow-ups (only if the user has Scholars access).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "invoices_outstanding",
    description: "Unpaid client invoices with balance and due date (only if the user has finance access).",
    input_schema: { type: "object", properties: {} },
  },
];

export const LANG_RULE: Record<string, string> = {
  HINGLISH:
    "Reply in natural Hinglish (Hindi words in Roman script mixed with English, the way a Meerut/Noida agency team talks on WhatsApp). Keep business terms in English.",
  ENGLISH: "Reply in clear, simple Indian English.",
  HINDI: "Reply in simple Hindi (Devanagari), keeping business terms in English.",
};

export function systemPrompt(opts: {
  orgName: string;
  userName: string;
  role: string;
  designation: string | null;
  today: string;
  language: string;
}) {
  return [
    `You are the operations assistant inside ${opts.orgName}'s internal operations panel (VSM Growth Operations).`,
    `You are talking to ${opts.userName} (${opts.designation ?? opts.role}). Today is ${opts.today} (India time).`,
    "Use the tools to look up facts; never guess numbers, names or dates. If a tool returns nothing or an access error, say you can't see that data — don't speculate about why.",
    "You only ever see what this person is already allowed to see. You have no access to salaries, payroll, bank or tax details: if asked, say those stay in the Payroll module.",
    "You cannot change anything (no creating, approving or deleting). Point the person to the right screen instead.",
    "Be brief and practical: short bullets, names and dates first. Never invent client commitments.",
    LANG_RULE[opts.language] ?? LANG_RULE.ENGLISH,
  ].join("\n");
}

/** Keep the last `max` messages, starting with a user turn and alternating roles (as the API requires). */
export function trimHistory(msgs: readonly ChatMsg[], max = 12): ChatMsg[] {
  const clean: ChatMsg[] = [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) continue;
    const content = m.content.slice(0, 6000);
    if (clean.length && clean[clean.length - 1]!.role === m.role) clean[clean.length - 1] = { role: m.role, content };
    else clean.push({ role: m.role, content });
  }
  let out = clean.slice(-max);
  while (out.length && out[0]!.role !== "user") out = out.slice(1);
  return out;
}

/** Shrink a tool result so one big table can't blow the context window. */
export function clip(value: unknown, maxChars = 12000): string {
  const s = JSON.stringify(value ?? null);
  return s.length > maxChars ? s.slice(0, maxChars) + `… (truncated, ${s.length - maxChars} more characters)` : s;
}
