"use client";
import { useEffect } from "react";
/** Registers the service worker (offline page + push). Harmless if push is never enabled. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
