import Link from "next/link";
import clsx from "clsx";

const TABS = [
  ["/scholars", "Overview"],
  ["/scholars/students", "Students"],
  ["/scholars/batches", "Batches"],
  ["/scholars/fees", "Fees"],
  ["/scholars/courses", "Courses"],
] as const;
export function ScholarsNav({ active }: { active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="VSM Scholars">
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
export const STAGE_TONE: Record<string, "green" | "amber" | "grey" | "red"> = {
  ENQUIRY: "amber",
  COUNSELLED: "amber",
  DEMO: "amber",
  ENROLLED: "green",
  ALUMNI: "green",
  DROPPED: "grey",
  LOST: "red",
};
export const STAGES = ["ENQUIRY", "COUNSELLED", "DEMO", "ENROLLED", "ALUMNI", "DROPPED", "LOST"] as const;
export const SOURCES = ["WALK_IN", "WEBSITE", "INSTAGRAM", "REFERRAL", "AFFILIATE", "CAMPAIGN", "OTHER"] as const;
export const rupees = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
