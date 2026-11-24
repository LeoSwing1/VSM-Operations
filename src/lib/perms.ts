/** Permission catalogue shown in /settings/roles. Enforcement lives in Postgres (has_perm + RLS). */
export const PERMISSION_GROUPS: { group: string; perms: [string, string][] }[] = [
  {
    group: "VSM Scholars",
    perms: [
      ["scholars.view", "View students, batches & certificates"],
      ["scholars.manage", "Counselling pipeline, enrolments, fee schedules"],
      ["scholars.teach", "Trainer: own batches & class attendance"],
      ["scholars.fees", "Confirm or waive student fees"],
      ["scholars.certify", "Issue & revoke certificates"],
      ["scholars.admin", "Courses, batches & trainers"],
    ],
  },
  {
    group: "People",
    perms: [
      ["people.view_all", "View all employees"],
      ["people.view_team", "View reporting team"],
      ["people.manage", "Create & edit employees"],
      ["people.onboard", "Add executives, employees and interns (HR post)"],
      ["people.add_team", "Add executives and interns to their own team (managers)"],
      ["kyc.verify", "See and verify KYC documents"],
      ["people.reset_password", "Reset employee passwords"],
      ["recruit.view", "View recruitment pipeline"],
      ["recruit.manage", "Manage candidates & interviews"],
    ],
  },
  {
    group: "Attendance & leave",
    perms: [
      ["attendance.view_all", "View all attendance"],
      ["attendance.view_team", "View team attendance"],
      ["attendance.approve", "Approve team corrections"],
      ["attendance.manage", "Manage shifts, holidays, any correction"],
      ["leave.view_all", "View all leave"],
      ["leave.approve", "Approve team leave"],
      ["leave.manage", "Manage leave types, any leave"],
    ],
  },
  {
    group: "Workforce collaboration",
    perms: [
      ["teams.view_all", "View organisation teams"],
      ["teams.manage", "Create and manage teams"],
      ["teams.manage_team", "Manage assigned teams"],
      ["teams.create_group", "Create working groups"],
      ["time.view_all", "View all timesheets"],
      ["time.view_team", "View team timesheets"],
      ["time.approve_all", "Approve any timesheet"],
      ["time.approve_team", "Approve team timesheets"],
      ["quality.view_all", "View all quality assessments"],
      ["quality.view_team", "View team quality"],
      ["quality.review", "Assess work quality"],
      ["quality.manage", "Manage quality checklists"],
      ["calendar.create", "Create calendar events and meetings"],
      ["calendar.manage", "Manage organisation calendar"],
    ],
  },
  {
    group: "Work",
    perms: [
      ["tasks.view_all", "View all tasks"],
      ["tasks.view_team", "View team tasks"],
      ["tasks.manage", "Assign tasks to others"],
      ["tasks.review", "Review & score task quality"],
      ["projects.view_all", "View all projects"],
      ["projects.manage", "Create & manage projects"],
      ["projects.workspace_view", "Open assigned project workspaces"],
      ["projects.time_log", "Submit project time entries"],
      ["projects.time_approve", "Approve project time entries"],
      ["projects.updates", "Post project updates"],
    ],
  },
  {
    group: "Communication",
    perms: [
      ["communication.view", "View company communication"],
      ["communication.send", "Send messages and create groups"],
      ["communication.manage", "Manage company channels and announcements"],
      ["communication.channel_manage", "Manage channel membership and archive channels"],
      ["communication.moderate", "Review reports and moderate messages"],
    ],
  },
  {
    group: "CRM & clients",
    perms: [
      ["crm.view_all", "View all leads"],
      ["crm.manage", "Work assigned/unassigned leads"],
      ["crm.assign", "Assign leads"],
      ["clients.view_all", "View all clients"],
      ["clients.manage", "Manage clients"],
    ],
  },
  {
    group: "Performance",
    perms: [
      ["performance.view_all", "View all performance"],
      ["performance.view_team", "View team performance"],
      ["performance.review", "Review, adjust, approve team snapshots"],
      ["performance.configure", "Configure scoring policies"],
      ["okr.manage", "Create company OKRs, edit any OKR"],
      ["kpi.manage", "Define KPIs, enter and verify anyone's KPIs"],
      ["reviews.manage", "Run 360° review cycles (sees reviewer names)"],
      ["training.manage", "Manage and verify everyone's training"],
    ],
  },
  {
    group: "Finance — sensitive",
    perms: [
      ["finance.view", "View finance registers & reports"],
      ["finance.manage", "Manage vendors, invoices, budgets & statements"],
      ["finance.approve_manager", "Approve team expense claims"],
      ["finance.approve_all", "Approve any manager-stage expense claim"],
      ["finance.approve", "Final finance approval"],
      ["finance.pay", "Record vendor and expense payments"],
      ["finance.export", "Export finance reports"],
    ],
  },
  {
    group: "Payroll — sensitive",
    perms: [
      ["payroll.view_all", "View all salaries & payroll"],
      ["salary.manage", "Edit salary structures & incentive policies"],
      ["payroll.manage", "Prepare payroll runs"],
      ["payroll.approve", "Approve payroll runs"],
      ["payroll.pay", "Record payments"],
      ["payroll.export", "Export payroll"],
    ],
  },
  {
    group: "Administration",
    perms: [
      ["executive.view", "Executive organisation overview"],
      ["reports.view_org", "Organisation reports"],
      ["reports.schedule", "Schedule emailed reports (for reports they can see)"],
      ["ai.use", "Use the AI assistant (sees only what they can see)"],
      ["settings.manage", "Organisation settings"],
      ["roles.manage", "Manage roles & permissions"],
      ["audit.view", "View audit log"],
    ],
  },
];
export const ALL_PERMS = PERMISSION_GROUPS.flatMap((g) => g.perms.map(([p]) => p));
/** Mirrors is_sensitive_permission() in the latest migration — only Super Admin can delegate sensitive grants. */
export const isSensitive = (p: string) =>
  p.startsWith("payroll.") ||
  p === "people.reset_password" ||
  p.startsWith("salary.") ||
  p.startsWith("finance.") ||
  p.startsWith("kyc.") ||
  [
    "roles.manage",
    "audit.view",
    "settings.manage",
    "communication.moderate",
    "communication.channel_manage",
    "teams.manage",
    "time.approve_all",
    "quality.manage",
    "calendar.manage",
  ].includes(p);
export const SENSITIVE = new Set(ALL_PERMS.filter(isSensitive));
export const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms));
