export const metadata = { title: "Settings Hub" };

"use client";
import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
import { useState } from "react";

const navItems = [
  { label: "Organization", href: "/settings/organization", description: "Company structure and branches", icon: "building" },
  { label: "Departments", href: "/settings/departments", description: "Department management", icon: "grid" },
  { label: "Users", href: "/settings/users", description: "Team members and roles", icon: "users" },
  { label: "Roles & Permissions", href: "/settings/access", description: "Access control matrix", icon: "lock" },
  { label: "Notifications", href: "/settings/notifications", description: "Email and push preferences", icon: "bell" },
  { label: "Integrations", href: "/settings/integrations", description: "Connected services", icon: "link" },
  { label: "Audit Logs", href: "/settings/audit-logs", description: "Activity and change history", icon: "history" },
  { label: "Performance", href: "/settings/performance", description: "Employee performance metrics", icon: "trending-up" },
  { label: "Payroll", href: "/payroll", description: "Salary and compensation", icon: "dollar-sign" },
  { label: "Attendance", href: "/attendance", description: "Attendance and time tracking", icon: "calendar" },
  { label: "Daily Updates", href: "/daily-updates", description: "Daily standups and reports", icon: "message-circle" },
];

export default function SettingsHub({ searchParams }: { searchParams: any }) {
  const [active, setActive] = useState("/settings/notifications");

  useEffect(() => {
    setActive(searchParams?.page || "/settings/notifications");
  }, [searchParams]);

  return (
    <>
      <PageHeader title="Settings Hub" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {navItems.map((item) => (
          <Card key={item.label} className="h-full flex flex-col">
            <div className="p-4 flex flex-col">
              <Link
                href={item.href}
                className="flex flex-col h-full text-left hover:text-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
              >
                <div className="mt-2 text-2xl mb-1">{item.icon}</div>
                <h3 className="font-medium mb-2 line-clamp-2">{item.label}</h3>
                <p className="text-xs text-muted/60 line-clamp-1">{item.description}</p>
              </Link>
            </div>
          </Card>
        ))}
      </div>

      {active && active !== "/settings/notifications" && (
        <div className="mt-8">
          <p className="text-muted text-sm">
            Select a setting from the grid above to configure
          </p>
        </div>
      )}
    </>
  );
}