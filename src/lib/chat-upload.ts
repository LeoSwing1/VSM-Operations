/**
 * Chat attachment upload with real progress. supabase-js storage.upload() reports none, so this posts straight
 * to the Storage REST endpoint with XHR (same auth: the signed-in user's token, so storage policies still apply).
 */
export const MAX_CHAT_FILE = 10 * 1024 * 1024 * 1024; // 10 GB (needs Supabase Pro + Storage global limit ≥ 10 GB)
/** Above this, files go up in resumable 6 MB chunks (Supabase TUS): survives dropped connections, no 50 MB cap. */
export const RESUMABLE_FROM = 6 * 1024 * 1024;

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "file";

export function previewKind(mime: string, name = ""): PreviewKind {
  if (/^image\/(jpeg|png|webp|gif|avif|bmp|svg\+xml)$/.test(mime)) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  return "file";
}

export function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Storage object path: org/channel/author/uuid-safeName */
export function chatFilePath(orgId: string, channelId: string, employeeId: string, name: string, id: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "file";
  return `${orgId}/${channelId}/${employeeId}/${id}-${safe}`;
}

export function uploadWithProgress(opts: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  bucket: string;
  path: string;
  file: File;
  onProgress: (pct: number) => void;
}): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const url = `${opts.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${opts.bucket}/${opts.path.split("/").map(encodeURIComponent).join("/")}`;
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${opts.accessToken}`);
    xhr.setRequestHeader("apikey", opts.anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", opts.file.type || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress(100);
        resolve();
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          msg = j.message || j.error || msg;
        } catch {
          /* not JSON */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading — check your connection and try again."));
    xhr.onabort = () => reject(new Error("cancelled"));
    xhr.send(opts.file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** https://<ref>.supabase.co → https://<ref>.storage.supabase.co (Supabase's faster host for big uploads). */
export function storageHost(supabaseUrl: string): string {
  const u = supabaseUrl.replace(/\/+$/, "");
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(u);
  return m ? `https://${m[1]}.storage.supabase.co` : u;
}

/** Resumable (TUS) upload for large files. Same auth and storage rules as a normal upload. */
export function uploadResumable(opts: {
  supabaseUrl: string;
  accessToken: string;
  getToken?: () => Promise<string>;
  bucket: string;
  path: string;
  file: File;
  onProgress: (pct: number) => void;
}): { promise: Promise<void>; abort: () => void } {
  let stop: () => void = () => {};
  let cancelled = false;
  const promise = import("tus-js-client").then(
    ({ Upload }) =>
      new Promise<void>((resolve, reject) => {
        const up = new Upload(opts.file, {
          endpoint: `${storageHost(opts.supabaseUrl)}/storage/v1/upload/resumable`,
          retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
          headers: { authorization: `Bearer ${opts.accessToken}`, "x-upsert": "false" },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: opts.bucket,
            objectName: opts.path,
            contentType: opts.file.type || "application/octet-stream",
            cacheControl: "3600",
          },
          chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
          // Big uploads can outlast the 1-hour login token: put a fresh one on every chunk.
          onBeforeRequest: async (req) => {
            if (opts.getToken) req.setHeader("authorization", `Bearer ${await opts.getToken()}`);
          },
          onProgress: (sent, total) => opts.onProgress(Math.min(99, Math.floor((sent / Math.max(1, total)) * 100))),
          onSuccess: () => {
            opts.onProgress(100);
            resolve();
          },
          onError: (err) => {
            const raw = String((err as Error)?.message ?? err);
            reject(
              new Error(
                /413|maximum allowed size|too large|exceeded/i.test(raw)
                  ? "This file is bigger than the storage limit set in Supabase (Storage → Settings → Global file size limit)."
                  : raw.length > 200
                    ? "Upload failed — check your connection and try again."
                    : raw,
              ),
            );
          },
        });
        stop = () => {
          cancelled = true;
          void up.abort(true);
          reject(new Error("cancelled"));
        };
        if (cancelled) return stop();
        void up.findPreviousUploads().then((prev) => {
          if (prev.length) up.resumeFromPreviousUpload(prev[0]!);
          up.start();
        });
      }),
  );
  return {
    promise,
    abort: () => {
      cancelled = true;
      stop();
    },
  };
}

/** Unique id that also works on plain-http pages (crypto.randomUUID needs https). */
export function uploadId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Delete an uploaded-but-unsent file (the uploader may delete their own objects). Best effort. */
export async function removeUploaded(opts: { supabaseUrl: string; anonKey: string; accessToken: string; bucket: string; path: string }) {
  try {
    await fetch(`${opts.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${opts.bucket}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${opts.accessToken}`, apikey: opts.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [opts.path] }),
    });
  } catch {
    /* ignore: an orphaned file is harmless */
  }
}
