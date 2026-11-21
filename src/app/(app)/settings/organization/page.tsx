export const metadata = { title: "Organization Settings" };

"use client";
import { Card, Empty, PageHeader } from "@/components/ui";
import { useState } from "react";

export default function OrganizationPage({ searchParams }: { searchParams: any }) {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOrgs() {
      try {
        const supabase = require("@/lib/supabase").createClient;
        const { data } = await supabase
          .from("organizations")
          .select("*");
        setOrgs(data ?? []);
      } catch (e) {
        console.error("Failed to load orgs:", e);
      } finally {
        setLoading(false);
      }
    }

    loadOrgs();
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-muted italic">Loading organization data...</p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Organization Settings" />
      {orgs.length === 0 ? (
        <Empty
          title="No organizations configured"
          hint="Add your company branches here to organize teams"
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper/50">
                <th className="text-left py-3 font-semibold">Name</th>
                <th className="text-left py-3 font-semibold">Branch</th>
                <th className="text-left py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-ink/5">
                  <td className="py-3">{o.name}</td>
                  <td className="py-3">{o.branch || "—"}</td>
                  <td className="py-3">
                    <span className={o.is_active ? "text-volt" : "text-ember"}>
                      {o.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}