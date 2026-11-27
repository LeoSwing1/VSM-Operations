import { NextResponse } from "next/server";
import { requireContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const ctx = await requireContext();
    if (!can(ctx, "communication.view") && !can(ctx, "communication.moderate"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { channelId } = await params;
    const sb = await supabaseServer();
    const { data: messages, error } = await sb
      .from("chat_messages")
      .select("id,body,author_id,parent_message_id,created_at,edited_at,deleted_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(150);
    if (error) return NextResponse.json({ error: "Unable to load messages." }, { status: 403 });
    const messageRows = (
      (messages ?? []) as {
        id: string;
        author_id: string;
        body: string;
        parent_message_id: string | null;
        created_at: string;
        edited_at: string | null;
        deleted_at: string | null;
      }[]
    ).reverse();
    const ids = messageRows.map((m) => m.id);
    const [{ data: attachments }, { data: reactions }, { data: directory }, { data: channelMembers }] = await Promise.all([
      ids.length
        ? sb.from("chat_attachments").select("id,message_id,storage_path,file_name,mime_type,file_size").in("message_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? sb.from("chat_reactions").select("message_id,reaction,employee_id").in("message_id", ids)
        : Promise.resolve({ data: [] }),
      sb.from("employee_directory").select("id,full_name,photo_url"),
      sb.from("chat_channel_members").select("employee_id,last_read_at,last_delivered_at").eq("channel_id", channelId),
    ]);
    const attachmentRows = (attachments ?? []) as {
      id: string;
      message_id: string;
      storage_path: string;
      file_name: string;
      mime_type: string;
      file_size: number;
    }[];
    const reactionRows = (reactions ?? []) as { message_id: string; reaction: string; employee_id: string }[];
    const memberRows = (directory ?? []) as { id: string; full_name: string }[];
    const enriched = await Promise.all(
      attachmentRows.map(async (a) => {
        // Images, video, audio and PDF open in place (original quality). Everything else downloads, so an HTML/SVG
        // file can never run as a web page.
        const inline = /^(image\/(jpeg|png|webp|gif|avif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/|application\/pdf$)/.test(a.mime_type);
        // Both links point at the untouched original file — no resizing or re-encoding anywhere.
        const [view, save] = await Promise.all([
          sb.storage.from("chat-files").createSignedUrl(a.storage_path, 3600, inline ? undefined : { download: a.file_name }),
          inline ? sb.storage.from("chat-files").createSignedUrl(a.storage_path, 3600, { download: a.file_name }) : Promise.resolve(null),
        ]);
        const url = view.data?.signedUrl ?? null;
        return { ...a, url, download_url: (save ? save.data?.signedUrl : url) ?? null };
      }),
    );
    const response = messageRows.map((m) => ({
      ...m,
      attachments: enriched.filter((a) => a.message_id === m.id),
      reactions: reactionRows.filter((r) => r.message_id === m.id),
      author_name: memberRows.find((e) => e.id === m.author_id)?.full_name ?? "Team member",
    }));
    const readRows = (channelMembers ?? []) as { employee_id: string; last_read_at: string | null; last_delivered_at: string | null }[];
    const channelRoster = readRows.map((m) => ({
      ...m,
      full_name: memberRows.find((e) => e.id === m.employee_id)?.full_name ?? "Team member",
    }));
    return NextResponse.json({ messages: response, members: channelRoster }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
