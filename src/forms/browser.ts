// Phase 4 browser part: opens an application form in a visible Chrome window on the Mac, fills
// what it can and colours every field: green = filled, yellow = check it, red = only you can answer.
// It never clicks Submit. Islam reviews and submits (the forms have CAPTCHAs; we never get past those).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import { renderPdf } from "../generate/cv.js";
import { answerFor, type AnswerContext, type FieldInfo } from "./answers.js";

export interface FillReport {
  url: string;
  filled: string[];
  check: string[];
  ask: string[];
  error: string;
}

/** Opens and fills one form. Tests use a fake. */
export interface FormFiller {
  fill(applyUrl: string, ats: string, folder: string, ctx: AnswerContext): Promise<FillReport>;
  close(): Promise<void>;
}

interface Collected extends FieldInfo {
  idx: string;
  group: string;
  visible: boolean;
}

// Runs inside the page. Tags every field with data-jp so Node can find it again.
/* c8 ignore start */
function collectInPage(): Collected[] {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const labelOf = (el: Element): string => {
    const id = el.getAttribute("id");
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l) return clean((l as HTMLElement).innerText);
    }
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((x) => clean(document.getElementById(x)?.innerText)).join(" ");
      if (t.trim()) return t;
    }
    const own = el.closest("label");
    if (own) return clean(own.innerText);
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    let n: Element | null = el.parentElement;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      const l = n.querySelector("label, legend, [class*='label']");
      if (l && clean((l as HTMLElement).innerText)) return clean((l as HTMLElement).innerText);
    }
    return clean(el.getAttribute("placeholder"));
  };
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const required = (el: Element, label: string) =>
    (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(label);

  const out: Collected[] = [];
  const groups = new Map<string, HTMLInputElement[]>();
  let n = 0;
  const all = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox']"));
  for (const el of all) {
    const type = (el.getAttribute("type") ?? el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "search", "image", "reset"].includes(type)) continue;
    if ((el as HTMLElement).closest("[class*='recaptcha'], [class*='captcha']") || /recaptcha/.test((el as HTMLInputElement).name ?? "")) continue;
    const role = el.getAttribute("role");
    const isCombo = role === "combobox" || el.getAttribute("aria-autocomplete") === "list";
    // A plain input that sits next to a custom dropdown is its hidden partner: skip it.
    if (!isCombo && el.tagName === "INPUT" && type === "text" && el.parentElement?.parentElement?.querySelector("[role='combobox']")) continue;
    if (type === "radio" || type === "checkbox") {
      const name = (el as HTMLInputElement).name || `__${n++}`;
      groups.set(name, [...(groups.get(name) ?? []), el as HTMLInputElement]);
      continue;
    }
    if (type !== "file" && !visible(el)) continue;
    const idx = String(n++);
    el.setAttribute("data-jp", idx);
    // File inputs are often labelled just "Attach": their id/name ("resume", "cover_letter") says which.
    const label = type === "file" ? clean(`${labelOf(el)} ${el.id} ${(el as HTMLInputElement).name}`.replace(/[_-]/g, " ")) : labelOf(el);
    const kind = type === "file" ? "file" : el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : isCombo ? "combobox" : "text";
    const options = el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => clean(o.text)).filter((t) => t && !/^select/i.test(t)) : [];
    out.push({ idx, group: "", kind, question: label, options, required: required(el, label), visible: visible(el) });
  }
  // Radio/checkbox groups: the question is the text of the smallest box holding all options.
  for (const [name, inputs] of groups) {
    const optionText = (i: HTMLInputElement) => clean(i.closest("label")?.innerText ?? (i.id ? (document.querySelector(`label[for="${CSS.escape(i.id)}"]`) as HTMLElement | null)?.innerText : "") ?? i.value);
    const options = inputs.map(optionText);
    let box: Element | null = inputs[0]!.parentElement;
    while (box && !inputs.every((i) => box!.contains(i))) box = box.parentElement;
    for (let i = 0; i < 3 && box && clean((box as HTMLElement).innerText).length <= options.join(" ").length + 2; i++) box = box.parentElement;
    const legend = box?.querySelector("legend, [class*='question'], [class*='label']");
    let question = clean((legend as HTMLElement | null)?.innerText);
    if (!question && box) {
      question = clean((box as HTMLElement).innerText);
      for (const o of options) question = question.replace(o, " ");
      question = clean(question).slice(0, 200);
    }
    const idx = String(n++);
    inputs.forEach((i) => i.setAttribute("data-jp", idx));
    const single = inputs.length === 1;
    out.push({
      idx, group: name, kind: single && inputs[0]!.type === "checkbox" ? "checkbox" : "radio",
      question: single ? options[0] ?? question : question, options: single ? [] : options,
      required: inputs.some((i) => i.required || i.getAttribute("aria-required") === "true") || /[*✱]/.test(question),
      visible: inputs.some((i) => visible(i) || visible(i.closest("label") ?? i)),
    });
  }
  // Custom dropdowns often come with a plain input carrying the same question: keep the dropdown.
  const combos = new Set(out.filter((f) => f.kind === "combobox").map((f) => f.question));
  return out.filter((f) => (f.kind === "file" || f.visible) && !(f.kind === "text" && combos.has(f.question)));
}
/* c8 ignore stop */

const COLOURS = { fill: "#1a9e4b", check: "#d4a106", ask: "#d62828" } as const;

