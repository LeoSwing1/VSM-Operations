import Link from "next/link";
import { can, canAny, ROLE_LABEL, type Ctx } from "@/lib/auth";
import { NavLinks, ThemeToggle, MobileMenu } from "./shell-client";

export interface NavItem { href: string; label: string; group: string }

export function navFor(ctx: Ctx): NavItem[] {
  const items: (NavItem & { show: boolean })[] = [
    { href: "/dashboard", label: "Dashboard", group: "Work", show: true },
    { href: "/attendance", label: "Attendance", group: "Work", show: true },
    { href: "/tasks", label: "Tasks", group: "Work", show: true },
    { href: "/daily-updates", label: "Daily updates", group: "Work", show: true },
    { href: "/leave", label: "Leave", group: "Work", show: true },
    { href: "/approvals", label: "Approvals", group: "Work", show: canAny(ctx, ["attendance.approve", "leave.approve", "tasks.review", "attendance.manage", "leave.manage"]) },
    { href: "/notifications", label: "Notifications", group: "Work", show: true },
    { href: "/analytics/my-performance", label: "My performance", group: "Me", show: true },
    { href: "/payroll/my-salary", label: "My salary", group: "Me", show: true },
    { href: "/people", label: "People", group: "Organisation", show: canAny(ctx, ["people.view_all", "people.view_team"]) },
    { href: "/performance", label: "Performance", group: "Organisation", show: canAny(ctx, ["performance.view_all", "performance.view_team", "performance.configure"]) },
    { href: "/leads", label: "CRM · Leads", group: "Organisation", show: canAny(ctx, ["crm.view_all", "crm.manage"]) },
    { href: "/payroll", label: "Payroll", group: "Organisation", show: canAny(ctx, ["payroll.view_all", "payroll.approve"]) },
    { href: "/settings/access", label: "Access control", group: "Admin", show: can(ctx, "roles.manage") },
    { href: "/settings/audit-logs", label: "Audit log", group: "Admin", show: can(ctx, "audit.view") },
  ];
  return items.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}

export function Shell({ ctx, unread, children }: { ctx: Ctx; unread: number; children: React.ReactNode }) {
  const nav = navFor(ctx);
  const initials = ctx.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" className="mb-8 block px-2">
        <span className="display text-3xl">VSM<span className="text-volt">.</span></span>
        <span className="eyebrow mt-1 block">Growth Operations</span>
      </Link>
      <NavLinks items={nav} unread={unread} />
      <div className="mt-auto space-y-3 border-t border-line pt-4">
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-volt text-xs font-bold text-[#0b0b0c]">{initials}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ctx.full_name}</p>
            <p className="truncate text-xs text-muted">{ROLE_LABEL[ctx.role]}</p>
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
        <Link href="/dashboard" className="display text-2xl">VSM<span className="text-volt">.</span></Link>
        <MobileMenu>{sidebar}</MobileMenu>
      </div>
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-8 sm:px-8 lg:py-12">{children}</main>
    </div>
  );
}
