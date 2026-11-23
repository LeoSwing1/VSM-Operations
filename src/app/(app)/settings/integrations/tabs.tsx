import Link from "next/link";
import clsx from "clsx";

const TABS = [
  ["/settings/integrations", "Health & core"],
  ["/settings/integrations/channels", "Channels"],
  ["/settings/integrations/google", "Google"],
  ["/settings/integrations/webhooks", "Webhooks"],
  ["/settings/integrations/inbound", "Inbound events"],
] as const;

export function IntegrationTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Integration sections">
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
