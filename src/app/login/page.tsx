import { Flash } from "@/components/ui";
import { signIn, sendReset } from "./actions";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const forgot = sp.forgot === "1";
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-line p-12 lg:flex lg:flex-col lg:justify-between">
        <p className="eyebrow">VSM Growth · VSM Scholars</p>
        <h1 className="display text-[clamp(4rem,8vw,8.5rem)]">
          One<br />operating<br /><em className="text-volt not-italic">system.</em>
        </h1>
        <p className="max-w-sm text-sm text-muted">People, attendance, work, performance, payroll and clients — secured by role, built for Meerut & Noida.</p>
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-volt/10 blur-3xl" />
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <p className="display mb-1 text-4xl lg:hidden">VSM<span className="text-volt">.</span></p>
          <h2 className="display mb-8 text-3xl">{forgot ? "Reset password" : "Sign in"}</h2>
          <Flash sp={sp} />
          {sp.e === "no-employee" && (
            <p className="mb-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
              Your login works, but it isn&apos;t linked to an active employee profile. Ask HR to link your account.
            </p>
          )}
          {forgot ? (
            <form action={sendReset} className="space-y-4">
              <label className="block"><span className="label">Official email</span>
                <input className="input" type="email" name="email" required autoComplete="email" /></label>
              <button className="btn-primary w-full">Send reset link</button>
              <a href="/login" className="block text-center text-sm text-muted hover:text-ink">Back to sign in</a>
            </form>
          ) : (
            <form action={signIn} className="space-y-4">
              <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
              <label className="block"><span className="label">Official email</span>
                <input className="input" type="email" name="email" required autoComplete="username" /></label>
              <label className="block"><span className="label">Password</span>
                <input className="input" type="password" name="password" required minLength={8} autoComplete="current-password" /></label>
              <button className="btn-primary w-full">Sign in</button>
              <a href="/login?forgot=1" className="block text-center text-sm text-muted hover:text-ink">Forgot password?</a>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
