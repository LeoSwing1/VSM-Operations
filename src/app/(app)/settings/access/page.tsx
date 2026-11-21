import Link from "next/link";
import { requirePerm, ROLES, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, Tabs } from "@/components/ui";
import { ALL_PERMS, PERMISSION_GROUPS, PERM_LABEL, isSensitive } from "@/lib/perms";
import { fmtDateTime } from "@/lib/engines/time";
import { addOverride, removeOverride, saveMatrix, saveRoleSetting } from "./actions";
import clsx from "clsx";

export const metadata = { title: "Access control" };

interface RoleRow { role: Role; level: number; label: string; description: string | null }
interface Emp { id: string; full_name: string; designation: string | null; role: Role; manager_id: string | null; department_name: string | null }

export default async function Access({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("roles.manage");
  const sb = await supabaseServer();
  const sa = ctx.role === "SUPER_ADMIN";
  const [{ data: rs }, { data: rp }, { data: dir }, { data: mine }] = await Promise.all([
    sb.from("role_settings").select("role, level, label, description"),
    sb.from("role_permissions").select("role, permission"),
    sb.from("employee_directory").select("id, full_name, designation, role, manager_id, department_name").order("full_name"),
    sb.rpc("effective_permissions", { p_employee: ctx.employee_id }),
  ]);
  const roles = ((rs ?? []) as RoleRow[]).sort((a, b) => b.level - a.level || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  const level = (r: Role) => roles.find((x) => x.role === r)?.level ?? 0;
  const label = (r: Role) => roles.find((x) => x.role === r)?.label ?? r;
  const myPerms = new Set(sa ? ALL_PERMS : ((mine ?? []) as { permission: string }[]).map((m) => m.permission));
  const granted = new Set((rp ?? []).map((x) => `${x.role}|${x.permission}`));
  const people = (dir ?? []) as Emp[];
  const countIn = (r: Role) => people.filter((p) => p.role === r).length;

  /** Mirrors the database rule so the UI only offers what will succeed (the DB still decides). */
  const canEdit = (r: Role, p: string) => r !== "SUPER_ADMIN" && (sa || (level(r) < ctx.role_level && myPerms.has(p) && !isSensitive(p)));

  const tabs = [
    { key: "matrix", label: "Permission matrix" }, { key: "hierarchy", label: "Hierarchy" },
    { key: "people", label: "People & overrides" }, { key: "who", label: "Who has access" },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "matrix";

  return (
    <>
      <PageHeader eyebrow={sa ? "Super Admin · full control" : `Your level ${ctx.role_level} · you manage roles below you`} title="Access control">{ctx.permissions.includes("communication.moderate")||ctx.permissions.includes("*")?<Link href="/settings/chat-moderation" className="btn-ghost">Chat moderation</Link>:null}</PageHeader>
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base="/settings/access" />

      {tab === "matrix" && (
        <>
          <p className="mb-4 max-w-3xl text-sm text-muted">
            One place for every permission and every role. Roles are ordered by rank. {sa
              ? "As Super Admin you can assign any permission to any role. Super Admin itself always has everything."
              : "You can only change roles below your level, only grant permissions you hold yourself, and sensitive permissions (payroll, salary, roles, audit, settings) are Super-Admin-only."}
            {" "}Everyone always sees their own attendance, tasks, performance and salary — that needs no permission.
          </p>
          <form action={saveMatrix}>
            <input type="hidden" name="editable" value={roles.flatMap((r) => ALL_PERMS.filter((p) => canEdit(r.role, p)).map((p) => `${r.role}|${p}`)).join(",")} />
            <div className="card overflow-hidden">
              <div className="max-h-[70vh] overflow-auto">
                <table className="table min-w-[1100px]">
                  <thead className="sticky top-0 z-10 bg-panel">
                    <tr>
                      <th className="sticky left-0 z-20 min-w-[260px] bg-panel">Permission</th>
                      {roles.map((r) => (
                        <th key={r.role} className="text-center normal-case tracking-normal">
                          <span className="block text-[11px] font-semibold text-ink">{r.label}</span>
                          <span className="block text-[10px] text-muted">L{r.level} · {countIn(r.role)} ppl</span>
                        </th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_GROUPS.map((g) => (
                      <GroupRows key={g.group} group={g} roles={roles} granted={granted} canEdit={canEdit} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary shadow-lg">Save all changes</button>
              <span className="rounded-full bg-paper/90 px-3 py-1 text-xs text-muted">Greyed cells are outside your authority.</span>
            </div>
          </form>
        </>
      )}

      {tab === "hierarchy" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Role ladder — higher can manage lower, never the other way">
            <ol className="space-y-3">
              {roles.map((r) => (
                <li key={r.role} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="display w-12 text-3xl tabular-nums text-volt">{r.level}</span>
                      <div><p className="font-semibold">{r.label}</p><p className="font-mono text-[10px] text-muted">{r.role}</p></div>
                    </div>
                    <span className="text-xs text-muted">{countIn(r.role)} people · {r.role === "SUPER_ADMIN" ? "all" : (rp ?? []).filter((x) => x.role === r.role).length} permissions</span>
                  </div>
                  {r.description && <p className="mt-2 text-sm text-muted">{r.description}</p>}
                  {sa && (
                    <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">Edit</summary>
                      <form action={saveRoleSetting} className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px]">
                        <input type="hidden" name="role" value={r.role} />
                        <Field label="Display name"><input name="label" defaultValue={r.label} className="input" /></Field>
                        <Field label="Level"><input name="level" type="number" min={1} max={99} defaultValue={r.level} disabled={r.role === "SUPER_ADMIN"} className="input" /></Field>
                        <Field label="What this role is for" className="sm:col-span-2"><input name="description" defaultValue={r.description ?? ""} className="input" /></Field>
                        <div><button className="btn-ghost">Save</button></div>
                      </form>
                    </details>)}
                </li>))}
            </ol>
          </Card>
          <Card title="Reporting structure">
            {!people.length ? <Empty title="No one yet" /> : <Tree people={people} label={label} />}
            <p className="mt-4 text-xs text-muted">Managers see and approve for everyone below them in this tree (attendance, leave, tasks, performance). Salary is never visible through the tree — only via payroll permissions.</p>
          </Card>
        </div>
      )}

      {tab === "people" && <PeopleTab sb={sb} sp={sp} people={people} label={label} sa={sa} selfId={ctx.employee_id} tz={ctx.timezone} />}
      {tab === "who" && <WhoTab sb={sb} sp={sp} label={label} />}
    </>
  );
}

function GroupRows({ group, roles, granted, canEdit }: { group: (typeof PERMISSION_GROUPS)[number]; roles: RoleRow[]; granted: Set<string>; canEdit: (r: Role, p: string) => boolean }) {
  return (
    <>
      <tr><td colSpan={roles.length + 1} className="sticky left-0 bg-ink/[0.03] text-[11px] font-semibold uppercase tracking-wider text-muted">{group.group}</td></tr>
      {group.perms.map(([p, l]) => (
        <tr key={p}>
          <td className="sticky left-0 bg-panel">
            <span className="text-sm">{l}</span>{isSensitive(p) && <span className="ml-2 text-[10px] text-ember">sensitive</span>}
            <span className="block font-mono text-[10px] text-muted">{p}</span>
          </td>
          {roles.map((r) => {
            const cell = `${r.role}|${p}`;
            const on = r.role === "SUPER_ADMIN" || granted.has(cell);
            const edit = canEdit(r.role, p);
            return (
              <td key={cell} className={clsx("text-center", !edit && "opacity-40")}>
                <input type="checkbox" name={cell} defaultChecked={on} disabled={!edit} aria-label={`${r.label}: ${l}`} className="h-4 w-4 accent-[#D7FF3A]" />
              </td>);
          })}
        </tr>))}
    </>
  );
}

function Tree({ people, label }: { people: Emp[]; label: (r: Role) => string }) {
  const ids = new Set(people.map((p) => p.id));
  const kids = (id: string | null) => people.filter((p) => (id === null ? !p.manager_id || !ids.has(p.manager_id) : p.manager_id === id));
  const Node = ({ p, depth }: { p: Emp; depth: number }) => (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <Link href={`/people/${p.id}`} className="font-semibold hover:text-volt">{p.full_name}</Link>
        <span className="chip border-line normal-case tracking-normal">{label(p.role)}</span>
        <span className="text-xs text-muted">{p.designation ?? ""}{p.department_name ? ` · ${p.department_name}` : ""}</span>
      </div>
      {depth < 12 && kids(p.id).length > 0 && <ul className="ml-3 border-l border-line pl-4">{kids(p.id).map((k) => <Node key={k.id} p={k} depth={depth + 1} />)}</ul>}
    </li>
  );
  return <ul>{kids(null).map((p) => <Node key={p.id} p={p} depth={0} />)}</ul>;
}

type SB = Awaited<ReturnType<typeof supabaseServer>>;

async function PeopleTab({ sb, sp, people, label, sa, selfId, tz }: { sb: SB; sp: Record<string, string | undefined>; people: Emp[]; label: (r: Role) => string; sa: boolean; selfId: string; tz: string }) {
  const emp = people.find((p) => p.id === sp.employee) ?? null;
  const [{ data: eff, error }, { data: ov }, { data: log }] = await Promise.all([
    emp ? sb.rpc("effective_permissions", { p_employee: emp.id }) : Promise.resolve({ data: null, error: null }),
    emp ? sb.from("employee_permission_overrides").select("id, permission, effect, reason, expires_at, created_at").eq("employee_id", emp.id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    sb.from("audit_events").select("id, action, entity_id, metadata, created_at").like("action", "permission.%").order("created_at", { ascending: false }).limit(15),
  ]);
  const effSet = new Set(((eff ?? []) as { permission: string }[]).map((e) => e.permission));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card title="Check a person's access">
        <form className="mb-5 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="people" />
          <Field label="Employee" className="min-w-[240px] flex-1"><select name="employee" defaultValue={emp?.id ?? ""} className="input">
            <option value="" disabled>Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {label(p.role)}</option>)}</select></Field>
          <button className="btn-ghost">Show</button>
        </form>
        {!emp ? <Empty title="Pick someone" hint="See exactly what they can do, and why." /> : error ? <p className="text-sm text-danger">Not allowed.</p> : (
          <>
            <p className="mb-3 text-sm"><b>{emp.full_name}</b> · {label(emp.role)}{emp.role === "SUPER_ADMIN" && " — has every permission; cannot be restricted."}</p>
            {emp.role !== "SUPER_ADMIN" && PERMISSION_GROUPS.map((g) => (
              <div key={g.group} className="mb-3">
                <p className="eyebrow mb-1">{g.group}</p>
                <div className="flex flex-wrap gap-1.5">{g.perms.map(([p, l]) => {
                  const o = (ov ?? []).find((x) => x.permission === p);
                  return <span key={p} title={p} className={clsx("chip normal-case tracking-normal", effSet.has(p) ? "border-volt/50 text-volt" : "border-line text-muted line-through decoration-muted/40",
                    o && "ring-1 ring-ember/60")}>{l}{o ? ` · ${o.effect.toLowerCase()}` : ""}</span>;
                })}</div>
              </div>))}
            {!!ov?.length && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="eyebrow mb-2">Personal overrides</p>
                <ul className="divide-y divide-line text-sm">{ov.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Badge tone={o.effect === "GRANT" ? "green" : "red"}>{o.effect}</Badge> <span className="ml-1">{PERM_LABEL[o.permission] ?? o.permission}</span>
                      <span className="block text-xs text-muted">{o.reason}{o.expires_at ? ` · until ${fmtDateTime(o.expires_at, tz)}` : " · no expiry"}</span></span>
                    {sa && <form action={removeOverride}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="employee_id" value={emp.id} /><button className="text-xs text-muted hover:text-danger">Remove</button></form>}
                  </li>))}</ul>
              </div>)}
            {sa && emp.role !== "SUPER_ADMIN" && emp.id !== selfId && (
              <form action={addOverride} className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
                <input type="hidden" name="employee_id" value={emp.id} />
                <p className="eyebrow sm:col-span-2">Give or block one permission for this person only</p>
                <Field label="Permission"><select name="permission" className="input">{PERMISSION_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>{g.perms.map(([p, l]) => <option key={p} value={p}>{l}</option>)}</optgroup>))}</select></Field>
                <Field label="Effect"><select name="effect" className="input"><option value="GRANT">Grant (add)</option><option value="DENY">Deny (block, beats role)</option></select></Field>
                <Field label="Reason (audited)"><input name="reason" minLength={5} required className="input" placeholder="Covering payroll while HR is on leave" /></Field>
                <Field label="Expires (optional)"><input type="date" name="expires_at" className="input" /></Field>
                <div><button className="btn-primary">Apply override</button></div>
              </form>)}
          </>)}
      </Card>
      <Card title="Recent access changes">
        {!log?.length ? <Empty title="No changes yet" /> : <ul className="divide-y divide-line">{log.map((a) => (
          <li key={a.id} className="py-2 text-sm"><span className="font-mono text-xs">{a.action}</span>
            <span className="block text-xs text-muted">{a.entity_id} {a.metadata && (a.metadata as any).reason ? `· ${(a.metadata as any).reason}` : ""} · {fmtDateTime(a.created_at, tz)}</span></li>))}</ul>}
        <Link href="/settings/audit-logs?action=permission" className="mt-3 inline-block text-xs text-muted hover:text-ink">Full audit log →</Link>
      </Card>
    </div>
  );
}

