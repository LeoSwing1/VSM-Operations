import Link from "next/link";
import { connectionChecks } from "@/lib/status";
import { VsmMark } from "@/components/brand";

export const metadata = { title: "System status" };
export const dynamic = "force-dynamic";

export default async function Status() {
  const checks = await connectionChecks();
  const ok = checks.every((c) => c.ok);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <VsmMark className="text-4xl" sub={false} />
      <div>
        <p className="eyebrow">Connection test</p>
        <h1 className="display mt-2 text-4xl">{ok ? "All systems working" : "Something needs attention"}</h1>
      </div>
      <ul className="card divide-y divide-line">
        {checks.map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${c.ok ? "bg-volt" : "bg-danger"}`} />
              {c.name}
            </span>
            <span className="text-right text-xs text-muted">
              {c.detail} · {c.ms} ms
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-3 text-sm">
        <Link href="/login" className="btn-primary">
          Back to sign in
        </Link>
        <Link href="/login?forgot=1" className="btn-ghost">
          Reset password
        </Link>
      </div>
      <p className="text-xs text-muted">This page shows only whether each service answers. It never shows keys or account details.</p>
    </main>
  );
}
