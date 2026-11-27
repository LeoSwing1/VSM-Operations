import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("upload login token (cookies are HttpOnly)", () => {
  it("gets the token from the server, not from cookies", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access_token: "tok-123", expires_at: Math.floor(Date.now() / 1000) + 3600 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getAccessToken } = await import("@/lib/supabase/browser");
    expect(await getAccessToken()).toBe("tok-123");
    expect(fetchMock).toHaveBeenCalledWith("/api/realtime/token", expect.objectContaining({ credentials: "same-origin" }));
    await getAccessToken(); // cached until ~2 minutes before expiry
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains an expired login instead of failing silently", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { getAccessToken } = await import("@/lib/supabase/browser");
    await expect(getAccessToken()).rejects.toThrow("session expired");
  });
});

describe("upload helpers", () => {
  it("makes valid ids even without crypto.randomUUID (plain http on a phone)", async () => {
    const { uploadId } = await import("@/lib/chat-upload");
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => b.fill(7) });
    expect(uploadId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("deletes an unsent upload with the user's token", async () => {
    const { removeUploaded } = await import("@/lib/chat-upload");
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await removeUploaded({
      supabaseUrl: "https://x.supabase.co",
      anonKey: "anon",
      accessToken: "tok",
      bucket: "chat-files",
      path: "o/c/e/u-a.png",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/storage/v1/object/chat-files");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ prefixes: ["o/c/e/u-a.png"] });
  });
});
