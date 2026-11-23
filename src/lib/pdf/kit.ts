import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Standard PDF fonts only cover Latin-1: map ₹ and smart punctuation, drop anything else safely. */
export function pdfText(v: unknown): string {
  return String(v ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}
export const money = (n: unknown) =>
  `Rs. ${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const INK = rgb(0.06, 0.06, 0.07),
  MUTED = rgb(0.42, 0.42, 0.4),
  LINE = rgb(0.85, 0.85, 0.83),
  VOLT = rgb(0.84, 1, 0.23);

export interface Kit {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  W: number;
  H: number;
  M: number;
}

export async function newDoc(title: string): Promise<Kit> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(title));
  doc.setCreator("VSM Ops");
  doc.setProducer("VSM Growth Operations");
  const page = doc.addPage([595.28, 841.89]); // A4
  return {
    doc,
    page,
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    W: 595.28,
    H: 841.89,
    M: 48,
  };
}

export function text(
  k: Kit,
  s: unknown,
  x: number,
  y: number,
  o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; maxWidth?: number } = {},
) {
  const size = o.size ?? 10,
    font = o.font ?? k.font;
  let t = pdfText(s);
  if (o.maxWidth) while (t.length > 3 && font.widthOfTextAtSize(t, size) > o.maxWidth) t = t.slice(0, -4) + "...";
  const w = font.widthOfTextAtSize(t, size);
  const dx = o.align === "right" ? -w : o.align === "center" ? -w / 2 : 0;
  k.page.drawText(t, { x: x + dx, y, size, font, color: o.color ?? INK });
}
export const hr = (k: Kit, y: number, x1 = k.M, x2 = k.W - k.M) =>
  k.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: LINE });
