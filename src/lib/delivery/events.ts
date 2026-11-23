/** Organisation events that can be routed to Slack, Teams and outbound webhooks. Mirrors org_event_keys() in SQL. */
export const ORG_EVENTS = [
  "lead.created",
  "lead.won",
  "employee.joined",
  "leave.approved",
  "payroll.approved",
  "announcement.published",
  "task.completed",
  "integration.failing",
] as const;
export type OrgEvent = (typeof ORG_EVENTS)[number];
