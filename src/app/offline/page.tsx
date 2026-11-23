export const metadata = { title: "Offline · VSM Ops" };
export const dynamic = "force-static";

/** Shown by the service worker when there's no connection. Punches made on the attendance screen are queued on the device. */
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
      <p className="display text-5xl">
        VSM<span className="text-volt">.</span>
      </p>
      <h1 className="display text-3xl">You&apos;re offline</h1>
      <p className="text-sm text-muted">
        Check your internet connection. If you already had the Attendance page open, your clock-in is saved on this phone and syncs
        automatically when you&apos;re back online.
      </p>
      <a href="/attendance" className="btn-primary mx-auto">
        Try again
      </a>
    </main>
  );
}
