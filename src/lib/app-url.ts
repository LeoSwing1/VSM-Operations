/**
 * Public address of the app, used in email buttons and auth redirects.
 * APP_URL (Vercel env) wins; otherwise Vercel's production domain; otherwise the live site.
 */
export const LIVE_URL = "https://vsm-operations.vercel.app";
export function appUrl(): string {
  const set = process.env.APP_URL?.trim();
  if (set && /^https?:\/\//.test(set)) return set.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return LIVE_URL;
}
