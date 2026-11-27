import { afterEach, describe, expect, it, vi } from "vitest";
import { chatFilePath, formatSize, previewKind, uploadWithProgress } from "@/lib/chat-upload";

describe("chat upload helpers", () => {
  it("picks a preview type", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("audio/mpeg")).toBe("audio");
    expect(previewKind("application/octet-stream", "Brief.PDF")).toBe("pdf");
    expect(previewKind("application/zip", "a.zip")).toBe("file");
  });
  it("formats sizes", () => {
    expect(formatSize(300)).toBe("1 KB");
    expect(formatSize(2.5 * 1048576)).toBe("2.5 MB");
  });
  it("builds a safe storage path", () => {
    expect(chatFilePath("o", "c", "e", "my file (1).jpg", "u")).toBe("o/c/e/u-my_file__1_.jpg");
  });
});

class FakeXHR {
  static last: FakeXHR;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  headers: Record<string, string> = {};
  url = "";
  status = 0;
  responseText = "";
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.last = this;
  }
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {}
  abort() {
    this.onabort?.();
  }
}

describe("uploadWithProgress", () => {
  afterEach(() => vi.unstubAllGlobals());
  const base = {
    supabaseUrl: "https://x.supabase.co/",
    anonKey: "anon",
    accessToken: "tok",
    bucket: "chat-files",
    path: "o/c/e/u-a b.png",
  };

  it("reports progress and resolves on success, with the user's token", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const seen: number[] = [];
    const up = uploadWithProgress({ ...base, file: new File(["x"], "a b.png", { type: "image/png" }), onProgress: (p) => seen.push(p) });
    const x = FakeXHR.last;
    expect(x.url).toBe("https://x.supabase.co/storage/v1/object/chat-files/o/c/e/u-a%20b.png");
    expect(x.headers.Authorization).toBe("Bearer tok");
    x.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
    x.status = 200;
    x.onload!();
    await up.promise;
    expect(seen).toEqual([50, 100]);
  });

  it("rejects with the storage error message", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const up = uploadWithProgress({ ...base, file: new File(["x"], "a.png"), onProgress: () => {} });
    FakeXHR.last.status = 403;
    FakeXHR.last.responseText = JSON.stringify({ message: "new row violates row-level security policy" });
    FakeXHR.last.onload!();
    await expect(up.promise).rejects.toThrow("row-level security");
  });

  it("can be cancelled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const up = uploadWithProgress({ ...base, file: new File(["x"], "a.png"), onProgress: () => {} });
    up.abort();
    await expect(up.promise).rejects.toThrow("cancelled");
  });
});
