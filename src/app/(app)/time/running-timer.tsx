"use client";
import { useNow } from "@/lib/use-now";
import { stopTaskTimer } from "./actions";
export function RunningTimer({ id, startedAt, taskTitle }: { id: string; startedAt: string; taskTitle: string }) {
  const now = useNow(true);
  const elapsed = now === null ? 0 : Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)),
    hours = Math.floor(elapsed / 3600),
    minutes = Math.floor((elapsed % 3600) / 60),
    seconds = elapsed % 60;
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 p-5" aria-live="polite">
      <div>
        <p className="eyebrow">Timer running · {taskTitle}</p>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums" suppressHydrationWarning>
          {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </p>
        <p className="mt-1 text-xs text-muted">
          Started {new Date(startedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" })} · elapsed time updates
          live
        </p>
      </div>
      <form action={stopTaskTimer} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <label className="grid gap-1 text-xs text-muted">
          Work summary
          <input
            name="description"
            className="input min-w-56"
            minLength={3}
            maxLength={1000}
            required
            defaultValue="Completed focused work session"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="billable" /> Billable
        </label>
        <button className="btn-primary min-h-11">Stop & submit</button>
      </form>
    </section>
  );
}
