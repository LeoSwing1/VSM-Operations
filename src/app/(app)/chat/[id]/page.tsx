import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Flash, PageHeader } from "@/components/ui";
import { ChatRoom } from "@/components/chat/chat-room";
import { archiveChat, joinChatChannel, leaveChatChannel, manageChatMember } from "../actions";
export const metadata = { title: "Conversation" };
export default async function ChatConversation({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    sp = await searchParams,
    ctx = await requirePerm("communication.view", "communication.moderate"),
    sb = await supabaseServer();
  const [{ data: channel }, { data: membership }, { data: members }, { data: directory }] = await Promise.all([
    sb.from("chat_channels").select("id,name,description,channel_type,created_by,project_id,department_id").eq("id", id).maybeSingle(),
    sb.from("chat_channel_members").select("channel_id,member_role").eq("channel_id", id).eq("employee_id", ctx.employee_id).maybeSingle(),
    sb.from("chat_channel_members").select("employee_id,member_role,last_read_at").eq("channel_id", id),
    sb.from("employee_directory").select("id,full_name,department_id"),
  ]);
  if (!channel) notFound();
  const displayName =
    channel.channel_type === "DIRECT"
      ? ((directory ?? []).find((e: any) => e.id === (members ?? []).find((m: any) => m.employee_id !== ctx.employee_id)?.employee_id)
          ?.full_name ?? "Direct message")
      : channel.name;
  const canManageMembers =
    can(ctx, "communication.channel_manage") ||
    (channel.channel_type === "PROJECT" && can(ctx, "projects.manage")) ||
    channel.created_by === ctx.employee_id ||
    (members ?? []).some((m: any) => m.employee_id === ctx.employee_id && ["OWNER", "MODERATOR"].includes(m.member_role));
  const canArchiveChannel =
    can(ctx, "communication.channel_manage") ||
    (channel.channel_type === "PROJECT" && can(ctx, "projects.manage")) ||
    channel.created_by === ctx.employee_id ||
    membership?.member_role === "OWNER";
  if (!membership && can(ctx, "communication.moderate"))
    return (
      <>
        <PageHeader eyebrow="Moderator · read-only review" title={displayName}>
          <Link href="/settings/chat-moderation" className="btn-ghost">
            Back to moderation
          </Link>
        </PageHeader>
        <Flash sp={sp} />
        <p className="mb-3 text-sm text-muted">
          You are viewing this conversation in read-only moderation mode. You have not joined the channel.
        </p>
        <ChatRoom channelId={id} employeeId={ctx.employee_id} employeeName={ctx.full_name} readOnly />
      </>
    );
  if (!membership)
    return (
      <>
        <PageHeader eyebrow="Team chat" title={displayName}>
          <Link href="/chat" className="btn-ghost">
            All conversations
          </Link>
        </PageHeader>
        <Flash sp={sp} />
        <div className="card p-8 text-center">
          <p className="font-semibold">Join this channel to view messages</p>
          <p className="mt-2 text-sm text-muted">{channel.description || "Become a member to participate in this conversation."}</p>
          <form action={joinChatChannel} className="mt-4">
            <input type="hidden" name="channel_id" value={id} />
            <button className="btn-primary">Join channel</button>
          </form>
        </div>
      </>
    );
  return (
    <>
      <PageHeader eyebrow="VSM company communication" title={displayName}>
        <Link href="/chat" className="btn-ghost">
          All conversations
        </Link>
        <Badge>{channel.channel_type}</Badge>
      </PageHeader>
      <Flash sp={sp} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{channel.description || "Private internal conversation"}</span>
        <span>{members?.length ?? 0} members · Realtime messaging enabled</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(members ?? []).map((m: any) => (
          <span key={m.employee_id} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
            {(directory ?? []).find((e: any) => e.id === m.employee_id)?.full_name ?? "Member"} · {m.member_role.toLowerCase()}
            {m.last_read_at
              ? ` · read ${new Date(m.last_read_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}`
              : " · not read yet"}
            {canManageMembers && m.member_role !== "OWNER" ? (
              <>
                <form action={manageChatMember} className="ml-1 inline-flex items-center gap-1">
                  <input type="hidden" name="channel_id" value={id} />
                  <input type="hidden" name="employee_id" value={m.employee_id} />
                  <input type="hidden" name="action" value="ROLE" />
                  <select
                    name="member_role"
                    defaultValue={m.member_role}
                    aria-label="Member role"
                    className="rounded border border-line bg-panel px-1 py-0.5 text-[10px]"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="MODERATOR">Moderator</option>
                  </select>
                  <button className="text-[10px] text-volt">Save</button>
                </form>
                <form action={manageChatMember} className="ml-1 inline">
                  <input type="hidden" name="channel_id" value={id} />
                  <input type="hidden" name="employee_id" value={m.employee_id} />
                  <input type="hidden" name="action" value="REMOVE" />
                  <button title="Remove member" className="text-danger">
                    ×
                  </button>
                </form>
              </>
            ) : null}
          </span>
        ))}
      </div>
      {canManageMembers && channel.channel_type !== "DIRECT" ? (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
          <form action={manageChatMember} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="channel_id" value={id} />
            <input type="hidden" name="action" value="ADD" />
            <label className="text-xs text-muted">
              Add member
              <select name="employee_id" required className="input mt-1 min-w-[190px]">
                <option value="">Choose employee</option>
                {(directory ?? [])
                  .filter((e: any) => !(members ?? []).some((m: any) => m.employee_id === e.id))
                  .map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Role
              <select name="member_role" className="input mt-1">
                <option value="MEMBER">Member</option>
                <option value="MODERATOR">Moderator</option>
              </select>
            </label>
            <button className="btn-ghost">Add</button>
          </form>
          {canArchiveChannel ? (
            <form action={archiveChat}>
              <input type="hidden" name="channel_id" value={id} />
              <button className="btn-danger">Archive channel</button>
            </form>
          ) : null}
        </div>
      ) : null}
      {channel.channel_type !== "DIRECT" && membership?.member_role !== "OWNER" ? (
        <form action={leaveChatChannel} className="mb-3">
          <input type="hidden" name="channel_id" value={id} />
          <button className="text-xs text-muted underline">Leave channel</button>
        </form>
      ) : null}
      <ChatRoom channelId={id} employeeId={ctx.employee_id} employeeName={ctx.full_name} />
    </>
  );
}
