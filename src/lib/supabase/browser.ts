"use client";
/**
 * Browser Supabase client — used ONLY for Realtime (chat, presence, typing, live notifications).
 *
 * Session cookies are HttpOnly, so this client can't read them. Instead it asks the server for the
 * current short-lived access token (GET /api/realtime/token) and hands it to Realtime with setAuth().
 * The refresh token never reaches the browser. All data writes still go through server actions.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let expiresAtMs = 0;
let pending: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase browser configuration is missing.");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

/** Make sure Realtime carries a valid user token; refreshes ~2 minutes before it expires. */
export async function ensureRealtimeAuth(): Promise<void> {
  if (Date.now() < expiresAtMs - 120_000) return;
  if (!pending) {
    pending = (async () => {
      const r = await fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error(`Realtime authorisation failed (${r.status})`);
      const { access_token, expires_at } = (await r.json()) as { access_token: string; expires_at: number };
      await supabaseBrowser().realtime.setAuth(access_token);
      expiresAtMs = expires_at * 1000;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => void ensureRealtimeAuth().catch(() => undefined),
        Math.max(30_000, expiresAtMs - Date.now() - 120_000),
      );
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}

type SubscribeCallback = Parameters<RealtimeChannel["subscribe"]>[0];

/** Subscribe only after the user's token is set, so private channels and RLS see the real user. */
export function subscribeWithAuth(channel: RealtimeChannel, callback?: SubscribeCallback): () => void {
  let cancelled = false;
  ensureRealtimeAuth()
    .then(() => {
      if (!cancelled) channel.subscribe(callback);
    })
    .catch((e: unknown) => callback?.("CHANNEL_ERROR" as Parameters<NonNullable<SubscribeCallback>>[0], e as Error));
  return () => {
    cancelled = true;
  };
}

const closing = new Map<string, Promise<void>>();

/**
 * Safe way to open a Realtime channel from a React effect.
 * supabase-js returns an EXISTING channel when the topic is already registered, so a quick unmount → remount
 * (React dev Strict Mode, fast navigation) used to hand back an already-subscribed channel and crash with
 * "cannot add postgres_changes callbacks after subscribe()". Here every open waits until the previous channel
 * with the same topic is fully removed, then builds a brand-new one.
 */
export function openChannel(
  name: string,
  build: (channel: RealtimeChannel) => RealtimeChannel | void,
  options?: { config?: Record<string, unknown>; onStatus?: SubscribeCallback },
): () => void {
  const client = supabaseBrowser();
  const topic = `realtime:${name}`;
  let channel: RealtimeChannel | null = null;
  let stopAuth: (() => void) | null = null;
  let stopped = false;
  void (async () => {
    await closing.get(topic);
    if (stopped) return;
    const stale = client.getChannels().find((c) => c.topic === topic);
    if (stale) await release(stale);
    if (stopped) return;
    channel = client.channel(name, options?.config ? { config: options.config } : undefined);
    build(channel);
    stopAuth = subscribeWithAuth(channel, options?.onStatus);
  })();
  async function release(ch: RealtimeChannel) {
    try {
      await client.removeChannel(ch);
    } catch {
      /* already gone */
    }
    const rt = client.realtime as unknown as { _remove?: (c: RealtimeChannel) => void };
    if (client.getChannels().includes(ch)) rt._remove?.(ch);
  }
  return () => {
    stopped = true;
    stopAuth?.();
    if (channel) {
      const ch = channel;
      const p = release(ch).finally(() => {
        if (closing.get(topic) === p) closing.delete(topic);
      });
      closing.set(topic, p);
    }
  };
}
