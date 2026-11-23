import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { createChatChannel, createDepartmentChannel, createPublicChannel, joinChatChannel, openDirectChat } from "./actions";

export const metadata = { title: "Team communication" };
const channelHint: Record<string, string> = {
  PUBLIC: "Company-wide channel",
  DEPARTMENT: "Department channel",
  PROJECT: "Project conversation",
  DIRECT: "Direct message",
  GROUP: "Private group",
};
export default async function ChatHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requirePerm("communication.view"),
    sb = await supabaseServer();
  const [{ data: channels }, { data: memberships }, { data: directory }, { data: departments }] = await Promise.all([
    sb
      .from("chat_channels")
      .select("id,name,description,channel_type,created_at,project_id,department_id")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    sb.from("chat_channel_members").select("channel_id,last_read_at").eq("employee_id", ctx.employee_id),
    sb.from("employee_directory").select("id,full_name,designation,department_name").neq("id", ctx.employee_id).order("full_name"),
    sb.from("departments").select("id,name").order("name"),
  ]);
  const mine = new Set((memberships ?? []).map((m: any) => m.channel_id));
  const directIds = (channels ?? []).filter((c: any) => c.channel_type === "DIRECT").map((c: any) => c.id);
  const { data: directMembers } = directIds.length
    ? await sb.from("chat_channel_members").select("channel_id,employee_id").in("channel_id", directIds)
    : { data: [] };
  const joined = (channels ?? []).filter((c: any) => mine.has(c.id)),
    discover = (channels ?? []).filter((c: any) => !mine.has(c.id) && (c.channel_type === "PUBLIC" || c.channel_type === "DEPARTMENT"));
  const directName = (channelId: string) => {
    const other = (directMembers ?? []).find((m: any) => m.channel_id === channelId && m.employee_id !== ctx.employee_id);
    return (directory ?? []).find((e: any) => e.id === other?.employee_id)?.full_name ?? "Direct message";
  };
  const canManage = ctx.permissions.includes("communication.manage") || ctx.permissions.includes("*");
  return (
    <>
      <PageHeader eyebrow="VSM workspace · communication" title="Team chat">
        <Badge tone="green">Internal workspace</Badge>
      </PageHeader>
      <Flash sp={sp} />
      <div className="grid min-h-[70vh] gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
        <section className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-semibold">Your conversations</h2>
              <p className="mt-1 text-xs text-muted">Direct messages, groups and project channels</p>
            </div>
            <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-xs tabular-nums">{joined.length} joined</span>
          </div>
          {!joined.length ? (
            <div className="p-5">
              <Empty title="Your inbox is clear" hint="Start a direct message or join a company channel to begin collaborating." />
            </div>
          ) : (
            <div className="divide-y divide-line">
              {joined.map((c: any) => {
                const direct = c.channel_type === "DIRECT",
                  name = direct ? directName(c.id) : c.name;
                return (
                  <Link
                    key={c.id}
                    href={`/chat/${c.id}`}
                    className="group flex items-center gap-3 px-5 py-4 transition hover:bg-ink/[0.025]"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink/[0.06] text-sm font-semibold">
                      {direct
                        ? name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((x: string) => x[0])
                            .join("")
                            .toUpperCase()
                        : "#"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold group-hover:text-volt">{name}</span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {c.description || channelHint[c.channel_type] || "Workspace conversation"}
                      </span>
                    </span>
                    <span className="text-[10px] text-muted">{c.channel_type.replace("_", " ")}</span>
                    <span className="text-muted transition group-hover:translate-x-0.5">→</span>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="border-t border-line bg-ink/[0.02] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Discover channels</h3>
              <span className="text-[10px] text-muted">{discover.length} available</span>
            </div>
            {!discover.length ? (
              <p className="text-xs text-muted">No public or department channels are currently available to join.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {discover.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium"># {c.name}</p>
                      <p className="truncate text-[11px] text-muted">{c.description || channelHint[c.channel_type]}</p>
                    </div>
                    <form action={joinChatChannel}>
                      <input type="hidden" name="channel_id" value={c.id} />
                      <button className="btn-ghost px-3 py-1.5 text-xs">Join</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="font-semibold">Start a conversation</h2>
            <p className="mt-1 text-xs text-muted">Message any teammate directly.</p>
            <form action={openDirectChat} className="mt-4 space-y-3">
              <Field label="Employee">
                <select name="employee_id" required className="input">
                  <option value="">Choose a teammate</option>
                  {(directory ?? []).map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                      {e.designation ? ` · ${e.designation}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn-primary w-full">Open direct message</button>
            </form>
          </section>
          {canManage ? (
            <section className="rounded-2xl border border-line bg-panel p-5">
              <h2 className="font-semibold">Create a channel</h2>
              <p className="mt-1 text-xs text-muted">Set up a space for a team, department or the whole company.</p>
              <div className="mt-4 space-y-3">
                <details className="group rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Company-wide channel <span className="float-right text-muted">+</span>
                  </summary>
                  <form action={createPublicChannel} className="mt-3 space-y-2">
                    <input name="name" required maxLength={100} className="input" placeholder="e.g. company-updates" />
                    <input name="description" maxLength={500} className="input" placeholder="Purpose of this channel" />
                    <button className="btn-ghost w-full">Create channel</button>
                  </form>
                </details>
                <details className="group rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Department channel <span className="float-right text-muted">+</span>
                  </summary>
                  <form action={createDepartmentChannel} className="mt-3 space-y-2">
                    <select name="department_id" required className="input">
                      <option value="">Choose department</option>
                      {(departments ?? []).map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <input name="name" required maxLength={100} className="input" placeholder="Channel name" />
                    <input name="description" maxLength={500} className="input" placeholder="Purpose of this channel" />
                    <button className="btn-ghost w-full">Create department channel</button>
                  </form>
                </details>
                <details className="group rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Private team group <span className="float-right text-muted">+</span>
                  </summary>
                  <form action={createChatChannel} className="mt-3 space-y-2">
                    <input name="name" required maxLength={100} className="input" placeholder="e.g. SEO delivery team" />
                    <input name="description" maxLength={500} className="input" placeholder="Purpose of this group" />
                    <label className="label">
                      Add members
                      <select name="members" multiple size={5} className="input mt-1">
                        {(directory ?? []).map((e: any) => (
                          <option key={e.id} value={e.id}>
                            {e.full_name} · {e.department_name ?? "No department"}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[10px] text-muted">Use Ctrl/Cmd to select multiple people.</span>
                    </label>
                    <button className="btn-ghost w-full">Create private group</button>
                  </form>
                </details>
              </div>
            </section>
          ) : null}
          <section className="rounded-2xl border border-line bg-ink/[0.025] p-4">
            <p className="text-xs font-semibold">Workspace tip</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Use channels for shared work and direct messages for one-to-one conversations. Private channels are visible only to their
              members.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
