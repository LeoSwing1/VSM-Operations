import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import { flash, dbMessage } from "@/lib/actions";
import { CATEGORIES, DEFAULT_MODE } from "@/lib/notification-categories";

export const metadata = { title: "Notification preferences" };
const MODES = [["IMMEDIATE", "Immediately"], ["DIGEST", "Daily summary (7 pm)"], ["MUTED", "Off"]] as const;

async function save(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const rows = CATEGORIES.map((c) => ({ org_id: ctx.org_id, employee_id: ctx.employee_id, category: c.key, channel: "EMAIL",
    mode: MODES.some(([m]) => m === fd.get(c.key)) ? String(fd.get(c.key)) : DEFAULT_MODE(c.key), updated_at: new Date().toISOString() }));
  const sb = await supabaseServer();
  const { error } = await sb.from("notification_preferences").upsert(rows, { onConflict: "employee_id,category,channel" });
  if (error) flash("/notifications/preferences", "err", dbMessage(error));
  flash("/notifications/preferences", "ok", "Preferences saved. They apply to the next email.");
}

export default async function Preferences({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data } = await sb.from("notification_preferences").select("category, mode").eq("employee_id", ctx.employee_id);
  const mode = (k: string) => data?.find((d) => d.category === k)?.mode ?? DEFAULT_MODE(k);
  return (
    <>
      <PageHeader eyebrow="Notifications" title="How should we email you?"><Link href="/notifications" className="btn-ghost">← Notifications</Link></PageHeader>
      <Flash sp={sp} />
      <p className="mb-6 max-w-2xl text-sm text-muted">Everything always appears in your in-app notifications. These settings only control email to <b className="text-ink">{ctx.email}</b>. Security and account emails (password reset, sign-in) are always sent.</p>
      <form action={save}>
        <Card>
          <div className="divide-y divide-line">
            {CATEGORIES.map((c) => (
              <fieldset key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <legend className="sr-only">{c.label}</legend>
                <div className="min-w-[200px]">
                  <p className="font-semibold">{c.label}{!c.live && <span className="ml-2 chip border-line text-muted">coming</span>}</p>
                  <p className="text-xs text-muted">{c.hint}</p>
                </div>
                <div className="flex flex-wrap gap-1 rounded-full border border-line p-1">
                  {MODES.map(([m, l]) => (
                    <label key={m} className="cursor-pointer">
                      <input type="radio" name={c.key} value={m} defaultChecked={mode(c.key) === m} className="peer sr-only" />
                      <span className="block rounded-full px-3 py-1 text-xs text-muted peer-checked:bg-volt peer-checked:font-semibold peer-checked:text-[#0b0b0c] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-volt">{l}</span>
                    </label>))}
                </div>
              </fieldset>))}
          </div>
        </Card>
        <div className="sticky bottom-4 mt-4"><button className="btn-primary shadow-lg">Save preferences</button></div>
      </form>
    </>
  );
}
