import "server-only";
import { randomBytes } from "node:crypto";
import type { GoogleConnection } from "./oauth";
import { googleFetch } from "./oauth";

/** Multipart upload into a Drive folder. With the drive.file scope the app only ever sees files it created. */
export async function uploadToDrive(c: GoogleConnection, folderId: string, name: string, mime: string, bytes: Uint8Array) {
  const boundary = `vsm_${randomBytes(10).toString("hex")}`;
  const meta = JSON.stringify({ name: name.slice(0, 200), parents: [folderId], description: "Uploaded from VSM Ops" });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await googleFetch(
    c,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (r.status === 404) throw new Error("Drive folder not found — check the folder ID and that the connected account can add files to it.");
  return (await r.json()) as { id: string; webViewLink?: string };
}
