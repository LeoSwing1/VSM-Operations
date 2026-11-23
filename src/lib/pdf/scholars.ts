import "server-only";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { hr, money, MUTED, newDoc, pdfText, text, VOLT } from "./kit";

export async function certificatePdf(c: {
  name: string;
  course: string;
  batch: string;
  from: string;
  to: string;
  issued: string;
  number: string;
  grade: string | null;
  verifyUrl: string;
}) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(`Certificate ${c.number}`));
  doc.setCreator("VSM Scholars");
  const page = doc.addPage([841.89, 595.28]); // A4 landscape
  const [serif, serifB, sans, sansB] = await Promise.all([
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanBold),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ]);
  const W = 841.89,
    H = 595.28,
    ink = rgb(0.06, 0.06, 0.07),
    muted = rgb(0.42, 0.42, 0.4);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.99, 0.99, 0.97) });
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ink, borderWidth: 1.2 });
  page.drawRectangle({ x: 32, y: 32, width: W - 64, height: H - 64, borderColor: rgb(0.8, 0.8, 0.78), borderWidth: 0.5 });
  page.drawRectangle({ x: 24, y: H - 30, width: W - 48, height: 6, color: VOLT });
  const center = (s: string, y: number, size: number, font = serif, color = ink) => {
    const t = pdfText(s),
      w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (W - w) / 2, y, size, font, color });
  };
  center("VSM SCHOLARS", H - 92, 13, sansB, muted);
  center("Certificate of Completion", H - 150, 40, serif);
  center("This is to certify that", H - 200, 13, sans, muted);
  let size = 34;
  while (serifB.widthOfTextAtSize(pdfText(c.name), size) > W - 220 && size > 18) size -= 2;
  center(c.name, H - 250, size, serifB);
  page.drawLine({ start: { x: W / 2 - 180, y: H - 262 }, end: { x: W / 2 + 180, y: H - 262 }, thickness: 0.7, color: muted });
  center(`has successfully completed the ${c.course} course`, H - 292, 15, serif);
  center(`Batch ${c.batch} - ${c.from} to ${c.to}${c.grade ? ` - Grade ${c.grade}` : ""}`, H - 316, 12, sans, muted);
  // signatures
  const sig = (label: string, x: number) => {
    page.drawLine({ start: { x: x - 90, y: 132 }, end: { x: x + 90, y: 132 }, thickness: 0.7, color: ink });
    const t = pdfText(label),
      w = sans.widthOfTextAtSize(t, 10);
    page.drawText(t, { x: x - w / 2, y: 116, size: 10, font: sans, color: muted });
  };
  sig("Trainer", 200);
  sig("Director, VSM Scholars", W / 2);
  // QR
  const png = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  const qr = await doc.embedPng(png);
  page.drawImage(qr, { x: W - 190, y: 92, width: 96, height: 96 });
  page.drawText(pdfText(`No. ${c.number}`), { x: W - 194, y: 80, size: 8, font: sansB, color: ink });
  page.drawText(pdfText(`Issued ${c.issued}`), { x: W - 194, y: 68, size: 8, font: sans, color: muted });
  page.drawText(pdfText("Scan to verify"), { x: W - 194, y: 56, size: 8, font: sans, color: muted });
  page.drawText(pdfText("VSM Scholars - a VSM Growth institute - Meerut & Noida - vsmgrowth.com"), {
    x: 48,
    y: 48,
    size: 8,
    font: sans,
    color: muted,
  });
  return doc.save();
}

export async function receiptPdf(r: {
  receipt: string;
  date: string;
  student: string;
  phone: string;
  course: string;
  batch: string;
  amount: number;
  method: string;
  reference: string | null;
  balance: number;
  org: string;
}) {
  const k = await newDoc(`Receipt ${r.receipt}`);
  const { M, W } = k;
  let y = k.H - M;
  text(k, "VSM Scholars", M, y - 18, { size: 22, font: k.serif });
  text(k, `${r.org} - Meerut, Uttar Pradesh - GSTIN 09AAVFV8024A1ZW`, M, y - 34, { size: 8, color: MUTED });
  text(k, "FEE RECEIPT", W - M, y - 12, { size: 9, font: k.bold, align: "right", color: MUTED });
  text(k, r.receipt, W - M, y - 28, { size: 13, font: k.bold, align: "right" });
  text(k, r.date, W - M, y - 42, { size: 9, align: "right", color: MUTED });
  y -= 64;
  hr(k, y);
  y -= 28;
  const row = (l: string, v: string) => {
    text(k, l, M, y, { size: 9, color: MUTED });
    text(k, v, M + 150, y, { size: 11, maxWidth: W - 2 * M - 150 });
    y -= 22;
  };
  row("Received from", r.student);
  row("Mobile", r.phone);
  row("Course", r.course);
  row("Batch", r.batch);
  row("Payment mode", r.method);
  if (r.reference) row("Reference", r.reference);
  y -= 6;
  hr(k, y);
  y -= 34;
  text(k, "AMOUNT RECEIVED", M, y + 12, { size: 8, font: k.bold, color: MUTED });
  text(k, money(r.amount), M, y - 10, { size: 24, font: k.bold });
  text(k, `Balance due: ${money(r.balance)}`, W - M, y - 6, { size: 11, align: "right" });
  text(k, "Computer-generated receipt. Fees once paid are subject to the VSM Scholars refund policy.", M, M - 10, {
    size: 7,
    color: MUTED,
  });
  return k.doc.save();
}
