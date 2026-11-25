/** Plain-English labels for audit events (migration 0043 logs every table as "<table>.<created|updated|deleted>"). */

export type Area = { key: string; label: string; entities: string[]; prefixes: string[] };

export const AREAS: Area[] = [
  { key: "auth", label: "Sign-ins", entities: [], prefixes: ["auth."] },
  {
    key: "people",
    label: "People & access",
    entities: [
      "employees",
      "employee",
      "employee_documents",
      "employee_letters",
      "employee_permission_overrides",
      "role_permissions",
      "role_settings",
      "designations",
      "departments",
      "org_teams",
      "org_team_members",
      "employment_events",
      "onboarding_checklist_items",
      "probation_reviews",
      "exit_clearance_items",
      "kyc_profiles",
      "kyc_documents",
      "work_groups",
      "work_group_members",
    ],
    prefixes: ["employee.", "permission.", "role.", "kyc.", "people.", "owner."],
  },
  {
    key: "attendance",
    label: "Attendance & leave",
    entities: [
      "attendance_events",
      "attendance_corrections",
      "attendance_settings",
      "leave_requests",
      "leave_types",
      "holidays",
      "shifts",
      "schedule_assignments",
      "office_locations",
    ],
    prefixes: ["attendance.", "leave."],
  },
  {
    key: "tasks",
    label: "Tasks & projects",
    entities: [
      "tasks",
      "task_events",
      "task_time_entries",
      "projects",
      "project_milestones",
      "project_updates",
      "project_time_entries",
      "daily_updates",
    ],
    prefixes: ["task.", "project."],
  },
  {
    key: "chat",
    label: "Chat",
    entities: [
      "chat_channels",
      "chat_messages",
      "chat_attachments",
      "chat_reactions",
      "chat_message_reports",
      "chat_moderation_events",
      "company_announcements",
      "meeting_notes",
    ],
    prefixes: ["chat.", "moderation."],
  },
  { key: "crm", label: "CRM & clients", entities: ["leads", "lead_activities", "clients"], prefixes: ["lead.", "client.", "crm."] },
  {
    key: "payroll",
    label: "Payroll & salary",
    entities: [
      "payroll_runs",
      "payroll_entries",
      "payroll_adjustments",
      "payroll_statutory_settings",
      "salary_structures",
      "employee_statutory",
      "incentive_policies",
    ],
    prefixes: ["payroll.", "salary.", "salary_structure."],
  },
  {
    key: "finance",
    label: "Finance",
    entities: [
      "client_invoices",
      "invoice_lines",
      "invoice_payments",
      "finance_expenses",
      "vendors",
      "vendor_payments",
      "department_budgets",
      "bank_reconciliations",
      "bank_statement_lines",
    ],
    prefixes: ["finance.", "invoice."],
  },
  {
    key: "performance",
    label: "Performance & growth",
    entities: [
      "manager_reviews",
      "manager_review_notes",
      "performance_policies",
      "performance_review_requests",
      "quality_assessments",
      "quality_checklists",
      "quality_evidence",
      "score_adjustments",
      "review_cycles",
      "review_assignments",
      "okr_objectives",
      "okr_key_results",
      "okr_checkins",
      "kpi_definitions",
      "training_records",
    ],
    prefixes: ["performance.", "quality.", "okr.", "review."],
  },
  {
    key: "assets",
    label: "Assets",
    entities: ["assets", "asset_assignments", "asset_financials", "asset_maintenance"],
    prefixes: ["asset."],
  },
  { key: "recruitment", label: "Recruitment", entities: ["candidates", "candidate_interviews"], prefixes: ["candidate."] },
  {
    key: "scholars",
    label: "VSM Scholars",
    entities: [
      "scholar_batches",
      "scholar_certificates",
      "scholar_courses",
      "scholar_enrollments",
      "scholar_fee_payments",
      "scholar_referral_rewards",
      "scholar_session_attendance",
      "scholar_sessions",
      "scholar_students",
    ],
    prefixes: ["scholar."],
  },
  {
    key: "integrations",
    label: "Integrations, email & automation",
    entities: [
      "email_outbox",
      "delivery_outbox",
      "calendar_events",
      "calendar_attendees",
      "calendar_email_deliveries",
      "calendar_provider_connections",
      "calendar_sync_links",
      "google_drive_files",
      "google_workspace_settings",
      "inbound_webhook_events",
      "integration_check_runs",
      "integration_settings",
      "webhook_endpoints",
      "whatsapp_optins",
      "workflow_rules",
      "workflow_runs",
      "workflow_approval_cases",
      "report_runs",
      "report_schedules",
      "ai_settings",
      "notification_preferences",
    ],
    prefixes: ["integration.", "webhook.", "workflow.", "report.", "ai.", "assets.export", "calendar."],
  },
];

