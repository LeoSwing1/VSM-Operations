import Link from "next/link";
import clsx from "clsx";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between rise">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-4xl sm:text-5xl lg:text-6xl break-words">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

export function Card({
  title,
  hint,
  action,
  className,
  children,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={clsx("card p-5 sm:p-6 rise", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="eyebrow">{title}</h2>}
            {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "volt" | "ember" | "danger" | "signal";
  href?: string;
}) {
  const body = (
    <div className={clsx("card h-full p-5 transition", href && "hover:border-ink/30")}>
      <p className="eyebrow">{label}</p>
      <p
        className={clsx(
          "display mt-3 text-4xl sm:text-5xl tabular-nums",
          tone === "volt" && "text-volt",
          tone === "ember" && "text-ember",
          tone === "danger" && "text-danger",
          tone === "signal" && "text-signal",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

const TONES: Record<string, string> = {
  green: "border-volt/40 text-volt",
  red: "border-danger/50 text-danger",
  amber: "border-ember/50 text-ember",
  blue: "border-signal/50 text-signal",
  grey: "border-line text-muted",
};
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  PRESENT: "green",
  APPROVED: "green",
  COMPLETED: "green",
  PAID: "green",
  WON: "green",
  ACTIVE: "green",
  SENT: "green",
  EXCEPTIONAL: "green",
  EXCELLENT: "green",
  HALF_DAY: "amber",
  PENDING: "amber",
  REVIEW: "amber",
  INCOMPLETE: "amber",
  HALF_LEAVE: "amber",
  DRAFT: "grey",
  NEEDS_IMPROVEMENT: "amber",
  PROCESSED: "blue",
  IN_PROGRESS: "blue",
  LEAVE: "blue",
  GOOD: "blue",
  QUALIFIED: "blue",
  PROPOSAL: "blue",
  NEGOTIATION: "blue",
  CONTACTED: "blue",
  NEW: "amber",
  QUEUED: "amber",
  ABSENT: "red",
  REJECTED: "red",
  BLOCKED: "red",
  LOST: "red",
  UNSATISFACTORY: "red",
  FAILED: "red",
  OVERDUE: "red",
};
export function Badge({ children, tone }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  const text = (Array.isArray(children) ? children : [children])
    .map((c) => (c === null || c === undefined || c === false ? "" : String(c)))
    .join("");
  const t = tone ?? STATUS_TONE[text] ?? "grey";
  return <span className={clsx("chip", TONES[t])}>{text.replaceAll("_", " ")}</span>;
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.err === "string" ? sp.err : null;
  if (!ok && !err) return null;
  return (
    <div
      role="status"
      className={clsx(
        "mb-6 rounded-xl border px-4 py-3 text-sm rise",
        ok ? "border-volt/40 bg-volt/10 text-volt" : "border-danger/50 bg-danger/10 text-danger",
      )}
    >
      {ok ?? err}
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-2xl">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">{children}</div>;
}

/** Minimal, accessible bar chart (server-rendered SVG — no client JS). */
export function Bars({
  data,
  max,
  suffix = "",
  label,
}: {
  data: { label: string; value: number | null }[];
  max?: number;
  suffix?: string;
  label: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  return (
    <figure aria-label={label}>
      <div className="flex h-40 items-end gap-1.5 sm:gap-2">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${d.label}: ${d.value ?? "no data"}${suffix}`}
          >
            <span className="mb-1 truncate text-center text-[10px] tabular-nums text-muted">
              {d.value === null ? "–" : Math.round(d.value)}
            </span>
            <div
              className={clsx("w-full rounded-t-md", d.value === null ? "bg-line/50" : "bg-volt")}
              style={{ height: `${d.value === null ? 4 : Math.max(3, (d.value / top) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2">
        {data.map((d) => (
          <span key={d.label} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

export function Meter({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{value === null ? "No data" : `${value}%`}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuenow={value ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={clsx("h-full rounded-full", value === null ? "" : value >= 80 ? "bg-volt" : value >= 60 ? "bg-signal" : "bg-ember")}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: string }[]; active: string; base: string }) {
  return (
    <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line pb-px" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={clsx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            t.key === active ? "border-volt text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const inr = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "–" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
