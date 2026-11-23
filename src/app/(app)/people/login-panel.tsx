"use client";
import { useActionState, useState } from "react";
import { emailNewPassword, resendWelcome, sendResetLink, setTemporaryPassword, type PwState } from "./password-actions";

function Result({ s }: { s: PwState }) {
  const [copied, setCopied] = useState(false);
  if (!s) return null;
  return (
    <div className={`rounded-xl border p-3 text-xs ${s.ok ? "border-volt/40 bg-volt/10" : "border-danger/40 text-danger"}`}>
      <p>{s.message}</p>
      {s.password && (
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded bg-black/40 px-2 py-1 font-mono text-sm text-ink">{s.password}</code>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(s.password!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

export function LoginPanel({ id, email, hasLogin }: { id: string; email: string; hasLogin: boolean }) {
  const [w, welcome, welcoming] = useActionState(resendWelcome, null);
  const [l, link, linking] = useActionState(sendResetLink, null);
  const [n, newPw, generating] = useActionState(emailNewPassword, null);
  const [t, temp, setting] = useActionState(setTemporaryPassword, null);
  const Btn = ({
    action,
    busy,
    label,
    busyLabel,
    primary,
  }: {
    action: (fd: FormData) => void;
    busy: boolean;
    label: string;
    busyLabel: string;
    primary?: boolean;
  }) => (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className={`${primary ? "btn-primary" : "btn-ghost"} w-full`} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
    </form>
  );
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Login & password · {email}</p>
      <Btn
        action={welcome}
        busy={welcoming}
        primary={!hasLogin}
        label={hasLogin ? "Resend welcome email" : "Create login & send welcome email"}
        busyLabel="Sending…"
      />
      <Result s={w} />
      {hasLogin && (
        <>
          <Btn action={newPw} busy={generating} label="Generate new password & email it" busyLabel="Generating…" />
          <Result s={n} />
          <Btn action={link} busy={linking} label="Email a reset link instead" busyLabel="Sending…" />
          <Result s={l} />
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Generate a password without emailing…</summary>
            <div className="mt-2">
              <Btn action={temp} busy={setting} label="Generate & show once" busyLabel="Generating…" />
            </div>
          </details>
          <Result s={t} />
        </>
      )}
    </div>
  );
}
