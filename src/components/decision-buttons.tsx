"use client";
import { useRef } from "react";

type Choice = { value: string; label: string; className?: string };

/**
 * Approve / reject buttons that never lose the decision.
 *
 * The old pattern relied on the clicked button's own name/value reaching FormData. When that value went
 * missing, `decision === "approve"` was false and an approval was saved as REJECTED. This component writes the
 * choice into a hidden input synchronously on click (before the submit event), and starts EMPTY so a submit
 * without a click (e.g. Enter in the note field) is refused server-side rather than treated as a rejection.
 */
export function DecisionButtons({
  choices = [
    { value: "approve", label: "Approve", className: "btn-primary" },
    { value: "reject", label: "Reject", className: "btn-danger" },
  ],
  name = "decision",
  small = false,
}: {
  choices?: Choice[];
  name?: string;
  small?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="hidden" name={name} defaultValue="" />
      {choices.map((c) => (
        <button
          key={c.value}
          type="submit"
          data-decision={c.value}
          onClick={() => {
            if (ref.current) ref.current.value = c.value;
          }}
          className={`${c.className ?? "btn-ghost"}${small ? " px-2 py-1 text-xs" : ""}`}
        >
          {c.label}
        </button>
      ))}
    </>
  );
}
