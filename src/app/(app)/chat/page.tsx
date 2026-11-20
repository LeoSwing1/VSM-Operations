import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Chat" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get user's spaces - would need a spaces table
  const { data: spaces } = await sb.from("spaces")
    .select(`
      id,
      name,
      description,
      is_private,
      created_at,
      space_members!inner(member_role)
    `)
    .eq("space_members.employee_id", ctx.employee_id)
    .order("name", { ascending: true });

  // Get unread counts if the table exists
  const { data: unread } = await sb.from("unread_counts")
    .select("space_id, count")
    .eq("employee_id", ctx.employee_id)
    .gt("count", 0);

  return (
    <>
      <PageHeader title="Chat" />
      <Flash sp={sp} />

      {(!spaces || spaces.length === 0) ? (
        <Card>
          <p className="text-muted">No spaces found. Create a space to start chatting.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {spaces?.map((space) => (
            <Link key={space.id} href={`/chat/${space.id}`} className="card p-4 hover:border-ink/30 transition">
              <h3 className="font-medium text-sm">{space.name}</h3>
              <p className="text-xs text-muted mt-1 line-clamp-2">
                {space.description || "No description"}
              </p>
              {unread?.find((u) => u.space_id === space.id) && (
                <span className="mt-2 inline-flex items-center rounded-full bg-volt px-2 py-0.5 text-xs font-medium">
                  {unread.find((u) => u.space_id === space.id)!.count} unread
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}