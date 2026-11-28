import { Flash } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="display text-4xl">You’re not signed in</h1>
          <p className="text-sm text-muted">
            Sign in to change your password, or ask for a reset link — the email lets you set a new password in one step.
          </p>
          <a href="/login?forgot=1" className="btn-primary block w-full text-center">
            Send me a new reset link
          </a>
          <a href="/login" className="block text-center text-sm text-muted hover:text-ink">
            Back to sign in
          </a>
        </div>
      </main>
    );
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form method="post" action="/auth/new-password" className="w-full max-w-sm space-y-4">
        <h1 className="display text-4xl">{sp.forced ? "Choose your password" : "New password"}</h1>
        {sp.forced && (
          <p className="text-sm text-muted">
            Your administrator gave you a temporary password. Set your own to continue — nobody else will know it.
          </p>
        )}
        <p className="text-sm text-muted">
          For <b className="text-ink">{user.email}</b>
        </p>
        {sp.forced && <input type="hidden" name="forced" value="1" />}
        <Flash sp={sp} />
        <label className="block">
          <span className="label">New password (10+ characters)</span>
          <input className="input" type="password" name="password" required minLength={10} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="label">Confirm</span>
          <input className="input" type="password" name="confirm" required minLength={10} autoComplete="new-password" />
        </label>
        <button className="btn-primary w-full">Update password</button>
      </form>
    </main>
  );
}
