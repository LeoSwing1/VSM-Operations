import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { DemoPanel } from "./demo-panel";
import { AuthTests } from "./auth-tests";

export const metadata = { title: "Super Admin console" };

export default async function AdminConsole() {
  const ctx = await requirePerm("roles.manage");
  if (ctx.role !== "SUPER_ADMIN")
    return (
      <div className="rounded-2xl border border-line p-8">
        <h1 className="text-xl font-semibold">Super Admin access required</h1>
        <p className="mt-2 text-sm text-muted">This control centre is restricted to the organisation's Super Admin.</p>
      </div>
    );
  const sb = await supabaseServer();
  const [{ data: roles }, { data: grants }, { data: people }] = await Promise.all([
    sb.from("role_settings").select("role,label,level"),
    sb.from("role_permissions").select("role,permission"),
    sb.from("employee_directory").select("id,role"),
  ]);
  const [{ count: demoCount }, { data: teams }] = await Promise.all([
    sb.from("employees").select("id", { count: "exact", head: true }).eq("is_demo", true).neq("status", "EXITED"),
    sb
      .from("org_teams")
      .select("id, name, chat_channel_id, team_key, members:org_team_members(count)")
      .not("team_key", "is", null)
      .order("name"),
  ]);
  const roleRows = (roles ?? []).filter((r: any) => r.role !== "SUPER_ADMIN").sort((a: any, b: any) => b.level - a.level);
  const count = (role: string) => (people ?? []).filter((p: any) => p.role === role).length;
  return (
    <>
      <PageHeader eyebrow="Restricted control centre" title="Super Admin console">
        <Badge tone="green">Full authority</Badge>
        <Link href="/settings/access" className="btn-primary">
          Manage roles & permissions
        </Link>
      </PageHeader>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Central administration for organisation access, role governance and platform controls. Super Admin privileges are fixed and cannot
        be granted to another role through the matrix.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Authority", value: "Super Admin", hint: "Unrestricted organisation control" },
          { label: "Active directory", value: String(people?.length ?? 0), hint: "Employee records visible to this console" },
          { label: "Configurable roles", value: String(roleRows.length), hint: "Roles below Super Admin" },
          { label: "Role grants", value: String(grants?.length ?? 0), hint: "Configured permission assignments" },
        ].map((x) => (
          <section key={x.label} className="rounded-2xl border border-ink/70 bg-panel p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{x.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{x.value}</p>
            <p className="mt-1 text-xs text-muted">{x.hint}</p>
          </section>
        ))}
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <section className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Role directory</h2>
            <p className="mt-1 text-xs text-muted">Current role levels and assigned people</p>
          </div>
          <div className="divide-y divide-line">
            {roleRows.map((r: any) => (
              <div key={r.role} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="font-medium">{r.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">
                    {r.role} · Level {r.level}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{count(r.role)}</p>
                  <p className="text-[10px] text-muted">people</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Administration tools</h2>
          <div className="mt-4 space-y-2">
            {[
              ["Roles & Permissions", "Configure role access, hierarchy and individual overrides", "/settings/access"],
              ["Audit log", "Review recorded administrative and security events", "/settings/audit-logs"],
              ["Workflow automation", "Manage event-driven organisation workflows", "/settings/workflows"],
              ["Integrations", "Review connected services and integration health", "/settings/integrations"],
              ["Chat moderation", "Review reports and moderate workspace conversations", "/settings/chat-moderation"],
            ].map(([title, desc, href = "/settings/admin"]) => (
              <Link key={href} href={href} className="block rounded-xl border border-line p-3 transition hover:border-ink/60">
                <p className="text-sm font-semibold">
                  {title} <span className="float-right text-muted">↗</span>
                </p>
                <p className="mt-1 text-xs text-muted">{desc}</p>
              </Link>
            ))}
          </div>
          <p className="mt-4 rounded-xl bg-ink/[0.035] p-3 text-xs leading-5 text-muted">
            Security rule: permissions are enforced by server actions and database policies. Hiding a control in the interface does not
            grant or revoke access.
          </p>
        </section>
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <Card title="Demo team" hint="For testing every screen with realistic data. Safe to remove.">
          <DemoPanel count={demoCount ?? 0} />
        </Card>
        <div className="space-y-5">
          <Card title="Company teams" hint="Created from company posts. Members join the team chat group automatically.">
            <ul className="divide-y divide-line text-sm">
              {(teams ?? []).map((t: any) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span>{t.name}</span>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    {t.members?.[0]?.count ?? 0} members
                    {t.chat_channel_id && (
                      <Link href={`/chat/${t.chat_channel_id}`} className="text-volt hover:underline">
                        Open chat →
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/people/posts" className="mt-3 inline-block text-xs text-volt hover:underline">
              Company posts & workflow →
            </Link>
          </Card>
          <Card title="Login & password tests" hint="Check sign-in and reset email end-to-end without touching anyone else's account.">
            <AuthTests email={ctx.email} />
          </Card>
          <Card title="Super Admin protection">
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
              <li>This organisation has exactly one Super Admin. The role cannot be granted to anyone else from the app.</li>
              <li>
                Nobody — including admins, HR and the server&apos;s service key — can demote, deactivate, delete, relink or restrict the
                Super Admin, or reset their password.
              </li>
              <li>Recovery is only possible by the owner in the Supabase SQL Editor (break-glass), and is recorded in the audit log.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
