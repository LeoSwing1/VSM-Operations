export default function Loading() {
  return (<div aria-busy="true" aria-label="Loading" className="space-y-4"><div className="h-14 w-2/3 animate-pulse rounded-xl bg-line/50" />
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-line/40" />)}</div>
    <div className="h-72 animate-pulse rounded-2xl bg-line/30" /></div>);
}