async function mark(frame: Frame, idx: string, colour: string) {
  await frame.evaluate(([i, c]) => {
    document.querySelectorAll(`[data-jp="${i}"]`).forEach((el) => {
      const t = (el as HTMLInputElement).type;
      const combo = el.getAttribute("role") === "combobox";
      const target = t === "file" || t === "radio" || t === "checkbox"
        ? (el.closest("label")?.parentElement ?? el.parentElement ?? el) as HTMLElement
        : combo ? ((el.parentElement?.parentElement?.parentElement ?? el) as HTMLElement) : (el as HTMLElement);
      target.style.outline = `3px solid ${c}`;
      target.style.outlineOffset = "2px";
    });
  }, [idx, colour] as const).catch(() => undefined);
}

/** Where the form lives. Himalayas pages link out to the company's own form. */
async function openForm(page: Page, url: string, ats: string): Promise<string> {
  let target = url;
  if (ats === "lever" && !/\/apply\/?$/.test(target)) target = target.replace(/\/?$/, "/apply");
  if (ats === "ashby" && !/\/application\/?$/.test(target)) target = target.replace(/\/?$/, "/application");
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  if (new URL(page.url()).hostname.endsWith("himalayas.app")) {
    // The "Apply" button on Himalayas leads to the company's own page.
    const apply = page.getByRole("link", { name: /apply/i }).first();
    if (await apply.count()) {
      const popup = page.context().waitForEvent("page", { timeout: 8_000 }).catch(() => null);
      await apply.click();
      const next = await popup;
      if (next) {
        await next.waitForLoadState("domcontentloaded");
        await page.goto(next.url(), { waitUntil: "domcontentloaded" });
        await next.close();
      }
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    }
  }
  // Some job pages show the description first, with an "Apply" button that reveals the form.
  const fields = await page.locator("input:visible, textarea:visible").count();
  if (fields < 3) {
    const btn = page.getByRole("button", { name: /^apply/i }).or(page.getByRole("link", { name: /^apply( now| for this job)?$/i })).first();
    if (await btn.count()) {
      await btn.click().catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    }
  }
  return page.url();
}

export class PlaywrightFiller implements FormFiller {
  private ctx: BrowserContext | null = null;

  constructor(private profileDir = path.join(process.cwd(), "out", "browser-profile")) {}

  private async context(): Promise<BrowserContext> {
    if (!this.ctx) {
      const { chromium } = await import("playwright");
      // A visible window and a kept profile, like a normal browser: Islam watches and submits.
      this.ctx = await chromium.launchPersistentContext(this.profileDir, { headless: false, viewport: null });
    }
    return this.ctx;
  }

  async fill(applyUrl: string, ats: string, folder: string, actx: AnswerContext): Promise<FillReport> {
    const report: FillReport = { url: applyUrl, filled: [], check: [], ask: [], error: "" };
    const page = await (await this.context()).newPage();
    try {
      report.url = await openForm(page, applyUrl, ats);
      const cv = path.join(folder, "Islam-Abu-Khadija-CV.pdf");
      const cover = path.join(folder, "cover-letter.pdf");
      let seen = 0;
      for (const frame of page.frames()) {
        // tsx compiles named functions with a `__name` helper that pages don't have: define it there.
        await frame.evaluate("globalThis.__name = globalThis.__name || ((f) => f)").catch(() => undefined);
        const fields = await frame.evaluate(collectInPage).catch(() => [] as Collected[]);
        seen += fields.length;
        for (const f of fields) {
          const a = answerFor(f, actx);
          const label = f.question.slice(0, 80) || "(no label)";
          const loc = frame.locator(`[data-jp="${f.idx}"]`);
          try {
            if (a.action === "skip") continue;
            if (a.action === "ask") {
              report.ask.push(`${label} — ${a.reason}`);
              await mark(frame, f.idx, COLOURS.ask);
              continue;
            }
            if (a.action === "file") {
              if (a.file === "cover" && !existsSync(cover)) {
                await renderPdf(`<html><body style="font-family:Arial;font-size:11pt;line-height:1.5;white-space:pre-wrap;margin:0">${actx.coverLetter.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</body></html>`, cover);
              }
              await loc.first().setInputFiles(a.file === "cv" ? cv : cover);
              report.filled.push(`${label}: ${a.file === "cv" ? "CV PDF" : "cover letter PDF"}`);
              await mark(frame, f.idx, COLOURS.fill);
              continue;
            }
            if (f.kind === "select") await loc.first().selectOption({ label: a.value });
            else if (f.kind === "radio") await loc.nth(f.options.indexOf(a.value)).check({ force: true });
            else if (f.kind === "combobox") {
              await loc.first().click();
              await loc.first().fill(a.value);
              await frame.waitForTimeout(900);
              await loc.first().press("Enter");
            } else await loc.first().fill(a.value);
            (a.action === "fill" ? report.filled : report.check).push(`${label}: ${a.value.length > 60 ? `${a.value.slice(0, 60)}…` : a.value}`);
            await mark(frame, f.idx, a.action === "fill" ? COLOURS.fill : COLOURS.check);
          } catch (err) {
            report.ask.push(`${label} — could not fill automatically (${err instanceof Error ? err.message.split("\n")[0]!.slice(0, 80) : err})`);
            await mark(frame, f.idx, COLOURS.ask);
          }
        }
      }
      if (seen < 2) report.error = "no application form found on the page (apply by hand)";
      await page.screenshot({ path: path.join(folder, "form-filled.png"), fullPage: true }).catch(() => undefined);
      writeFileSync(path.join(folder, "form-report.txt"), [`URL: ${report.url}`, "", "Filled:", ...report.filled, "", "Check:", ...report.check, "", "You must answer:", ...report.ask, report.error].join("\n") + "\n");
    } catch (err) {
      report.error = `could not open the form: ${err instanceof Error ? err.message.split("\n")[0] : err}`;
    }
    // The page stays open for Islam to review and submit.
    return report;
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
