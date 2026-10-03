// Builds the tailored CV: docs/cv-master.md word for word, with only the Summary replaced by the
// fact-checked tailored one. Rendered to HTML, then to PDF with Playwright (Chromium).
import { readFileSync } from "node:fs";
import path from "node:path";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** **bold** and *italic*, after escaping. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");

/** The master CV without build notes and the "CV variants" table, which are not for employers. */
export function loadCvMarkdown(root = process.cwd()): string {
  const md = readFileSync(path.join(root, "docs", "cv-master.md"), "utf8");
  return (md.split(/^## CV variants/m)[0] ?? md)
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n");
}

/** Swaps the paragraph under "## Summary" for the tailored one. */
export function withSummary(md: string, summary: string): string {
  return md.replace(/(^## Summary\s*\n+)[^\n]+/m, (_, head: string) => `${head}${summary.replace(/\s+/g, " ").trim()}`);
}

/** Tiny converter for the few markdown forms cv-master.md uses. */
export function cvHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  let afterH1 = 0;
  const closeList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith("### ")) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) {
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
      afterH1 = 2;
      continue;
    } else if (afterH1 > 0) out.push(`<p class="${afterH1 === 2 ? "headline" : "contact"}">${inline(line)}</p>`);
    else out.push(`<p>${inline(line)}</p>`);
    if (afterH1 > 0) afterH1--;
  }
  closeList();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Islam Ibrahim Abu-Khadija CV</title><style>
@page { size: A4; margin: 14mm 15mm; }
body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10pt; line-height: 1.38; color: #1a1a1a; }
h1 { font-size: 19pt; margin: 0 0 2px; }
.headline { font-weight: 600; margin: 0 0 2px; }
.contact { color: #444; font-size: 9pt; margin: 0 0 6px; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #bbb; margin: 12px 0 5px; padding-bottom: 2px; }
h3 { font-size: 10.2pt; margin: 8px 0 2px; }
p { margin: 3px 0; }
ul { margin: 2px 0 4px; padding-left: 16px; }
li { margin: 1px 0; }
h2, h3 { break-after: avoid; }
li { break-inside: avoid; }
</style></head><body>${out.join("\n")}</body></html>`;
}

/** Writes the PDF. Playwright is loaded only here so tests and fetch runs never need Chromium. */
export async function renderPdf(html: string, file: string): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: file, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
