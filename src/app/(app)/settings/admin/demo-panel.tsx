"use client";
import { useActionState, useState } from "react";
import { createDemo, removeDemo } from "./actions";

export function DemoPanel({ count }: { count: number }) {
  const [made, create, creating] = useActionState(createDemo, null);
  const [gone, remove, removing] = useActionState(removeDemo, null);
  const [copied, setCopied] = useState(false);
  const text = made?.creds?.map((c) => `${c.code}\t${c.name}\t${c.post}\t${c.email}\t${c.password}`).join("\n") ?? "";
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Creates 5 demo employees with real logins — HR Manager, 2 SEO Executives, a Video Editor and a Web Developer — placed into the SEO,
        Editing and Developers teams and their chat groups, with sample tasks and live clock-ins. Everything is tagged <b>DEMO</b>.
      </p>
      <p className="text-xs text-muted">
        Currently {count} demo employee{count === 1 ? "" : "s"}.
      </p>
      <form action={create}>
        <button className="btn-primary" disabled={creating}>
          {creating ? "Creating…" : count ? "Recreate demo / issue new passwords" : "Create demo team"}
        </button>
      </form>
      {made && <p className={`text-xs ${made.ok ? "text-volt" : "text-danger"}`}>{made.message}</p>}
      {made?.creds && (
        <div className="overflow-x-auto rounded-xl border border-volt/40">
          <table className="table min-w-[640px] text-xs">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Post</th>
                <th>Login email</th>
                <th>Password</th>
              </tr>
            </thead>
            <tbody>
              {made.creds.map((c) => (
                <tr key={c.email}>
                  <td className="font-mono">{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.post}</td>
                  <td className="font-mono">{c.email}</td>
                  <td className="font-mono text-volt">{c.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn-ghost m-2 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy all"}
          </button>
        </div>
      )}
      {count > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-danger">Remove demo team…</summary>
          <form action={remove} className="mt-2 flex gap-2">
            <input name="confirm" placeholder="Type REMOVE" className="input py-1 text-xs" />
            <button className="btn-ghost text-xs text-danger" disabled={removing}>
              Remove
            </button>
          </form>
        </details>
      )}
      {gone && <p className={`text-xs ${gone.ok ? "text-volt" : "text-danger"}`}>{gone.message}</p>}
    </div>
  );
}
