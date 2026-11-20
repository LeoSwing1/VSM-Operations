import { Shell } from "@/components/shell";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return <Shell ctx={ctx} unread={count ?? 0}>{children}</Shell>;
}
