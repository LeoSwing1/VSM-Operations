export const metadata = { title: "Users Settings" };

"use client";
import { Card, Empty, PageHeader } from "@/components/ui";
import { useState } from "react";

export default function UsersPage({ searchParams }: { searchParams: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUsers() {
      try {
        const supabase = require("@/lib/supabase").createClient;
        const { data } = await supabase
          .from("employees")
          .select("id, full_name, email, role, department_id, is_active");
        setUsers(data ?? []);
      } catch (e) {
        console.error("Failed to load users:", e);
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-muted italic">Loading user data...</p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Users Settings" />
      {users.length === 0 ? (
        <Empty
          title="No users configured"
          hint="Add team members and assign roles"
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper/50">
                <th className="text-left py-3 font-semibold">Name</th>
                <th className="text-left py-3 font-semibold">Email</th>
                <th className="text-left py-3 font-semibold">Role</th>
                <th className="text-left py-3 font-semibold">Department</th>
                <th className="text-left py-3 font-semibold">Status</th>
                <th className="text-left py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-ink/5">
                  <td className="py-3">{u.full_name || "—"}</td>
                  <td className="py-3">{u.email || "—"}</td>
                  <td className="py-3">
                    <span className="capitalize text-muted/70">{u.role || "—"}</span>
                  </td>
                  <td className="py-3">{u.department_id ? "Dept " + u.department_id : "—"}</td>
                  <td className="py-3">
                    <span className={u.is_active ? "text-volt" : "text-ember"}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 text-muted/50">View</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}