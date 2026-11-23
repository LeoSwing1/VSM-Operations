/**
 * The VSM wordmark as used on vsmgrowth.com: serif "VSM" with the volt full stop.
 * To use an uploaded logo file instead, set NEXT_PUBLIC_BRAND_LOGO=/your-logo.svg (file in /public).
 */
export function VsmMark({ className, sub = true }: { className?: string; sub?: boolean }) {
  const src = process.env.NEXT_PUBLIC_BRAND_LOGO;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="VSM Growth" className={className} style={{ height: "1em", width: "auto" }} />;
  }
  return (
    <span className={className} aria-label="VSM Growth">
      <span className="font-display tracking-tightest" aria-hidden>
        VSM<span className="text-volt">.</span>
      </span>
      {sub && (
        <span className="vsm-mark-sub" aria-hidden>
          Growth · Operations
        </span>
      )}
    </span>
  );
}
