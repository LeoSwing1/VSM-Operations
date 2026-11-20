import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

interface ChatSpacePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = { title: "Chat" };

export default async function ChatSpacePage({ params, searchParams }: ChatSpacePageProps) {
  const p = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get the space
  const { data: space, error: spaceError } = await sb.from("spaces")
    .select(`
      id,
      name,
      description,
      is_private,
      created_at,
      space_members!eq(employee_id) (
        member_role
      ),
      messages!latest(message, created_at, sender:employees!inner(full_name, profile_image_url))
    `)
    .eq("id", p.id)
    .single();

  if (spaceError || !space) {
    notFound();
  }

  // Check if user is a member
  const isMember = space.space_members?.some((m: { member_role: string }) => m.member_role);
  if (!isMember) {
    return (
      <Card>
        <p className="text-muted">Access denied. You are not a member of this space.</p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={space.name} />
      <Flash sp={sp} />

      {(!space.messages || space.messages.length === 0) ? (
        <Card>
          <p className="text-muted">No messages yet. Start a conversation!</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {space.messages.map((msg: { id: string; created_at: string; message: string; sender: { full_name: string; profile_image_url?: string } }) => (
            <div key={msg.id} className="flex gap-3">
              {msg.sender?.profile_image_url ? (
                <img src={msg.sender.profile_image_url} alt={msg.sender.full_name} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-volt flex items-center justify-center text-xs font-bold">
                  {msg.sender?.full_name?.[0] || "?"}
                </div>
              )}
              <div className="flex-1">
                <h4 className="text-sm font-medium">{msg.sender?.full_name || "Unknown"}</h4>
                <p className="text-xs text-muted">{msg.message}</p>
                <p className="text-xs text-muted mt-1">{msg.created_at ? new Date(msg.created_at).toLocaleString() : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}