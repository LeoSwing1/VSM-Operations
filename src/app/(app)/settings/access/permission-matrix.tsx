"use client";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { togglePermission } from "./actions";

export interface MatrixRole {
  role: string;
  label: string;
  level: number;
  people: number;
}
export interface MatrixGroup {
  group: string;
  perms: { key: string; label: string; sensitive: boolean }[];
}

type Toast = { id: number; ok: boolean; text: string };

/** OPDesk-style matrix: every switch saves instantly, rolls back on refusal, and greys out what's outside your authority. */
export function PermissionMatrix({
  roles,
  groups,
  initial,
  editable,
}: {
  roles: MatrixRole[];
  groups: MatrixGroup[];
  initial: string[];
  editable: string[];
}) {
  const [granted, setGranted] = useState(() => new Set(initial));
  const [optimistic, apply] = useOptimistic(granted, (s: Set<string>, [cell, on]: [string, boolean]) => {
    const n = new Set(s);
    if (on) n.add(cell);
    else n.delete(cell);
    return n;
  });
  const can = useMemo(() => new Set(editable), [editable]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  const toast = (ok: boolean, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, ok, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  const flip = (role: MatrixRole, perm: { key: string; label: string }) => {
    const cell = `${role.role}|${perm.key}`;
    if (!can.has(cell) || busy.has(cell)) return;
    const on = !optimistic.has(cell);
    setBusy((b) => new Set(b).add(cell));
    start(async () => {
      apply([cell, on]);
      const r = await togglePermission(role.role, perm.key, on).catch(() => ({ ok: false, message: "Network error — not saved." }));
      if (r.ok)
        setGranted((s) => {
          const n = new Set(s);
          if (on) n.add(cell);
          else n.delete(cell);
          return n;
        });
      toast(
        r.ok,
        r.ok ? `${perm.label} ${on ? "granted to" : "removed from"} ${role.label}` : `${role.label} · ${perm.label}: ${r.message}`,
      );
      setBusy((b) => {
        const n = new Set(b);
        n.delete(cell);
        return n;
      });
    });
  };

  const needle = q.trim().toLowerCase();
  const visible = groups
    .map((g) => ({
      ...g,
      perms: g.perms.filter(
        (p) => !needle || p.label.toLowerCase().includes(needle) || p.key.includes(needle) || g.group.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.perms.length);
  const total = (r: MatrixRole) =>
    r.role === "SUPER_ADMIN"
      ? groups.reduce((a, g) => a + g.perms.length, 0)
      : [...optimistic].filter((c) => c.startsWith(`${r.role}|`)).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search permissions…"
          className="input max-w-xs"
          aria-label="Search permissions"
        />
        <span className="text-xs text-muted">Changes save instantly and are written to the audit log.</span>
      </div>
      <div className="card overflow-hidden">
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr>
                <th className="sticky left-0 z-20 min-w-[300px] border-b border-line bg-panel px-4 py-3 text-left text-xs font-medium text-muted">
                  Permission
                </th>
                {roles.map((r) => (
                  <th key={r.role} className="border-b border-line px-2 py-3 text-center">
                    <span className="block text-xs font-semibold text-ink">{r.label}</span>
                    <span className="mt-1 block text-[10px] font-normal text-muted">
                      L{r.level} · {r.people} people · {total(r)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const isClosed = closed.has(g.group) && !needle;
                return (
                  <FragmentRows key={g.group}>
                    <tr>
                      <td colSpan={roles.length + 1} className="sticky left-0 border-b border-line bg-ink/[0.03] px-4 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            setClosed((c) => {
                              const n = new Set(c);
                              if (n.has(g.group)) n.delete(g.group);
                              else n.add(g.group);
                              return n;
                            })
                          }
                          className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-ink"
                          aria-expanded={!isClosed}
                        >
                          <span className={clsx("transition", isClosed ? "-rotate-90" : "")}>▾</span>
                          {g.group}
                          <span className="font-normal normal-case tracking-normal">· {g.perms.length}</span>
                        </button>
                      </td>
                    </tr>
                    {!isClosed &&
                      g.perms.map((p) => (
                        <tr key={p.key} className="hover:bg-ink/[0.025]">
                          <td className="sticky left-0 border-b border-line bg-panel px-4 py-2.5">
                            <span className="text-[13px] font-medium">{p.label}</span>
                            {p.sensitive && (
                              <span className="ml-2 rounded-full bg-ember/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-ember">
                                Sensitive
                              </span>
                            )}
                            <span className="mt-0.5 block font-mono text-[9px] text-muted">{p.key}</span>
                          </td>
                          {roles.map((r) => {
                            const cell = `${r.role}|${p.key}`;
                            const on = r.role === "SUPER_ADMIN" || optimistic.has(cell);
                            const edit = can.has(cell);
                            const saving = busy.has(cell);
                            return (
                              <td key={cell} className="border-b border-line px-2 py-2 text-center">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={on}
                                  aria-label={`${r.label}: ${p.label}`}
                                  disabled={!edit}
                                  title={
                                    r.role === "SUPER_ADMIN"
                                      ? "Super Admin always has every permission"
                                      : edit
                                        ? undefined
                                        : "Outside your authority"
                                  }
                                  onClick={() => flip(r, p)}
                                  className={clsx(
                                    "relative inline-flex h-6 w-11 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
                                    on ? "bg-volt" : "bg-line",
                                    !edit && "cursor-not-allowed opacity-40",
                                    saving && "animate-pulse",
                                  )}
                                >
                                  <span
                                    className={clsx(
                                      "absolute left-0.5 h-5 w-5 rounded-full shadow-sm transition",
                                      on ? "translate-x-5 bg-[#0B0B0C]" : "bg-white",
                                    )}
                                  />
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur",
              t.ok ? "border-volt/40 bg-panel/95 text-ink" : "border-danger/50 bg-panel/95 text-danger",
            )}
          >
            {t.ok ? "✓ " : "✕ "}
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
