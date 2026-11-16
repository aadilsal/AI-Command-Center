import { PDFDocument, PDFFont, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";

// =============================================================================
// One-page, ATS-friendly CV renderer (same look as your ReportLab CVs).
// ATS rules followed on purpose:
//   - one column, top-to-bottom reading order, no tables, text boxes, icons or images
//   - standard section names (SUMMARY, TECHNICAL SKILLS, EXPERIENCE, PROJECTS, EDUCATION)
//   - real, selectable text in standard fonts (Helvetica) with plain "•" bullets
//   - contact details as plain text on the page (not only in links/headers)
//   - consistent "Mon YYYY - Mon YYYY" dates
//   - PDF title/author/keywords metadata set
//   - no hidden or white text, no keyword stuffing
// =============================================================================

export type CvDoc = {
  name: string;
  headline: string;
  contact: string[]; // e.g. ["Lahore, Pakistan (Remote, UTC+5)", "email", "phone"]
  links: string[];
  summary: string;
  skills: { label: string; items: string[] }[];
  experience: { role: string; org: string; dates: string; bullets: string[] }[];
  projects: { name: string; context?: string; url?: string; stack: string[]; bullets: string[] }[];
  education: { degree: string; org: string; dates: string }[];
  keywords?: string[];
};

export type Style = { body: number; leading: number; section: number; gap: number };

export const STYLES: Style[] = [
  { body: 9, leading: 11.7, section: 10.2, gap: 7 }, // same as your hand-made CVs
  { body: 8.8, leading: 11.2, section: 10, gap: 6 },
  { body: 8.6, leading: 10.8, section: 9.8, gap: 5 },
];

const A4 = { w: 595.276, h: 841.89 };
const MARGIN = { x: 40, top: 40, bottom: 34 };
const BLACK = rgb(0, 0, 0);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Run = { text: string; font: PDFFont; link?: string };

// Keep only characters the standard PDF fonts can draw (WinAnsi); map the common ones
function safe(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  const map: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", " ": " ", " ": " ", "​": "" };
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (supported.has(code)) out += ch;
    else if (map[ch] !== undefined) out += map[ch];
    else {
      const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += [...plain].every((c) => supported.has(c.codePointAt(0)!)) ? plain : "";
    }
  }
  return out;
}

class Writer {
  page: PDFPage;
  y: number;
  overflow = false;
  constructor(
    private doc: PDFDocument,
    private f: Fonts,
    private s: Style
  ) {
    this.page = doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGIN.top;
  }
  get width() {
    return A4.w - MARGIN.x * 2;
  }
  private down(h: number) {
    this.y -= h;
    if (this.y < MARGIN.bottom) this.overflow = true;
  }

  private addLink(x: number, y: number, w: number, h: number, url: string) {
    const href = /^https?:\/\//.test(url) ? url : url.includes("@") ? `mailto:${url}` : `https://${url}`;
    const annot = this.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y - 2, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
    });
    const ref = this.doc.context.register(annot);
    this.page.node.addAnnot(ref);
  }

  // Draw runs of mixed fonts, wrapping words across lines
  rich(runs: Run[], size: number, opts: { indent?: number; hang?: number; center?: boolean; leading?: number; underlineLinks?: boolean } = {}) {
    const leading = opts.leading ?? this.s.leading;
    const indent = opts.indent ?? 0;
    const hang = opts.hang ?? indent;
    type Word = { text: string; font: PDFFont; link?: string; space: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      const text = safe(r.font, r.text);
      const parts = text.split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) {
          if (words.length) words[words.length - 1].space = true;
        } else words.push({ text: p, font: r.font, link: r.link, space: false });
      }
    }
    const lines: Word[][] = [];
    let line: Word[] = [];
    let lineW = 0;
    let first = true;
    const spaceW = this.f.regular.widthOfTextAtSize(" ", size);
    for (const w of words) {
      const ww = w.font.widthOfTextAtSize(w.text, size);
      const prevSpace = line.length && line[line.length - 1].space ? spaceW : 0;
      const avail = this.width - (first ? indent : hang);
      if (line.length && lineW + prevSpace + ww > avail) {
        lines.push(line);
        line = [];
        lineW = 0;
        first = false;
      }
      lineW += (line.length && line[line.length - 1].space ? spaceW : 0) + ww;
      line.push(w);
    }
    if (line.length) lines.push(line);

    lines.forEach((ln, i) => {
      this.down(leading);
      const total = ln.reduce((acc, w, j) => acc + w.font.widthOfTextAtSize(w.text, size) + (j < ln.length - 1 && w.space ? spaceW : 0), 0);
      let x = MARGIN.x + (opts.center ? (this.width - total) / 2 : i === 0 ? indent : hang);
      const baseY = this.y + (leading - size) * 0.35;
      for (let j = 0; j < ln.length; j++) {
        const w = ln[j];
        const wWidth = w.font.widthOfTextAtSize(w.text, size);
        this.page.drawText(w.text, { x, y: baseY, size, font: w.font, color: BLACK });
        if (w.link) {
          if (opts.underlineLinks) this.page.drawLine({ start: { x, y: baseY - 1.3 }, end: { x: x + wWidth, y: baseY - 1.3 }, thickness: 0.5, color: BLACK });
          this.addLink(x, baseY, wWidth, size, w.link);
        }
        x += wWidth + (w.space && j < ln.length - 1 ? spaceW : 0);
      }
    });
  }

  section(title: string) {
    this.down(this.s.gap);
    this.down(this.s.section + 2);
    this.page.drawText(title, { x: MARGIN.x, y: this.y + 2.5, size: this.s.section, font: this.f.bold, color: BLACK });
    this.page.drawLine({ start: { x: MARGIN.x, y: this.y + 0.5 }, end: { x: MARGIN.x + this.width, y: this.y + 0.5 }, thickness: 0.6, color: BLACK });
    this.down(2.5);
  }

  bullet(text: string) {
    const size = this.s.body;
    const indent = 4;
    const hang = 12;
    // bullet glyph at indent, text hangs at 12pt
    const before = this.y;
    this.rich([{ text, font: this.f.regular }], size, { indent: hang, hang });
    const firstLineY = before - this.s.leading + (this.s.leading - size) * 0.35;
    this.page.drawText("•", { x: MARGIN.x + indent, y: firstLineY, size, font: this.f.regular, color: BLACK });
  }

  space(h: number) {
    this.down(h);
  }
}

