import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "Automation Engine" };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get automations for user's org
  const { data: automations } = await sb.from("automations")
    .select(`
      id,
      name,
      description,
      trigger_type,
      is_active,
      created_at,
      updated_at,
      automation_runs!inner(
        status,
        started_at,
        completed_at,
        error_message
      )
    `)
    .eq("org_id", ctx.org_id)
    .order("updated_at", { ascending: true })
    .limit(30);

  // Separate active/inactive
  const activeAutomations = automations?.filter((a) => a.is_active) || [];
  const inactiveAutomations = automations?.filter((a) => !a.is_active) || [];

  // Get latest run for each automation
  const getLatestRun = (runs: Array<{ started_at: string; status: string; error_message?: string }>) => {
    if (!runs || runs.length === 0) return null;
    return runs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  };

  return (
    <>
      <PageHeader title="Automation Engine" />
      <Flash sp={sp} />

      {(!automations || automations.length === 0) ? (
        <Card>
          <p className="text-muted">No automations configured.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {automations && automations.length > 0 && (
            <>
              <h2 className="text-sm font-medium">All Automations ({automations.length})</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {automations.map((auto) => {
                  const latestRun = getLatestRun(auto.automation_runs);
                  const statusColor = latestRun?.status === "SUCCESS" ? "text-green-600" : latestRun?.status === "FAILED" ? "text-red-600" : "text-muted-foreground";
                  return (
                    <Card key={auto.id} className={auto.is_active ? "border-volt" : "border-muted"}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-medium text-sm line-clamp-1">{auto.name}</h3>
                          <p className="text-xs text-muted mt-1 line-clamp-2">
                            {auto.description || "No description"}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${auto.is_active ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"}`}>
                          {auto.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="mt-3 flex gap-4 text-xs">
                        <div>
                          <span className="text-muted">Trigger: </span>
                          <span className="font-medium capitalize">{auto.trigger_type?.toLowerCase().replace("_", " ")}</span>
                        </div>
                        {latestRun && (
                          <div>
                            <span className="text-muted">Last run: </span>
                            <span className={`font-medium ${statusColor}`}>
                              {latestRun.status === "PENDING" ? "Running..." : latestRun.status === "SUCCESS" ? "Success" : latestRun.status === "FAILED" ? "Failed" : latestRun.status}
                            </span>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}