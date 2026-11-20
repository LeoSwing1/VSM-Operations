import Link from "next/link";
export default function NotFound() {
  return (<div className="py-24 text-center"><p className="eyebrow">404</p><h1 className="display mt-3 text-6xl">Not here.</h1>
    <p className="mt-3 text-sm text-muted">It doesn&apos;t exist, or it&apos;s outside your access.</p><Link href="/dashboard" className="btn-primary mt-6">Back to dashboard</Link></div>);
}