const OP: Record<string, string> = {
  created: "added",
  updated: "changed",
  deleted: "removed",
  insert: "added",
  update: "changed",
  delete: "removed",
};

const SPECIAL: Record<string, string> = {
  "auth.sign_in": "signed in",
  "auth.sign_out": "signed out",
  "auth.sign_in_failed": "failed sign-in attempt",
  "chat_messages.created": "sent a chat message",
  "chat_reactions.created": "reacted to a message",
  "chat_message_reports.created": "reported a chat message",
  "attendance_events.created": "recorded attendance",
  "email_outbox.created": "queued an email",
  "email_outbox.updated": "email delivery update",
  "delivery_outbox.created": "queued a message",
  "delivery_outbox.updated": "message delivery update",
  "asset.issued": "issued an asset",
  "asset.returned": "took back an asset",
  "asset.acknowledged": "confirmed receiving an asset",
};

/** "leave_requests" → "leave request" */
export function entityLabel(entity: string): string {
  const s = entity.replace(/_/g, " ").trim();
  if (/ies$/.test(s)) return s.replace(/ies$/, "y");
  if (/(ss|us)$/.test(s)) return s;
  return s.replace(/s$/, "");
}

export function areaOf(action: string, entity: string): Area | undefined {
  return AREAS.find((a) => a.entities.includes(entity) || a.prefixes.some((p) => action.startsWith(p)));
}

export function describeEvent(action: string, entity: string, meta: Record<string, unknown> | null | undefined): string {
  const m = meta ?? {};
  let text = SPECIAL[action];
  if (!text) {
    const dot = action.lastIndexOf(".");
    const verb = dot > 0 ? OP[action.slice(dot + 1)] : undefined;
    text = verb ? `${verb} ${entityLabel(dot > 0 ? action.slice(0, dot).split(".").pop()! : entity)}` : action.replace(/[._]/g, " ");
  }
  const name = [m.title, m.name, m.full_name, m.asset_tag].find((v) => typeof v === "string" && v) as string | undefined;
  if (name) text += `: ${name}`;
  const bits: string[] = [];
  if (typeof m.status === "string") bits.push(`status ${m.status.toLowerCase().replace(/_/g, " ")}`);
  if (typeof m.role === "string") bits.push(`role ${m.role.toLowerCase().replace(/_/g, " ")}`);
  if (typeof m.template === "string") bits.push(String(m.template));
  if (Array.isArray(m.changed) && m.changed.length)
    bits.push(`fields: ${m.changed.slice(0, 6).join(", ")}${m.changed.length > 6 ? "…" : ""}`);
  return bits.length ? `${text} (${bits.join(" · ")})` : text;
}

export function sourceLabel(meta: Record<string, unknown> | null | undefined, hasActor: boolean): "Person" | "Integration" | "System" {
  const s = meta?.source;
  if (s === "integration") return "Integration";
  if (s === "system" && !hasActor) return "System";
  return hasActor ? "Person" : "System";
}

/** PostgREST .or() filter for an area. */
export function areaFilter(a: Area): string {
  const parts: string[] = [];
  if (a.entities.length) parts.push(`entity.in.(${a.entities.join(",")})`);
  for (const p of a.prefixes) parts.push(`action.like.${p.replace(/[,()]/g, "")}*`);
  return parts.join(",");
}
