import { RegisterSW } from "./register-sw";
import { Suspense } from "react";
import { ProfileMenu } from "./profile-menu";
import { ProgressBar } from "./progress-bar";
import { initialsOf, shortName, subtitleFor } from "@/lib/display-name";
import { ShellClock } from "./shell-clock";
import { EnableNotifications } from "./notifications/enable-notifications";
import type { AttendanceEvent } from "@/lib/engines/attendance";
import Link from "next/link";
import { can, canAny, ROLE_LABEL, type Ctx } from "@/lib/auth";
import { NavLinks, ThemeToggle, MobileMenu } from "./shell-client";

export interface NavItem {
  href: string;
  label: string;
  group: string;
}

export function navFor(ctx: Ctx): NavItem[] {
  const items: (NavItem & { show: boolean })[] = [
    { href: "/dashboard", label: "Dashboard", group: "Work", show: true },
    { href: "/attendance", label: "Attendance & clocking", group: "Work", show: true },
    { href: "/time", label: "Timesheets", group: "Work", show: true },
    { href: "/quality", label: "Quality", group: "Delivery", show: true },
    { href: "/teams", label: "Teams & groups", group: "Organisation", show: true },
    { href: "/calendar", label: "Calendar & schedules", group: "Work", show: true },
    { href: "/meetings", label: "Meetings", group: "Work", show: true },
    { href: "/tasks", label: "Tasks", group: "Work", show: true },
    {
      href: "/projects",
      label: "Projects & delivery",
      group: "Delivery",
      show: canAny(ctx, ["projects.workspace_view", "projects.view_all", "projects.manage", "projects.time_log"]),
    },
    { href: "/projects/time", label: "Time approvals", group: "Delivery", show: canAny(ctx, ["projects.time_approve", "projects.manage"]) },
    { href: "/chat", label: "Team chat", group: "Communication", show: canAny(ctx, ["communication.view", "communication.send"]) },
    {
      href: "/announcements",
      label: "Announcements",
      group: "Communication",
      show: canAny(ctx, ["communication.view", "communication.manage"]),
    },
    { href: "/daily-updates", label: "Daily updates", group: "Work", show: true },
    { href: "/leave", label: "Leave", group: "Work", show: true },
    {
      href: "/approvals",
      label: "Approvals",
      group: "Work",
      show: canAny(ctx, ["attendance.approve", "leave.approve", "tasks.review", "attendance.manage", "leave.manage"]),
    },
    { href: "/notifications", label: "Notifications", group: "Work", show: true },
    { href: "/analytics/my-performance", label: "My performance", group: "Me", show: true },
    { href: "/payroll/my-salary", label: "My salary", group: "Me", show: true },
    { href: "/finance/expenses", label: "My expenses", group: "Me", show: true },
    { href: "/people", label: "People", group: "Organisation", show: canAny(ctx, ["people.view_all", "people.view_team"]) },
    { href: "/recruitment", label: "Recruitment", group: "Organisation", show: canAny(ctx, ["recruit.view", "recruit.manage"]) },
    {
      href: "/performance",
      label: "Performance",
      group: "Organisation",
      show: canAny(ctx, ["performance.view_all", "performance.view_team", "performance.configure"]),
    },
    { href: "/leads", label: "CRM · Leads", group: "Organisation", show: canAny(ctx, ["crm.view_all", "crm.manage"]) },
    { href: "/payroll", label: "Payroll", group: "Organisation", show: canAny(ctx, ["payroll.view_all", "payroll.approve"]) },
    {
      href: "/finance",
      label: "Finance ERP",
      group: "Organisation",
      show: canAny(ctx, [
        "finance.view",
        "finance.manage",
        "finance.approve",
        "finance.approve_manager",
        "finance.approve_all",
        "finance.pay",
      ]),
    },
    { href: "/finance/reports", label: "Finance reports", group: "Organisation", show: canAny(ctx, ["finance.view", "finance.manage"]) },
    { href: "/scholars", label: "VSM Scholars", group: "Organisation", show: canAny(ctx, ["scholars.view", "scholars.teach"]) },
    {
      href: "/operations",
      label: "Operations Center",
      group: "Organisation",
      show: canAny(ctx, ["settings.manage", "attendance.manage", "attendance.approve", "people.view_all", "people.view_team"]),
    },
    { href: "/executive", label: "Executive overview", group: "Organisation", show: can(ctx, "executive.view") },
    { href: "/settings/access", label: "Access control", group: "Admin", show: can(ctx, "roles.manage") },
    { href: "/settings/admin", label: "Super Admin console", group: "Admin", show: ctx.role === "SUPER_ADMIN" },
    { href: "/settings/chat-moderation", label: "Chat moderation", group: "Admin", show: can(ctx, "communication.moderate") },
    { href: "/settings/integrations", label: "Integrations", group: "Admin", show: can(ctx, "settings.manage") },
    { href: "/settings/workflows", label: "Workflow automation", group: "Admin", show: can(ctx, "settings.manage") },
    { href: "/settings/attendance", label: "Shifts & holidays", group: "Admin", show: can(ctx, "attendance.manage") },
    { href: "/settings/audit-logs", label: "Audit log", group: "Admin", show: can(ctx, "audit.view") },
  ];
  return items.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}

