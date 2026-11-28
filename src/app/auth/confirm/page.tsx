/**
 * Landing page for links in our emails (password reset, invites).
 * Mail scanners (Gmail, Outlook, antivirus) open links to check them — a one-time link opened by a scanner is
 * used up before the person clicks. So the link only shows this page; the token is spent when the person presses
 * the button (a POST, which scanners don't send).
 */
export const metadata = { title: "Continue · VSM Ops" };

export default async function Confirm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tokenHash = sp.token_hash ?? "";
  const type = sp.type ?? "recovery";
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/login/reset";
  const valid = /^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) && ["recovery", "invite", "magiclink", "email"].includes(type);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-volt">VSM Growth Operations</p>
        <h1 className="display text-4xl">{type === "recovery" ? "Reset your password" : "Continue to VSM Ops"}</h1>
        {valid ? (
          <form method="post" action="/auth/verify" className="space-y-4">
            <p className="text-sm text-muted">Press the button to continue. You’ll choose a new password on the next screen.</p>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button className="btn-primary w-full">{type === "recovery" ? "Choose a new password" : "Continue"}</button>
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
