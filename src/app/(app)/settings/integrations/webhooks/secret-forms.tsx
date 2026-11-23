"use client";
import { useActionState, useState } from "react";
import { createWebhook, rotateWebhookSecret, type SecretState } from "../channel-actions";

function SecretBox({ s }: { s: SecretState }) {
  const [copied, setCopied] = useState(false);
  if (!s.secret) return <p className={s.ok ? "text-sm text-volt" : "text-sm text-danger"}>{s.message}</p>;
  return (
    <div className="rounded-xl border border-volt/40 bg-volt/10 p-3 text-sm">
      <p className="font-semibold">
        {s.message} Signing secret for “{s.name}” — copy it now, it won&apos;t be shown again:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs">{s.secret}</code>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(s.secret!);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function CreateWebhookForm({ events }: { events: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createWebhook, null);
  return (
    <form action={action} className="grid gap-3">
      {state && <SecretBox s={state} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Name</span>
          <input name="name" required placeholder="Zapier — new leads" className="input" />
        </label>
        <label className="block">
          <span className="label">HTTPS URL</span>
          <input name="url" type="url" required placeholder="https://hooks.zapier.com/…" className="input" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {events.map((e) => (
          <label key={e.key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" name={`ev:${e.key}`} defaultChecked={e.key.startsWith("lead.")} className="accent-[#D7FF3A]" />
            {e.label}
          </label>
        ))}
      </div>
      <div>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Checking URL…" : "Create endpoint"}
        </button>
      </div>
    </form>
  );
}

export function RotateSecret({ id }: { id: string }) {
  const [state, action, pending] = useActionState(rotateWebhookSecret, null);
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button className="text-xs text-muted hover:text-ink" disabled={pending}>
          Rotate secret
        </button>
      </form>
      {state && <SecretBox s={state} />}
    </div>
  );
}
