import Link from "next/link";
import clsx from "clsx";

const TABS = [
  ["/growth", "OKRs"],
  ["/growth/kpis", "KPIs"],
  ["/growth/reviews", "360° reviews"],
  ["/growth/training", "Training"],
] as const;

export function GrowthNav({ active }: { active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Performance & growth">
      {TABS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={href === active ? "page" : undefined}
          className={clsx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            href === active ? "border-volt text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export const CONF_TONE = { ON_TRACK: "green", AT_RISK: "amber", OFF_TRACK: "red" } as const;

export function Progress({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0;
  return (
    <div className="min-w-[8rem]">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{value === null ? "–" : `${v}%`}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={clsx("h-full rounded-full", v >= 70 ? "bg-volt" : v >= 40 ? "bg-signal" : "bg-ember")} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
