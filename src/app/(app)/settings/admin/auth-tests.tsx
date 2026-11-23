"use client";
import Link from "next/link";
import { useActionState } from "react";
import { testLogin, testResetEmail } from "./auth-actions";

export function AuthTests({ email }: { email: string }) {
  const [login, doLogin, logging] = useActionState(testLogin, null);
  const [reset, doReset, resetting] = useActionState(testResetEmail, null);
  return (
    <div className="space-y-4">
      <form action={doLogin} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input name="email" type="email" required placeholder="employee login email" className="input" autoComplete="off" />
        <input name="password" type="password" required placeholder="password" className="input" autoComplete="new-password" />
        <button className="btn-ghost" disabled={logging}>
          {logging ? "Testing…" : "Test login"}
        </button>
      </form>
      {login && <p className={`text-xs ${login.ok ? "text-volt" : "text-danger"}`}>{login.message}</p>}
      <form action={doReset}>
        <button className="btn-ghost" disabled={resetting}>
          {resetting ? "Sending…" : `Send a test reset email to ${email}`}
        </button>
      </form>
      {reset && <p className={`text-xs ${reset.ok ? "text-volt" : "text-danger"}`}>{reset.message}</p>}
      <p className="text-xs text-muted">
        Public connection check:{" "}
        <Link href="/status" className="text-volt hover:underline">
          /status
        </Link>{" "}
        (also linked from the login page).
      </p>
    </div>
  );
}
