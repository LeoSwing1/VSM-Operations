export const metadata = { title: "Departments Settings" };

"use client";
import { Card, Empty, PageHeader } from "@/components/ui";
import { useState } from "react";

export default function DepartmentsPage({ searchParams }: { searchParams: any }) {
  const [depts, setDepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDepts() {
      try {
        const supabase = require("@/lib/supabase").createClient;
        const { data } = await supabase
          .from("departments")
          .select("*");
        setDepts(data ?? []);
      } catch (e) {
        console.error("Failed to load departments:", e);
      } finally {
        setLoading(false);
      }
    }

    loadDepts();
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-muted italic">Loading department data...</p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Departments Settings" />
      {depts.length === 0 ? (
        <Empty
          title="No departments configured"
          hint="Add departments to organize employees into teams"
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper/50">
                <th className="text-left py-3 font-semibold">Department</th>
                <th className="text-left py-3 font-semibold">Head</th>
                <th className="text-left py-3 font-semibold">Employees</th>
                <th className="text-left py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => (
                <tr key={d.id} className="hover:bg-ink/5">
                  <td className="py-3">{d.name}</td>
                  <td className="py-3">{d.head_name || "—"}</td>
                  <td className="py-3">{d.employee_count || 0}</td>
                  <td className="py-3">
                    <span className={d.is_active ? "text-volt" : "text-ember"}>
                      {d.is_active ? "Active" : "Inactive"}
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