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
      space_members!inner(member_role, employee_id),
      messages!inner(id, message, created_at, sender:employees!inner(full_name, profile_image_url))
    `)
    .eq("id", p.id)
    .eq("space_members.employee_id", ctx.employee_id)
    .order("messages.created_at", { ascending: true })
    .limit(50)
    .single();

  if (spaceError || !space) {
    notFound();
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
          {space.messages.map((msg: any) => (
            <div key={msg.id} className="flex gap-3">
              {msg.sender?.[0]?.profile_image_url ? (
                <img src={msg.sender[0].profile_image_url} alt={msg.sender[0].full_name} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-volt flex items-center justify-center text-xs font-bold">
                  {msg.sender?.[0]?.full_name?.[0] || "?"}
                </div>
              )}
              <div className="flex-1">
                <h4 className="text-sm font-medium">{msg.sender?.[0]?.full_name || "Unknown"}</h4>
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