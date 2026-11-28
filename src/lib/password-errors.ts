/** Turn a Supabase password-update error into a clear sentence (no more "link expired" for everything). */
export function passwordUpdateMessage(err: { code?: string; message?: string; reasons?: string[] } | null | undefined): string {
  const code = err?.code ?? "";
  const text = (err?.message ?? "").toLowerCase();
  if (code === "same_password" || text.includes("different from the old") || text.includes("same"))
    return "That’s your current password — choose a new one.";
  if (code === "weak_password" || text.includes("weak") || text.includes("should contain") || text.includes("pwned")) {
    const r = err?.reasons ?? [];
    if (r.includes("pwned")) return "That password has appeared in a data leak — choose a different one.";
    if (r.includes("characters") || text.includes("should contain"))
      return "Use a stronger password: mix upper- and lower-case letters, numbers and a symbol.";
    return "That password is too weak — make it longer and mix letters, numbers and a symbol.";
  }
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid")
    return "For security, please sign in again (or use a fresh reset link), then set your password.";
  if (
    ["session_not_found", "session_expired", "bad_jwt", "refresh_token_not_found", "refresh_token_already_used"].includes(code) ||
    (err as { name?: string } | null)?.name === "AuthSessionMissingError" ||
    text.includes("session")
  )
    return "Your reset session has ended. Ask for a new reset link and use it within the hour.";
  if (code === "over_request_rate_limit") return "Too many attempts — wait a minute and try again.";
  return err?.message ? `Couldn’t update the password: ${err.message}` : "Couldn’t update the password — try again.";
}
