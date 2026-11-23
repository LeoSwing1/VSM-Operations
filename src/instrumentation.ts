/**
 * Next.js instrumentation: every unhandled server error (pages, server actions, route handlers) is recorded in
 * public.app_errors so it shows up in the Operations Center. Messages only — no request bodies, no cookies.
 */
export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const e = err as Error & { digest?: string };
    // Expected control flow in Next (redirect / notFound) is not an error.
    if (e?.digest?.startsWith("NEXT_REDIRECT") || e?.digest === "NEXT_NOT_FOUND" || e?.digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
      return;
    const { recordAppError } = await import("./lib/app-errors");
    await recordAppError({
      kind: context.routeType === "action" ? "ACTION" : request.path.startsWith("/api/cron") ? "CRON" : "SERVER",
      path: request.path.split("?")[0]!,
      method: request.method,
      message: e?.message ?? String(err),
      digest: e?.digest ?? null,
      stack: e?.stack ?? null,
    });
  } catch {
    /* never let error logging break the response */
  }
}
