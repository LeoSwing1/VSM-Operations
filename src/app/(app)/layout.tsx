import { Shell } from "@/components/shell";
import { Analytics } from "@/components/analytics";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { myToday } from "@/lib/data/today";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ count }, today] = await Promise.all([
    sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    myToday(sb),
  ]);
  return (
    <Shell ctx={ctx} unread={count ?? 0} today={today}>
      {children}
      <Analytics band={ctx.role_level >= 80 ? "admin" : ctx.role_level >= 40 ? "manager" : "member"} />
    </Shell>
  );
}
