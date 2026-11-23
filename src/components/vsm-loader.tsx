/** Brand loader: the VSM wordmark fading in and out, "Initializing…" underneath. Used by every loading state. */
export function VsmLoader({ label = "Initializing", full = false }: { label?: string; full?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label}…`}
      className={full ? "fixed inset-0 z-[90] grid place-items-center bg-paper" : "grid min-h-[60vh] place-items-center"}
    >
      <div className="text-center">
        <p className="vsm-loader-mark display text-6xl" aria-hidden>
          VSM<span className="text-volt">.</span>
        </p>
        <p className="vsm-loader-label mt-4 text-[11px] font-semibold uppercase tracking-[0.35em] text-muted">
          {label}
          <span className="vsm-dots" aria-hidden>
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      </div>
    </div>
  );
}
