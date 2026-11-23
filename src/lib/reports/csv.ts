/** Escape a CSV field and neutralise spreadsheet formula prefixes without changing numeric cells. */
export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  // OWASP CSV injection: neutralise =, +, -, @ (after any leading whitespace/BOM) and a leading tab or carriage return.
  const dangerous = /^[\s\uFEFF]*[=+\-@]/.test(raw) || /^[\t\r]/.test(raw);
  const safe = typeof value === "number" || typeof value === "boolean" ? raw : dangerous ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
