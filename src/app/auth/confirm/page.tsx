import { Flash } from "@/components/ui";

/**
 * Where reset / invite emails land. Scanner-safe: opening the link spends nothing.
 * The person types the new password HERE, and one POST both checks the one-time link and saves the password —
 * no session has to survive a redirect in between.
 */
export const metadata = { title: "Set your password · VSM Ops" };

export default async function Confirm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tokenHash = sp.token_hash ?? "";
  const type = sp.type ?? "recovery";
  const valid = /^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) && ["recovery", "invite", "magiclink", "email"].includes(type);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-volt">VSM Growth Operations</p>
        <h1 className="display text-4xl">Set a new password</h1>
        <Flash sp={sp} />
        {valid ? (
          <form method="post" action="/auth/verify" className="space-y-4">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <label className="block">
              <span className="label">New password (10+ characters)</span>
              <input className="input" type="password" name="password" required minLength={10} autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="label">Confirm</span>
              <input className="input" type="password" name="confirm" required minLength={10} autoComplete="new-password" />
            </label>
            <button className="btn-primary w-full">Save password and sign in</button>
            <p className="text-xs text-muted">This link works once, for 1 hour.</p>
          </form>
        ) : (
          <p className="text-sm text-muted">
            This link is incomplete.{" "}
            <a className="text-volt underline" href="/login?forgot=1">
              Ask for a new reset link
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
