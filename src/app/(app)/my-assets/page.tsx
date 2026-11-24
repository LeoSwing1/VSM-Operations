import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { LiveSync } from "@/components/live-sync";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/engines/time";
import { categoryLabel, isOverdue } from "@/lib/engines/assets";
import { acknowledgeAsset, reportAssetIssue } from "../assets/actions";

export const metadata = { title: "My assets" };

export default async function MyAssets({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: items, error }, { data: past }] = await Promise.all([
    sb.rpc("my_assets"),
    sb
      .from("asset_assignments")
      .select("id, issued_at, returned_at, condition_in, asset_id")
      .eq("employee_id", ctx.employee_id)
      .not("returned_at", "is", null)
      .order("returned_at", { ascending: false })
      .limit(20),
  ]);
  const list = (items ?? []) as any[];
  const pending = list.filter((i) => !i.acknowledged_at).length;

  return (
    <>
      <LiveSync tables={["asset_assignments", "assets"]} />
      <PageHeader eyebrow="Me" title="My assets">
        {pending > 0 && <Badge tone="amber">{`${pending} TO CONFIRM`}</Badge>}
      </PageHeader>
      <Flash sp={sp} />
      <p className="mb-6 max-w-2xl text-sm text-muted">
        Company kit issued to you. Please confirm when you receive something, and report any problem here — the admin team is told straight
        away. Everything here is returned when you leave.
      </p>
      {error && <p className="mb-4 text-sm text-danger">Could not load your assets: {error.message}</p>}
      {!list.length ? (
        <Empty title="Nothing issued to you" hint="Laptops, phones, SIMs or cameras given to you will show up here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((i) => (
            <Card key={i.assignment_id} title={`${i.asset_tag} · ${categoryLabel(i.category)}`}>
              <p className="font-medium">{i.name}</p>
              <p className="text-xs text-muted">{[i.brand, i.model, i.serial_no && `S/N ${i.serial_no}`].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 text-xs text-muted">
                Issued {fmtDateTime(i.issued_at, ctx.timezone)} · condition {i.condition.toLowerCase()}
                {i.expected_return && (
                  <span className={isOverdue(i.expected_return) ? " text-danger" : ""}> · return by {fmtDate(i.expected_return)}</span>
                )}
                {i.open_issues > 0 && ` · ${i.open_issues} open issue${i.open_issues > 1 ? "s" : ""}`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {i.acknowledged_at ? (
                  <Badge tone="green">RECEIVED</Badge>
                ) : (
                  <form action={acknowledgeAsset}>
                    <input type="hidden" name="assignment_id" value={i.assignment_id} />
                    <button className="btn-primary">I have received this</button>
                  </form>
                )}
              </div>
              <form action={reportAssetIssue} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={i.asset_id} />
                <input type="hidden" name="back" value="/my-assets" />
                <input
                  name="description"
                  required
                  minLength={3}
                  maxLength={2000}
                  className="input min-w-[180px] flex-1"
                  placeholder="Something wrong? Describe it"
                />
                <button className="btn-ghost">Report problem</button>
              </form>
            </Card>
          ))}
        </div>
      )}
      {!!past?.length && (
        <p className="mt-8 text-xs text-muted">
          {past.length} item{past.length > 1 ? "s" : ""} returned earlier — last on {fmtDateTime(past[0]!.returned_at!, ctx.timezone)}.
        </p>
      )}
    </>
  );
}
