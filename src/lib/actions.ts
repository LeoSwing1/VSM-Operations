import "server-only";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";

/** Redirect back with a flash message (works without client JS). */
export function flash(path: string, kind: "ok" | "err", msg: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(msg)}`);
}

/** Turn DB errors into safe, human messages. Business-rule exceptions raised in SQL are shown; internals are not. */
export function dbMessage(e: PostgrestError | null | undefined, fallback = "Something went wrong."): string {
  if (!e) return fallback;
  if (e.code === "P0001" || e.code === "42501" || e.code === "P0002") return capitalise(e.message);
  if (e.code === "23505") return "That record already exists.";
  if (e.code === "23P01") return "That overlaps with an existing record.";
  if (e.code === "23514") return "Some values are outside the allowed range.";
  if (e.message?.includes("row-level security")) return "You are not allowed to do that.";
  console.error("[db]", e.code, e.message);
  return fallback;
}

function capitalise(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
export function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v === "" ? null : v; }
export function num(fd: FormData, k: string): number | null {
  const v = str(fd, k); if (v === "") return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
