"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { NavItem } from "./shell";
import { RealtimeUnread } from "@/components/notifications/realtime-unread";
import { ChatUnread } from "@/components/notifications/chat-unread";

export function NavLinks({ items, unread, employeeId }: { items: NavItem[]; unread: number; employeeId: string }) {
  const path = usePathname();
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav aria-label="Primary" className="space-y-6">
      {groups.map((g) => (
        <div key={g}>
          <p className="eyebrow mb-2 px-2">{g}</p>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => {
                const active =
                  path === i.href ||
                  (i.href !== "/dashboard" &&
                    path.startsWith(i.href + "/") &&
                    !(i.href === "/projects" && path.startsWith("/projects/time")));
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition",
                        active ? "bg-ink text-paper font-semibold" : "text-ink/80 hover:bg-ink/5 hover:text-ink",
                      )}
                    >
                      {i.label}
                      {i.href === "/notifications" && <RealtimeUnread employeeId={employeeId} initialUnread={unread} />}
                      {i.href === "/chat" && <ChatUnread employeeId={employeeId} />}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.classList.contains("light")), []);
  return (
    <button
      type="button"
      aria-label="Toggle colour theme"
      className="text-xs text-muted hover:text-ink"
      onClick={() => {
        const next = !light;
        setLight(next);
        document.documentElement.classList.toggle("light", next);
        try {
          localStorage.setItem("vsm-theme", next ? "light" : "dark");
        } catch {
          /* storage unavailable */
        }
      }}
    >
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}

export function MobileMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // page behind doesn't scroll while the menu is open
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        className="btn-ghost px-3 py-1.5"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {/* Portal to <body>: the sticky top bar uses backdrop-blur, which would otherwise trap this fixed panel inside the bar. */}
      {open &&
        createPortal(
          <div
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-x-0 bottom-0 top-[57px] z-40 overflow-y-auto overscroll-contain bg-paper p-5 lg:hidden"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
