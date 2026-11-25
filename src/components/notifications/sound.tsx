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
export function playTone(kind: "message" | "alert" = "message", force = false) {
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
      note(ac, 880, t, 0.18, 0.18); // A5
      note(ac, 1318.5, t + 0.11, 0.32, 0.16); // E6
    } else {
      note(ac, 1046.5, t, 0.28, 0.2); // C6
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
          const row = p.new as { category?: string; link?: string | null };
          // Already looking at that conversation in this tab: the message appears on screen, no need to ping.
          if (document.visibilityState === "visible" && row.link && row.link === window.location.pathname) return;
          playTone(row.category?.startsWith("CHAT") ? "message" : "alert");
        },
      ),
    );
  }, [employeeId]);
  return null;
}

/** Header button: sound on / off (plays a sample when turned on). */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(soundOn()), []);
  return (
    <button
      type="button"
      className="grid h-9 w-9 place-items-center rounded-full border border-line text-base hover:border-volt"
      aria-label={on ? "Mute notification sounds" : "Turn notification sounds on"}
      title={on ? "Notification sound: on" : "Notification sound: off"}
      onClick={() => {
        const next = !on;
        setOn(next);
        try {
          localStorage.setItem(KEY, next ? "on" : "off");
        } catch {
          /* ignore */
        }
        if (next) playTone("message", true);
      }}
    >
      <span aria-hidden>{on ? "🔔" : "🔕"}</span>
    </button>
  );
}
