import { Flash } from "@/components/ui";
import { VsmMark } from "@/components/brand";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const forgot = sp.forgot === "1";
  // Play the intro once per tab; skip it when coming back with a message (wrong password, reset sent…).
  const skip = !!(sp.err || sp.ok || sp.e || forgot);
  const introScript = `try{if(sessionStorage.getItem('vsm-intro'))document.documentElement.classList.add('intro-done');else sessionStorage.setItem('vsm-intro','1')}catch(e){}`;
  const words = ["One", "operating", "system."];
  return (
    <main className={`grid min-h-screen lg:grid-cols-2${skip ? " no-intro" : ""}`}>
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: introScript }} />
      <div className="login-curtain" aria-hidden />
      <VsmMark className="login-logo" />
      <section className="relative hidden overflow-hidden border-r border-line p-12 lg:flex lg:flex-col lg:justify-between">
        <p className="eyebrow login-rise">VSM Growth · VSM Scholars</p>
        <h1 className="display text-[clamp(4rem,8vw,8.5rem)]">
          {words.map((w, i) => (
            <span key={w} className="block">
              <span className="login-word" style={{ ["--i" as string]: i }}>
                <span className={i === 2 ? "text-volt" : undefined}>{w}</span>
              </span>
            </span>
          ))}
        </h1>
        <p className="login-rise max-w-sm text-sm text-muted" style={{ ["--i" as string]: 3 }}>
          People, attendance, work, performance, payroll and clients — secured by role, built for Meerut & Noida.
        </p>
        <div aria-hidden className="login-glow pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-volt/10 blur-3xl" />
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="login-rise w-full max-w-sm" style={{ ["--i" as string]: 2 }}>
          <p className="eyebrow mb-3">Secure workspace</p>
          <h2 className="display mb-8 text-4xl">{forgot ? "Reset password" : "Sign in"}</h2>
          <Flash sp={sp} />
          {sp.e === "no-employee" && (
            <div className="mb-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
              Your login works, but it isn&apos;t linked to an active employee profile. If you are setting up the system, run
              <code className="mx-1 font-mono">bootstrap_organization</code> with this account&apos;s UID (RUNBOOK step 2). Otherwise ask HR
              to link your account.
              <form action="/auth/signout" method="post" className="mt-3">
                <button className="btn-ghost">Sign out and use another account</button>
              </form>
            </div>
          )}
          {forgot ? (
            <form method="post" action="/auth/forgot" className="space-y-4">
              <label className="block">
                <span className="label">Official email</span>
                <input className="input" type="email" name="email" required autoComplete="email" />
              </label>
              <button className="btn-primary w-full">Send reset link</button>
              <a href="/login" className="block text-center text-sm text-muted hover:text-ink">
                Back to sign in
              </a>
            </form>
          ) : (
            <form method="post" action="/auth/sign-in" className="space-y-4">
              <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
              <label className="block">
                <span className="label">Official email</span>
                <input className="input" type="email" name="email" required autoComplete="username" />
              </label>
              <label className="block">
                <span className="label">Password</span>
                <input className="input" type="password" name="password" required minLength={8} autoComplete="current-password" />
              </label>
              <button className="btn-primary w-full">Sign in</button>
              <div className="flex items-center justify-between text-sm">
                <a href="/login?forgot=1" className="text-muted hover:text-ink">
                  Forgot password?
                </a>
                <a href="/status" className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-volt" aria-hidden /> Test connection
                </a>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
