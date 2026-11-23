"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin volt bar at the top while something is working: any form submit (server actions, sign-out…) or an
 * internal link click. Stops when the page changes or after 15 s. Pure UX — no data involved.
 */
export function ProgressBar() {
  const [active, setActive] = useState(false);
  const path = usePathname();
  const sp = useSearchParams();
  useEffect(() => setActive(false), [path, sp]);
  useEffect(() => {
    let t: number | undefined;
    const start = () => {
      setActive(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setActive(false), 15000);
    };
    const onSubmit = (e: Event) => {
      if (!(e as SubmitEvent).defaultPrevented) start();
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && (url.pathname !== location.pathname || url.search !== location.search)) start();
    };
    const stop = () => setActive(false);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("vsm:done", stop);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("vsm:done", stop);
      window.clearTimeout(t);
    };
  }, []);
  return <div aria-hidden className={`vsm-progress ${active ? "is-active" : ""}`} />;
}
