/**
 * Chat attachment upload with real progress. supabase-js storage.upload() reports none, so this posts straight
 * to the Storage REST endpoint with XHR (same auth: the signed-in user's token, so storage policies still apply).
 */
export const MAX_CHAT_FILE = 50 * 1024 * 1024;

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "file";

export function previewKind(mime: string, name = ""): PreviewKind {
  if (/^image\/(jpeg|png|webp|gif|avif|bmp|svg\+xml)$/.test(mime)) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  return "file";
}

export function formatSize(bytes: number): string {
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
