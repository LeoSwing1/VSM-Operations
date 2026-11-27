"use client";
import { useEffect, useState } from "react";
import { openChannel } from "@/lib/supabase/browser";

/**
 * Notification tones, made with the Web Audio API (no sound files to load).
 *  - "message": a soft two-note chime for new chat messages
 *  - "alert": a single brighter ping for everything else (approvals, tasks, KYC, reports…)
 * Muting is per browser ("vsm-sound" in localStorage). Only one open tab plays a given tone.
 */
const KEY = "vsm-sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

function note(ac: AudioContext, freq: number, start: number, length: number, peak: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Play a tone now (respects mute; one tab only within 1.2 s). */
export function playTone(kind: "message" | "alert" | "soft" = "message", force = false) {
  if (!force && !soundOn()) return;
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem("vsm-sound-last") ?? 0);
    if (!force && now - last < 1200) return; // another tab already chimed
    localStorage.setItem("vsm-sound-last", String(now));
  } catch {
    /* storage off: still play */
  }
  const ac = audio();
  if (!ac) return;
  void ac.resume().then(() => {
    const t = ac.currentTime + 0.01;
    if (kind === "message") {
      // Two-note "ding-dong", loud enough to hear over music / a fan.
      note(ac, 987.8, t, 0.22, 0.5); // B5
      note(ac, 1975.5, t, 0.12, 0.12); // overtone for brightness
      note(ac, 1318.5, t + 0.14, 0.45, 0.45); // E6
    } else if (kind === "soft") {
      note(ac, 1318.5, t, 0.16, 0.2); // gentle tick for the chat you're already reading
    } else {
      note(ac, 1046.5, t, 0.3, 0.5); // C6
      note(ac, 1568, t + 0.12, 0.4, 0.4); // G6
    }
  });
}

/** Listens for new notifications addressed to me and plays the right tone. Renders nothing. */
export function NotificationSound({ employeeId }: { employeeId: string }) {
  useEffect(() => {
    // Browsers only allow sound after the person has interacted with the page once.
    const unlock = () => {
      void audio()?.resume();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    return openChannel(`sound:${employeeId}`, (channel) =>
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${employeeId}` },
        (p) => {
          const row = p.new as { category?: string; link?: string | null; title?: string; body?: string | null };
          const chat = !!row.category?.startsWith("CHAT");
          const looking = document.visibilityState === "visible" && !!row.link && row.link === window.location.pathname;
          // Reading that conversation already: a gentle tick. Anything else: the full tone.
          playTone(looking ? "soft" : chat ? "message" : "alert");
          // Tab in the background: also a system notification (with the OS sound) if the person allowed alerts.
          if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
            try {
              const n = new Notification(row.title ?? "VSM Operations", {
                body: (row.body ?? "").slice(0, 140),
                tag: row.link ?? undefined,
                icon: "/icons/icon-192.png",
              });
              n.onclick = () => {
                window.focus();
                if (row.link) window.location.assign(row.link);
                n.close();
              };
            } catch {
              /* some browsers only allow notifications from a service worker */
            }
          }
        },
      ),
    );
  }, [employeeId]);
  return null;
}

/** Header button: sound on / off (plays a sample when turned on). */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    setOn(soundOn());
    // Browsers keep audio muted until the first click/tap on the page.
    const ac = audio();
    if (ac && ac.state !== "running") {
      setLocked(true);
      const unlock = () => void ac.resume().then(() => setLocked(false));
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      return () => {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      };
    }
  }, []);
  return (
    <button
      type="button"
      className="relative grid h-9 w-9 place-items-center rounded-full border border-line text-base hover:border-volt"
      aria-label={on ? "Mute notification sounds" : "Turn notification sounds on"}
      title={
        on
          ? locked
            ? "Sound is on — click anywhere on the page once so the browser allows it"
            : "Notification sound: on"
          : "Notification sound: off"
      }
      onClick={() => {
        const next = !on;
        setOn(next);
        try {
          localStorage.setItem(KEY, next ? "on" : "off");
        } catch {
          /* ignore */
        }
        if (next) {
          playTone("message", true);
          if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
        }
      }}
    >
      <span aria-hidden>{on ? "🔔" : "🔕"}</span>
      {on && locked && (
        <span
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-ember"
          title="Click anywhere to enable sound"
        />
      )}
    </button>
  );
}
