import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "Incidents & SLA" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get open incidents
  const { data: openIncidents } = await sb.from("incidents")
    .select(`
      id,
      title,
      description,
      severity,
      status,
      created_at,
      incident_sla!inner(
        deadline_at,
        is_breached,
        resolved_at
      )
    `)
    .in("incident_updates.assigned_to", [ctx.employee_id, null])
    .or(`created_by.eq.${ctx.employee_id},incident_updates.assigned_to.eq.${ctx.employee_id}`)
    .neq("status", "RESOLVED")
    .neq("status", "CLOSED")
    .order("created_at", { ascending: true })
    .limit(15);

  // Get recent incidents
  const { data: recentIncidents } = await sb.from("incidents")
    .select(`
      id,
      title,
      severity,
      status,
      created_at
    `)
    .or(`created_by.eq.${ctx.employee_id},incident_updates.assigned_to.eq.${ctx.employee_id}`)
    .order("created_at", { ascending: true })
    .limit(20);

  const severityColors = {
    SEV1: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    SEV2: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    SEV3: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    SEV4: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };

  return (
    <>
      <PageHeader title="Incidents & SLA" />
      <Flash sp={sp} />

      {(!openIncidents || openIncidents.length === 0) && (!recentIncidents || recentIncidents.length === 0) ? (
        <Card>
          <p className="text-muted">No incidents found.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {openIncidents && openIncidents.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Active Incidents</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {openIncidents.map((inc) => {
                  const sla = inc.incident_sla?.[0];
                  const isBreached = sla?.is_breached;
                  return (
                    <Card key={inc.id} className={isBreached ? "border-red-500" : ""}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-medium text-sm line-clamp-1">{inc.title}</h3>
                          <p className="text-xs text-muted mt-1 line-clamp-2">
                            {inc.description || "No description"}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${severityColors[inc.severity as keyof typeof severityColors] || severityColors.SEV4}`}>
                          {inc.severity}
                        </span>
                      </div>
                      <div className="mt-3 flex gap-4 text-xs">
                        <div>
                          <span className="text-muted">Status: </span>
                          <span className="font-medium">{inc.status}</span>
                        </div>
                        {sla && (
                          <div>
                            <span className="text-muted">SLA: </span>
                            {isBreached ? (
                              <span className="text-red-600 font-medium">BREACHED</span>
                            ) : (
                              <span className="text-muted-foreground">
                                {sla.deadline_at ? new Date(sla.deadline_at).toLocaleString() : "N/A"}
                              </span>
                            )}
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