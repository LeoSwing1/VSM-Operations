"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sanitizePath } from "@/lib/delivery/messages";

/**
 * Privacy-first product analytics (PostHog capture API, no SDK, no cookies).
 * Sends only: sanitized path (ids collapsed), role level band and a random per-browser id.
 * No names, emails, phone numbers, query strings or amounts. Honours Do-Not-Track.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com").replace(/\/$/, "");

function anonId() {
  try {
    let id = localStorage.getItem("vsm_anon");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("vsm_anon", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export function Analytics({ band }: { band: string }) {
  const path = usePathname();
  useEffect(() => {
    if (!KEY || navigator.doNotTrack === "1") return;
    const body = JSON.stringify({
      api_key: KEY,
      event: "$pageview",
      distinct_id: anonId(),
      properties: { $current_url: sanitizePath(path), path: sanitizePath(path), band, $process_person_profile: false },
    });
    const url = `${HOST}/capture/`;
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" })))
      void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
  }, [path, band]);
  return null;
}
