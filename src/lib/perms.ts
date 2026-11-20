/** Permission catalogue shown in /settings/roles. Enforcement lives in Postgres (has_perm + RLS). */
export const PERMISSION_GROUPS: { group: string; perms: [string, string][] }[] = [
  { group: "People", perms: [["people.view_all", "View all employees"], ["people.view_team", "View reporting team"], ["people.manage", "Create & edit employees"]] },
  { group: "Attendance & leave", perms: [["attendance.view_all", "View all attendance"], ["attendance.view_team", "View team attendance"], ["attendance.approve", "Approve team corrections"],
    ["attendance.manage", "Manage shifts, holidays, any correction"], ["leave.view_all", "View all leave"], ["leave.approve", "Approve team leave"], ["leave.manage", "Manage leave types, any leave"]] },
  { group: "Work", perms: [["tasks.view_all", "View all tasks"], ["tasks.view_team", "View team tasks"], ["tasks.manage", "Assign tasks to others"], ["tasks.review", "Review & score task quality"],
    ["projects.view_all", "View all projects"], ["projects.manage", "Create & manage projects"]] },
  { group: "CRM & clients", perms: [["crm.view_all", "View all leads"], ["crm.manage", "Work assigned/unassigned leads"], ["crm.assign", "Assign leads"], ["clients.view_all", "View all clients"], ["clients.manage", "Manage clients"]] },
  { group: "Performance", perms: [["performance.view_all", "View all performance"], ["performance.view_team", "View team performance"], ["performance.review", "Review, adjust, approve team snapshots"], ["performance.configure", "Configure scoring policies"]] },
  { group: "Payroll — sensitive", perms: [["payroll.view_all", "View all salaries & payroll"], ["salary.manage", "Edit salary structures & incentive policies"], ["payroll.manage", "Prepare payroll runs"],
    ["payroll.approve", "Approve payroll runs"], ["payroll.pay", "Record payments"], ["payroll.export", "Export payroll"]] },
  { group: "Administration", perms: [["reports.view_org", "Organisation reports"], ["settings.manage", "Organisation settings"], ["roles.manage", "Manage roles & permissions"], ["audit.view", "View audit log"]] },
];
export const ALL_PERMS = PERMISSION_GROUPS.flatMap((g) => g.perms.map(([p]) => p));
/** Mirrors is_sensitive_permission() in 0006 — only Super Admin can grant these. */
export const isSensitive = (p: string) => p.startsWith("payroll.") || p.startsWith("salary.") || ["roles.manage", "audit.view", "settings.manage"].includes(p);
export const SENSITIVE = new Set(ALL_PERMS.filter(isSensitive));
export const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms));
