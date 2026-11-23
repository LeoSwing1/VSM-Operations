import "server-only";
import { deflateRawSync } from "node:zlib";

// Minimal standards-compliant OOXML writer. No spreadsheet formula evaluation or external package dependency.
const encoder = new TextEncoder();
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n: number) {
  return new Uint8Array([n & 255, (n >>> 8) & 255]);
}
function u32(n: number) {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}
function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function zip(files: { name: string; content: string }[]) {
  const locals: Uint8Array[] = [],
    centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.name),
      raw = encoder.encode(f.content),
      packed = deflateRawSync(raw),
      crc = crc32(raw);
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(packed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      packed,
    ]);
    locals.push(local);
    centrals.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(8),
        u16(0),
        u16(0),
        u32(crc),
        u32(packed.length),
        u32(raw.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = join(centrals);
  return join([
    ...locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
}
const xml = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const col = (n: number) => {
  let s = "";
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
export function makeXlsx(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  const sheet = rows
    .map(
      (row, ri) =>
        `<row r="${ri + 1}">${row
          .map((v, ci) => {
            const ref = `${col(ci + 1)}${ri + 1}`;
            if (ri === 0) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
            if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
            if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const safe = xml(filename.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Report");
  const widths = Array.from({ length: Math.max(1, ...rows.map((r) => r.length)) }, (_, i) => {
    const m = Math.max(10, ...rows.map((r) => String(r[i] ?? "").length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, m + 2)}" customWidth="1"/>`;
  }).join("");
  return zip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safe.slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>${widths}</cols><sheetData>${sheet}</sheetData><autoFilter ref="A1:${col(Math.max(1, ...rows.map((r) => r.length)))}${Math.max(1, rows.length)}"/></worksheet>`,
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF24313F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
  ]);
}
export function makePdf(title: string, rows: string[]) {
  const esc = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7e]/g, "?");
  const wrap = (s: string, max = 96) => {
    const words = s.split(/\s+/),
      out: string[] = [];
    let line = "";
    for (const word of words) {
      if (!line) {
        line = word;
        continue;
      }
      if ((line + " " + word).length > max) {
        out.push(line);
        line = word;
      } else line += " " + word;
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  };
  const content = rows.flatMap((r) => wrap(r));
  const perPage = 48,
    pages: string[][] = [];
  for (let i = 0; i < content.length; i += perPage) pages.push(content.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const fontId = 3 + pages.length * 2,
    objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((lines, i) => {
    const pid = 3 + i * 2,
      cid = pid + 1;
    const heading = esc(title.slice(0, 100)),
      body = lines.map((l, j) => `${j ? "T* " : ""}(${esc(l)}) Tj`).join(" ");
    const stream = `BT /F1 15 Tf 42 805 Td (${heading}) Tj /F1 8 Tf 0 -18 Td (VSM Growth Operations | Generated ${new Date().toISOString()}) Tj /F1 9 Tf 0 -24 Td 13 TL ${body} ET BT /F1 8 Tf 500 24 Td (Page ${i + 1} of ${pages.length}) Tj ET`;
    objs[pid] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`;
    objs[cid] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
