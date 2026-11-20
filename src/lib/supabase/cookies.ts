/**
 * Session cookies are server-only. The app never creates a browser Supabase client
 * (src/lib/supabase/browser.ts was removed on purpose), so JavaScript in the page never
 * needs — and can never read — the access or refresh token.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function hardenCookie<T extends Record<string, unknown> | undefined>(options: T) {
  return { ...(options ?? {}), ...AUTH_COOKIE_OPTIONS };
}
