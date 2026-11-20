import { Flash } from "@/components/ui";
import { setNewPassword } from "../actions";

export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={setNewPassword} className="w-full max-w-sm space-y-4">
        <h1 className="display text-4xl">New password</h1>
        <Flash sp={sp} />
        <label className="block"><span className="label">New password (10+ characters)</span>
          <input className="input" type="password" name="password" required minLength={10} autoComplete="new-password" /></label>
        <label className="block"><span className="label">Confirm</span>
          <input className="input" type="password" name="confirm" required minLength={10} autoComplete="new-password" /></label>
        <button className="btn-primary w-full">Update password</button>
      </form>
    </main>
  );
}
