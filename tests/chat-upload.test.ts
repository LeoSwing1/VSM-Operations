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

import { RESUMABLE_FROM, MAX_CHAT_FILE, storageHost, uploadResumable } from "@/lib/chat-upload";

const tusState: { opts?: any; aborted?: boolean } = {};
vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_f: unknown, opts: any) {
      tusState.opts = opts;
    }
    findPreviousUploads() {
      return Promise.resolve([]);
    }
    resumeFromPreviousUpload() {}
    start() {}
    abort() {
      tusState.aborted = true;
      return Promise.resolve();
    }
  },
}));

describe("large files (resumable)", () => {
  it("allows up to 10 GB and switches to chunks above 6 MB", () => {
    expect(MAX_CHAT_FILE).toBe(10 * 1024 ** 3);
    expect(RESUMABLE_FROM).toBe(6 * 1024 ** 2);
    expect(formatSize(3.5 * 1024 ** 3)).toBe("3.50 GB");
  });
  it("uses Supabase's direct storage host", () => {
    expect(storageHost("https://abcd1234.supabase.co/")).toBe("https://abcd1234.storage.supabase.co");
    expect(storageHost("https://db.example.com")).toBe("https://db.example.com");
  });
  it("sends 6 MB chunks with the user's token, reports progress and finishes", async () => {
    const seen: number[] = [];
    const up = uploadResumable({
      supabaseUrl: "https://abcd1234.supabase.co",
      accessToken: "tok",
      bucket: "chat-files",
      path: "o/c/e/u-cut.mov",
      getToken: async () => "fresh-tok",
      file: new File(["x"], "cut.mov", { type: "video/quicktime" }),
      onProgress: (p) => seen.push(p),
    });
    await vi.waitFor(() => expect(tusState.opts).toBeTruthy());
    expect(tusState.opts.endpoint).toBe("https://abcd1234.storage.supabase.co/storage/v1/upload/resumable");
    expect(tusState.opts.chunkSize).toBe(6 * 1024 * 1024);
    expect(tusState.opts.headers.authorization).toBe("Bearer tok");
    expect(tusState.opts.metadata).toMatchObject({
      bucketName: "chat-files",
      objectName: "o/c/e/u-cut.mov",
      contentType: "video/quicktime",
    });
    const hdr: Record<string, string> = {};
    await tusState.opts.onBeforeRequest({ setHeader: (k: string, v: string) => (hdr[k] = v) });
    expect(hdr.authorization).toBe("Bearer fresh-tok"); // long uploads get a fresh login token per chunk
    tusState.opts.onProgress(3, 4);
    tusState.opts.onSuccess();
    await up.promise;
    expect(seen).toEqual([75, 100]);
  });
  it("explains a storage size-limit rejection", async () => {
    tusState.opts = undefined;
    const up = uploadResumable({
      supabaseUrl: "https://abcd1234.supabase.co",
      accessToken: "tok",
      bucket: "chat-files",
      path: "o/c/e/u-big.mov",
      file: new File(["x"], "big.mov"),
      onProgress: () => {},
    });
    await vi.waitFor(() => expect(tusState.opts).toBeTruthy());
    tusState.opts.onError(new Error("response code: 413, The object exceeded the maximum allowed size"));
    await expect(up.promise).rejects.toThrow("Global file size limit");
  });
});
