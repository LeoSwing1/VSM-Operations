/** Mirrors notification_categories() in migration 0007. */
export const CATEGORIES: { key: string; label: string; hint: string; live: boolean }[] = [
  { key: "TASKS", label: "Tasks", hint: "Assignments, reviews, deadlines", live: true },
  { key: "LEAVE", label: "Leave", hint: "Requests and decisions", live: true },
  { key: "PAYROLL", label: "Payroll", hint: "Payslip ready (never shows amounts)", live: true },
  { key: "CRM", label: "CRM & leads", hint: "New enquiries, follow-ups", live: true },
  { key: "APPROVALS", label: "Approvals", hint: "Things waiting for your decision", live: true },
  { key: "ATTENDANCE", label: "Attendance", hint: "Reminders and corrections", live: true },
  { key: "PERFORMANCE", label: "Performance", hint: "Reviews and snapshots", live: true },
  { key: "PROJECTS", label: "Projects", hint: "Project updates", live: true },
  { key: "CHAT", label: "Chat", hint: "New messages in your conversations and team groups", live: true },
  { key: "ANNOUNCEMENTS", label: "Announcements", hint: "Company announcements", live: true },
  { key: "MEETINGS", label: "Meetings", hint: "Invitations and reminders", live: true },
  { key: "TRAINING", label: "Training", hint: "Arrives with Block 7", live: false },
  { key: "INTEGRATIONS", label: "Integrations", hint: "Admin alerts about connected services", live: true },
];
export const DEFAULT_MODE = (k: string) => (k === "CHAT" ? "DIGEST" : "IMMEDIATE");
