/** Personal chat themes (saved per person in this browser). Every pair is chosen for readable contrast. */
export interface ChatTheme {
  key: string;
  label: string;
  swatch: string;
  bg: string; // conversation background
  text?: string; // names, times and notes shown on the background
  mine: { bg: string; fg: string; meta: string };
  theirs: { bg: string; fg: string; border: string };
}
export const CHAT_THEMES: ChatTheme[] = [
  {
    key: "volt",
    label: "VSM Volt",
    swatch: "#D7FF3A",
    bg: "transparent",
    mine: { bg: "#D7FF3A", fg: "#0b0b0c", meta: "#3a3f1a" },
    theirs: { bg: "var(--color-paper, #141416)", fg: "inherit", border: "var(--color-line, #2a2a2e)" },
  },
  {
    key: "ocean",
    label: "Ocean",
    swatch: "#2563eb",
    bg: "linear-gradient(180deg,#0b1a2e,#0b0f1a)",
    mine: { bg: "#2563eb", fg: "#ffffff", meta: "#dbeafe" },
    theirs: { bg: "#13233b", fg: "#e6eefb", border: "#1f3556" },
  },
  {
    key: "rose",
    label: "Rose",
    swatch: "#e11d74",
    bg: "linear-gradient(180deg,#1f0b16,#120a0f)",
    mine: { bg: "#e11d74", fg: "#ffffff", meta: "#fde2ee" },
    theirs: { bg: "#2a1420", fg: "#fbe7f0", border: "#3d1d2e" },
  },
  {
    key: "forest",
    label: "Forest",
    swatch: "#15803d",
    bg: "linear-gradient(180deg,#0a1a10,#0b100c)",
    mine: { bg: "#15803d", fg: "#ffffff", meta: "#dcfce7" },
    theirs: { bg: "#14261a", fg: "#e7f6ec", border: "#20392a" },
  },
  {
    key: "sunset",
    label: "Sunset",
    swatch: "#f97316",
    bg: "linear-gradient(180deg,#22120a,#140c08)",
    mine: { bg: "#f97316", fg: "#1a0d05", meta: "#4a2309" },
    theirs: { bg: "#2b1a10", fg: "#fdeee3", border: "#45291a" },
  },
  {
    key: "paper",
    label: "Paper (light)",
    swatch: "#f4f1ea",
    bg: "#f4f1ea",
    text: "#3f3f46",
    mine: { bg: "#111111", fg: "#ffffff", meta: "#d4d4d4" },
    theirs: { bg: "#ffffff", fg: "#111111", border: "#e4dfd3" },
  },
  {
    key: "mono",
    label: "Mono",
    swatch: "#9ca3af",
    bg: "#0e0e10",
    mine: { bg: "#f4f4f5", fg: "#0b0b0c", meta: "#52525b" },
    theirs: { bg: "#1c1c20", fg: "#f4f4f5", border: "#2e2e33" },
  },
];
export const themeByKey = (k: string | null | undefined) => CHAT_THEMES.find((t) => t.key === k) ?? CHAT_THEMES[0]!;
