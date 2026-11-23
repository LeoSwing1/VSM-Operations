"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-24 text-center">
      <p className="eyebrow">Something broke</p>
      <h1 className="display mt-3 text-5xl">That didn&apos;t load.</h1>
      <p className="mt-3 text-sm text-muted">Your data is safe. Try again, and tell an admin if it keeps happening.</p>
      <button onClick={reset} className="btn-primary mt-6">
        Retry
      </button>
    </div>
  );
}
