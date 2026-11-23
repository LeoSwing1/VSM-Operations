"use client";
import { useState } from "react";

/** Fills the latitude/longitude inputs with the admin's current position — stand inside the office and click. */
export function UseMyLocation() {
  const [state, setState] = useState("");
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      onClick={() => {
        if (!("geolocation" in navigator)) return setState("This browser has no location.");
        setState("Locating…");
        navigator.geolocation.getCurrentPosition(
          (p) => {
            (document.getElementById("office-lat") as HTMLInputElement).value = p.coords.latitude.toFixed(6);
            (document.getElementById("office-lng") as HTMLInputElement).value = p.coords.longitude.toFixed(6);
            setState(`Got it (±${Math.round(p.coords.accuracy)} m)`);
          },
          () => setState("Location blocked — allow it in the browser."),
          { enableHighAccuracy: true, timeout: 10000 },
        );
      }}
    >
      📍 Use my current location {state && <span className="ml-1 text-muted">· {state}</span>}
    </button>
  );
}