export function Shell({ ctx, unread, today, children }: { ctx: Ctx; unread: number; today: AttendanceEvent[]; children: React.ReactNode }) {
  const nav = navFor(ctx);
  const initials = ctx.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" className="mb-8 block px-2">
        <span className="display text-3xl">
          VSM<span className="text-volt">.</span>
        </span>
        <span className="eyebrow mt-1 block">Growth Operations</span>
      </Link>
      <ShellClock events={today} employeeId={ctx.employee_id} />
      <NavLinks items={nav} unread={unread} employeeId={ctx.employee_id} />
      <div className="mt-auto space-y-3 border-t border-line pt-4">
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-volt text-xs font-bold text-[#0b0b0c]">{initials}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ctx.full_name}</p>
            <p className="truncate text-xs text-muted">{subtitleFor(ctx.role, ctx.designation, ROLE_LABEL[ctx.role])}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-2">
          <ThemeToggle />
          <form action="/auth/signout" method="post" className="ml-auto">
            <button className="text-xs text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
  return (
    <div className="lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen overflow-y-auto border-r border-line p-5 lg:block">{sidebar}</aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="display text-2xl">
          VSM<span className="text-volt">.</span>
        </Link>
        <MobileMenu>{sidebar}</MobileMenu>
      </div>
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-6 sm:px-8 lg:py-8">
        <Suspense fallback={null}>
          <ProgressBar />
        </Suspense>
        <div className="no-print mb-6 flex items-center justify-end gap-3">
          <ProfileMenu
            id={ctx.employee_id}
            name={ctx.full_name}
            short={shortName(ctx.full_name)}
            subtitle={subtitleFor(ctx.role, ctx.designation, ROLE_LABEL[ctx.role])}
            initials={initialsOf(ctx.full_name)}
            photo={ctx.photo_url}
            email={ctx.email}
            links={[
              { href: `/people/${ctx.employee_id}`, label: "My profile" },
              { href: `/people/${ctx.employee_id}?tab=activity`, label: "My activity" },
              { href: "/attendance", label: "My attendance" },
              { href: "/notifications/preferences", label: "Notification settings" },
              { href: "/login/reset", label: "Change password" },
              ...(ctx.role === "SUPER_ADMIN" ? [{ href: "/settings/admin", label: "Super Admin console" }] : []),
              ...(can(ctx, "roles.manage") ? [{ href: "/settings/access", label: "Roles & permissions" }] : []),
            ]}
          />
        </div>
        <RegisterSW />
        <EnableNotifications vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
        {children}
      </main>
    </div>
  );
}
