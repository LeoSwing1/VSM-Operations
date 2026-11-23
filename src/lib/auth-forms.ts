import { NextResponse, type NextRequest } from "next/server";

/** Plain-HTML form posts (no client JS needed). Same-origin only, and always answered with a 303 redirect. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}
export const go = (req: NextRequest, path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), 303);
export const msg = (path: string, kind: "err" | "ok", text: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`;
