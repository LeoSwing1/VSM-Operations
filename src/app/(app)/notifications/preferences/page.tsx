import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { CATEGORIES, DEFAULT_MODE } from "@/lib/notification-categories";
import { removePush, saveWhatsApp, savePreferences, stopWhatsApp } from "./actions";
import { PushOptIn } from "./push-optin";

export const metadata = { title: "Notification preferences" };
const WA_ON = new Set(["APPROVALS", "LEAVE", "PAYROLL", "ATTENDANCE", "MEETINGS"]);

export default async function Preferences({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: prefs }, { data: wa }, { data: devices }] = await Promise.all([
    sb.from("notification_preferences").select("category, channel, mode").eq("employee_id", ctx.employee_id),
    sb.from("whatsapp_optins").select("phone_e164, opted_in").eq("employee_id", ctx.employee_id).maybeSingle(),
    sb
      .from("push_subscriptions")
      .select("id, user_agent, created_at, last_success_at")
      .eq("employee_id", ctx.employee_id)
      .is("revoked_at", null)
      .order("created_at"),
  ]);
  const mode = (cat: string, ch: string) =>
    prefs?.find((p) => p.category === cat && p.channel === ch)?.mode ??
    (ch === "EMAIL" ? DEFAULT_MODE(cat) : ch === "PUSH" ? "IMMEDIATE" : WA_ON.has(cat) ? "IMMEDIATE" : "MUTED");
  const waOn = !!wa?.opted_in;
  const waConfigured = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
  const device = (ua: string | null) =>
    (ua ?? "Browser")
      .replace(/.*(Chrome|Firefox|Safari|Edg)\/[\d.]+.*/, "$1")
      .replace("Edg", "Edge")
      .slice(0, 40);

  return (
    <>
      <PageHeader eyebrow="Notifications" title="How should we reach you?">
        <Link href="/notifications" className="btn-ghost">
          ← Notifications
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <p className="mb-6 max-w-2xl text-sm text-muted">
        Everything always appears in your in-app notifications. Choose which kinds also come by email ({ctx.email}), WhatsApp and push.
        Security emails are always sent. Salary amounts never leave the app on any channel.
      </p>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="WhatsApp" hint={waConfigured ? undefined : "Your admin hasn't connected WhatsApp yet — you can still opt in now."}>
          {waOn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                On for <b>{wa!.phone_e164.replace(/(\+\d{2})\d+(\d{3})$/, "$1•••••$2")}</b>
              </p>
              <form action={stopWhatsApp}>
                <button className="btn-ghost">Stop WhatsApp messages</button>
              </form>
            </div>
          ) : (
            <form action={saveWhatsApp} className="grid gap-3">
              <label className="block">
                <span className="label">Mobile number</span>
                <input
                  name="phone"
                  inputMode="tel"
                  placeholder="98765 43210"
                  defaultValue={wa?.phone_e164 ?? ""}
                  required
                  className="input"
                />
              </label>
              <label className="flex items-start gap-2 text-xs text-muted">
                <input type="checkbox" name="consent" required className="mt-0.5" /> I agree to receive work notifications from VSM Growth
                on WhatsApp. I can stop them any time here.
              </label>
              <div>
                <button className="btn-primary">Turn on WhatsApp</button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Push notifications" hint="Shows alerts on this computer or phone even when VSM Ops isn't open.">
          <PushOptIn vapidKey={vapid} />
          {!!devices?.length && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {device(d.user_agent)}{" "}
                    <span className="text-xs text-muted">
                      · added {fmtDateTime(d.created_at, ctx.timezone)}
                      {d.last_success_at ? ` · last push ${fmtDateTime(d.last_success_at, ctx.timezone)}` : ""}
                    </span>
                  </span>
                  <form action={removePush}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-xs text-muted hover:text-danger">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <form action={savePreferences}>
        <Card title="By category">
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Email</th>
                  <th className="text-center">WhatsApp</th>
                  <th className="text-center">Push</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <p className="font-semibold">
                        {c.label}
                        {!c.live && <span className="ml-2 chip border-line text-muted">coming</span>}
                      </p>
                      <p className="text-xs text-muted">{c.hint}</p>
                    </td>
                    <td>
                      <select
                        name={`email:${c.key}`}
                        defaultValue={mode(c.key, "EMAIL")}
                        className="input py-1 text-xs"
                        aria-label={`${c.label} email`}
                      >
                        <option value="IMMEDIATE">Immediately</option>
                        <option value="DIGEST">Daily summary</option>
                        <option value="MUTED">Off</option>
                      </select>
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        name={`wa:${c.key}`}
                        defaultChecked={mode(c.key, "WHATSAPP") === "IMMEDIATE"}
                        disabled={!waOn}
                        aria-label={`${c.label} WhatsApp`}
                        className="h-4 w-4 accent-[#D7FF3A]"
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        name={`push:${c.key}`}
                        defaultChecked={mode(c.key, "PUSH") === "IMMEDIATE"}
                        disabled={!devices?.length}
                        aria-label={`${c.label} push`}
                        className="h-4 w-4 accent-[#D7FF3A]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="sticky bottom-4 mt-4">
          <button className="btn-primary shadow-lg">Save preferences</button>
        </div>
      </form>
    </>
  );
}