async function newDoc(title: string, author: string, keywords: string[] = []) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setCreator(author);
  doc.setProducer("Command Center CV Builder");
  if (keywords.length) doc.setKeywords(keywords.slice(0, 30));
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  return { doc, fonts };
}

export async function renderCv(cv: CvDoc, style: Style): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  const { doc, fonts: f } = await newDoc(`${cv.name} - CV`, cv.name, cv.keywords);
  const w = new Writer(doc, f, style);

  // Header
  w.rich([{ text: cv.name, font: f.bold }], 19, { center: true, leading: 22 });
  w.rich([{ text: cv.headline, font: f.regular }], 9.8, { center: true, leading: 12.7 });
  const contactRuns: Run[] = [];
  cv.contact.forEach((c, i) => {
    if (i) contactRuns.push({ text: " | ", font: f.regular });
    contactRuns.push({ text: c, font: f.regular, link: c.includes("@") ? c : undefined });
  });
  w.rich(contactRuns, 8.6, { center: true, leading: 11.2, underlineLinks: true });
  const linkRuns: Run[] = [];
  cv.links.forEach((l, i) => {
    if (i) linkRuns.push({ text: " | ", font: f.regular });
    linkRuns.push({ text: l, font: f.regular, link: l });
  });
  if (linkRuns.length) w.rich(linkRuns, 8.6, { center: true, leading: 11.2, underlineLinks: true });

  // Summary
  w.section("SUMMARY");
  w.rich([{ text: cv.summary, font: f.regular }], style.body);

  // Skills
  w.section("TECHNICAL SKILLS");
  for (const g of cv.skills) {
    if (!g.items.length) continue;
    w.rich(
      [
        { text: `${g.label}:`, font: f.bold },
        { text: ` ${g.items.join(", ")}`, font: f.regular },
      ],
      style.body
    );
  }

  // Experience
  w.section("EXPERIENCE");
  cv.experience.forEach((e, i) => {
    if (i) w.space(2);
    w.rich(
      [
        { text: e.role, font: f.bold },
        { text: `, ${e.org} | ${e.dates}`, font: f.regular },
      ],
      style.body
    );
    for (const b of e.bullets) w.bullet(b);
  });

  // Projects
  if (cv.projects.length) {
    w.section("PROJECTS");
    cv.projects.forEach((p, i) => {
      if (i) w.space(2);
      const runs: Run[] = [{ text: p.name, font: f.bold }];
      if (p.context) runs.push({ text: ` (${p.context})`, font: f.regular });
      if (p.url) {
        runs.push({ text: " | ", font: f.regular });
        runs.push({ text: p.url, font: f.regular, link: p.url });
      }
      w.rich(runs, style.body, { underlineLinks: true });
      if (p.stack.length) w.rich([{ text: p.stack.join(", "), font: f.italic }], style.body);
      for (const b of p.bullets) w.bullet(b);
    });
  }

  // Education
  w.section("EDUCATION");
  for (const ed of cv.education) {
    w.rich(
      [
        { text: ed.degree, font: f.bold },
        { text: `, ${ed.org} | ${ed.dates}`, font: f.regular },
      ],
      style.body
    );
  }

  return { bytes: await doc.save(), overflow: w.overflow || doc.getPageCount() > 1 };
}

// Cover letter in the same style (plain, one page)
export async function renderLetter(input: {
  name: string;
  contact: string[];
  links: string[];
  date: string;
  body: string;
}): Promise<Uint8Array> {
  const { doc, fonts: f } = await newDoc(`${input.name} - Cover Letter`, input.name);
  const w = new Writer(doc, f, STYLES[0]);
  w.rich([{ text: input.name, font: f.bold }], 19, { center: true, leading: 22 });
  w.rich([{ text: input.contact.join(" | "), font: f.regular }], 8.6, { center: true, leading: 11.2 });
  if (input.links.length) w.rich([{ text: input.links.join(" | "), font: f.regular }], 8.6, { center: true, leading: 11.2 });
  w.space(14);
  w.rich([{ text: input.date, font: f.regular }], 10, { leading: 13 });
  w.space(8);
  for (const para of input.body.split(/\n\s*\n/)) {
    w.rich([{ text: para.replace(/\s*\n\s*/g, " ").trim(), font: f.regular }], 10, { leading: 14 });
    w.space(7);
  }
  return await doc.save();
}

