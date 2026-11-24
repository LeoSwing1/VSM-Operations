/** "Sushant Malik" → "Sushant M." ; single names stay as they are. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}
export function initialsOf(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}
/** The line under the name: Super Admin shows as Owner; otherwise their post, falling back to the role. */
export function subtitleFor(role: string, designation: string | null, roleLabel: string, isOwner = false): string {
  if (role === "SUPER_ADMIN" || isOwner) return "Owner";
  return designation?.trim() || roleLabel;
}
