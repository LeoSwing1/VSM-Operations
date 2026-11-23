"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NotFoundView() {
  const path = usePathname();
  return (
    <div className="py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="display mt-3 text-6xl">Not here.</h1>
      <p className="mt-3 text-sm text-muted">It doesn&apos;t exist, or it&apos;s outside your access.</p>
      <p className="mt-2 font-mono text-xs text-muted">{path}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/dashboard" className="btn-primary">
          Back to dashboard
        </Link>
        <Link href="/status" className="btn-ghost">
          Test connection
        </Link>
      </div>
    </div>
  );
}
