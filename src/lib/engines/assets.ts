/** Assets & inventory helpers (Block 30). Pure functions — the database enforces the rules. */

export const ASSET_CATEGORIES: { key: string; label: string; life: number }[] = [
  { key: "LAPTOP", label: "Laptop", life: 36 },
  { key: "DESKTOP", label: "Desktop", life: 48 },
  { key: "MONITOR", label: "Monitor", life: 60 },
  { key: "PHONE", label: "Phone", life: 24 },
  { key: "TABLET", label: "Tablet", life: 36 },
  { key: "SIM", label: "SIM card", life: 12 },
  { key: "CAMERA", label: "Camera", life: 48 },
  { key: "LENS", label: "Lens", life: 60 },
  { key: "LIGHTING", label: "Lighting", life: 48 },
  { key: "AUDIO", label: "Mic / audio", life: 48 },
  { key: "STORAGE", label: "Hard disk / storage", life: 36 },
  { key: "NETWORK", label: "Router / network", life: 48 },
  { key: "ACCESSORY", label: "Accessory", life: 24 },
  { key: "FURNITURE", label: "Furniture", life: 120 },
  { key: "VEHICLE", label: "Vehicle", life: 96 },
  { key: "SOFTWARE", label: "Software licence", life: 12 },
  { key: "OTHER", label: "Other", life: 36 },
];
export const ASSET_STATUSES = ["IN_STOCK", "ISSUED", "IN_REPAIR", "LOST", "RETIRED"] as const;
export const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
export const RETURN_CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED", "LOST"] as const;

export const categoryLabel = (k: string) => ASSET_CATEGORIES.find((c) => c.key === k)?.label ?? k;
export const defaultLife = (k: string) => ASSET_CATEGORIES.find((c) => c.key === k)?.life ?? 36;

const DAY = 86_400_000;
const toDate = (d: string | Date) => (typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d);

/** Warranty state on a given day: none / expired / expiring within `soonDays` / active. */
export function warrantyState(until: string | null | undefined, today: Date = new Date(), soonDays = 30) {
  if (!until) return "NONE" as const;
  const days = Math.floor((toDate(until).getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY);
  if (days < 0) return "EXPIRED" as const;
  if (days <= soonDays) return "EXPIRING" as const;
  return "ACTIVE" as const;
}

/** Whole months between two dates (never negative). */
export function monthsBetween(from: string | Date, to: string | Date): number {
  const a = toDate(from),
    b = toDate(to);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Straight-line book value: cost falls evenly to zero over the useful life. A management estimate, not the
 * Income-tax WDV block calculation.
 */
export function bookValue(
  cost: number | null | undefined,
  purchased: string | null | undefined,
  lifeMonths: number,
  asOf: Date = new Date(),
) {
  if (cost == null || !purchased || !(lifeMonths > 0)) return null;
  const used = Math.min(lifeMonths, monthsBetween(purchased, asOf));
  return Math.round(cost * (1 - used / lifeMonths) * 100) / 100;
}

/** An issued item is overdue when its expected return date has passed. */
export function isOverdue(expectedReturn: string | null | undefined, today: Date = new Date()) {
  return warrantyState(expectedReturn, today, -1) === "EXPIRED";
}

/** CSV cell escaping; also neutralises spreadsheet formulas. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
