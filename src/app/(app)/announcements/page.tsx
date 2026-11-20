import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get announcements
  const { data: announcements } = await sb.from("announcements")
    .select(`
      id,
      title,
      body,
      priority,
      is_pinned,
      expires_at,
      created_at,
      created_by:employees!inner(full_name)
    `)
    .or(`target_audience.eq."all",target_department_id.eq."${ctx.employee_id}",target_role_id.eq."${ctx.employee_id}"`)
    .order("is_pinned", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(30);

  return (
    <>
      <PageHeader title="Announcements" />
      <Flash sp={sp} />

      {(!announcements || announcements.length === 0) ? (
        <Card>
          <p className="text-muted">No announcements found.</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {announcements.map((a) => (
            <Card key={a.id} className={a.priority === "HIGH" ? "border-yellow-500" : ""}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium text-sm line-clamp-1">{a.title}</h3>
                  <p className="text-xs text-muted mt-1 line-clamp-2">
                    {a.body || "No content"}
                  </p>
                  <p className="text-xs text-muted mt-2">
                    By {a.created_by?.[0]?.full_name || "Unknown"} • {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                  </p>
                </div>
                {a.priority && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    a.priority === "HIGH" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                    a.priority === "MEDIUM" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  }`}>
                    {a.priority}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}