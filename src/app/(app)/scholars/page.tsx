import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "VSM Scholars" };

export default async function ScholarsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get scholar batches
  const { data: batches } = await sb.from("scholar_batches")
    .select(`
      id,
      name,
      description,
      start_date,
      end_date,
      is_active,
      count:scholars
    `)
    .order("start_date", { ascending: true });

  // Get scholar applications (for team leads and above)
  const { data: applications } = await sb.from("scholars")
    .select(`
      id,
      application_status,
      created_at,
      applicant:employees!inner(full_name, email, profile_image_url)
    `)
    .in("application_status", ["APPLIED", "SCREENING", "INTERVIEW", "SELECTED", "WITHDRAWN"])
    .order("created_at", { ascending: true })
    .limit(20);

  const statusColors = {
    APPLIED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    SCREENING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    INTERVIEW: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    SELECTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    ONBOARDING: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    ALUMNI: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
    WITHDRAWN: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  };

  return (
    <>
      <PageHeader title="VSM Scholars" />
      <Flash sp={sp} />

      {(!batches || batches.length === 0) && (!applications || applications.length === 0) ? (
        <Card>
          <p className="text-muted">No scholar data found.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {batches && batches.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Scholar Batches</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {batches.map((batch) => (
                  <Card key={batch.id} className="hover:border-ink/30 transition">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium text-sm line-clamp-1">{batch.name}</h3>
                        <p className="text-xs text-muted mt-1 line-clamp-2">
                          {batch.description || "No description"}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${batch.is_active ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"}`}>
                        {batch.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="mt-3 text-xs">
                      <span className="text-muted">
                        {batch.start_date ? new Date(batch.start_date).toLocaleDateString() : "Start"} -{" "}
                        {batch.end_date ? new Date(batch.end_date).toLocaleDateString() : "End"}
                      </span>
                      <span className="ml-3 text-muted">• {batch.count}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {applications && applications.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Recent Applications</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {applications.map((app) => (
                  <Card key={app.id}>
                    <Link href={`/scholars/${app.id}`} className="flex gap-3">
                      {app.applicant?.[0]?.profile_image_url ? (
                        <img src={app.applicant[0].profile_image_url} alt={app.applicant[0].full_name || ""} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-volt flex items-center justify-center text-sm font-bold">
                          {app.applicant?.[0]?.full_name?.[0] || "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm line-clamp-1">{app.applicant?.[0]?.full_name || ""}</h3>
                        <p className="text-xs text-muted line-clamp-1">{app.applicant?.[0]?.email || ""}</p>
                        <span className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[app.application_status as keyof typeof statusColors] || statusColors.APPLIED}`}>
                          {app.application_status}
                        </span>
                      </div>
                    </Link>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}