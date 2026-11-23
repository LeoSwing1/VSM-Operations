"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { openChannel } from "@/lib/supabase/browser";

/**
 * Live sync: re-renders this page as soon as any row you are allowed to see changes in the given tables
 * (Supabase Realtime respects RLS). Debounced so bursts of changes cause one refresh.
 */
export function LiveSync({ tables, filter, debounceMs = 700 }: { tables: string[]; filter?: string; debounceMs?: number }) {
  const router = useRouter();
  const t = useRef<number | null>(null);
  const key = tables.join(",") + (filter ?? "");
  useEffect(() => {
    const stop = openChannel(`live:${key}`, (channel) => {
      for (const table of tables)
        channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
          if (t.current) window.clearTimeout(t.current);
          t.current = window.setTimeout(() => router.refresh(), debounceMs);
        });
    });
    return () => {
      stop();
      if (t.current) window.clearTimeout(t.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router, debounceMs]);
  return null;
}