async function WhoTab({ sb, sp, label }: { sb: SB; sp: Record<string, string | undefined>; label: (r: Role) => string }) {
  const perm = ALL_PERMS.includes(sp.perm ?? "") ? sp.perm! : "payroll.view_all";
  const { data } = await sb.rpc("permission_holders", { p: perm });
  const rows = (data ?? []) as { employee_id: string; full_name: string; role: Role; via: string }[];
  return (
    <Card title="Who can do this right now?">
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="who" />
        <Field label="Permission" className="min-w-[280px]"><select name="perm" defaultValue={perm} className="input">{PERMISSION_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>{g.perms.map(([p, l]) => <option key={p} value={p}>{l}</option>)}</optgroup>))}</select></Field>
        <button className="btn-ghost">Check</button>
      </form>
      <p className="mb-3 text-sm"><b>{PERM_LABEL[perm]}</b> <span className="font-mono text-xs text-muted">{perm}</span>{isSensitive(perm) && <span className="ml-2 text-xs text-ember">sensitive</span>} — {rows.length} {rows.length === 1 ? "person" : "people"}</p>
      {!rows.length ? <Empty title="Nobody" /> : <TableWrap><table className="table min-w-[480px]">
        <thead><tr><th>Person</th><th>Role</th><th>Why they have it</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.employee_id}><td><Link href={`/settings/access?tab=people&employee=${r.employee_id}`} className="hover:text-volt">{r.full_name}</Link></td>
            <td className="text-sm">{label(r.role)}</td><td><Badge tone={r.via === "override" ? "amber" : r.via === "role" ? "blue" : "green"}>{r.via.toUpperCase()}</Badge></td></tr>))}</tbody>
      </table></TableWrap>}
    </Card>
  );
}
