"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export interface ProfileMenuProps {
  id: string;
  name: string;
  short: string;
  subtitle: string;
  initials: string;
  photo: string | null;
  code?: string | null;
  email: string;
  links: { href: string; label: string }[];
}

/** Top-right profile chip: avatar + "Sushant M." + post/Owner. Opens a menu with what this person may open. */
export function ProfileMenu(p: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Avatar = ({ size }: { size: string }) =>
    p.photo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={p.photo} alt="" className={clsx(size, "rounded-full object-cover")} />
    ) : (
      <span className={clsx(size, "grid place-items-center rounded-full bg-volt text-xs font-bold text-[#0b0b0c]")}>{p.initials}</span>
    );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 rounded-full border border-line bg-panel py-1 pl-1 pr-4 text-left transition hover:border-volt/50"
      >
        <Avatar size="h-9 w-9" />
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-semibold leading-tight">{p.short}</span>
          <span className="block truncate text-[11px] leading-tight text-muted">{p.subtitle}</span>
        </span>
        <span className={clsx("text-xs text-muted transition", open && "rotate-180")} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl rise"
        >
          <div className="flex items-center gap-3 border-b border-line p-4">
            <Avatar size="h-12 w-12" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="truncate text-xs text-muted">
                {p.subtitle}
                {p.code ? ` · ${p.code}` : ""}
              </p>
              <p className="truncate text-xs text-muted">{p.email}</p>
            </div>
          </div>
          <nav className="p-2">
            {p.links.map((l) => (
              <Link key={l.href} href={l.href} role="menuitem" className="block rounded-lg px-3 py-2 text-sm hover:bg-ink/[0.05]">
                {l.label}
              </Link>
            ))}
          </nav>
          <form action="/auth/signout" method="post" className="border-t border-line p-2">
            <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/10">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
