// Title helpers: priority (P1/P2/P3/skip), seniority and the cheap QA pre-filter.
import type { Targeting } from "../config.js";
import type { Job, TitlePriority } from "../schema.js";
import { containsPhrase } from "./text.js";

/** Skip wins; otherwise the best matching priority wins. */
export function titlePriority(title: string, t: Targeting): TitlePriority {
  if (t.titles.skip.some((p) => containsPhrase(title, p))) return "skip";
  if (t.titles.p1.some((p) => containsPhrase(title, p))) return "p1";
  if (t.titles.p2.some((p) => containsPhrase(title, p))) return "p2";
  if (t.titles.p3.some((p) => containsPhrase(title, p))) return "p3";
  return "unknown";
}

/** Keep only QA-ish titles before doing any real work. */
export function passesTitlePrefilter(title: string, t: Targeting): boolean {
  return t.prefilterTitleKeywords.some((k) => containsPhrase(title, k));
}

export function seniorityOf(title: string): Job["seniorityHint"] {
  if (/\b(lead|principal|staff|head)\b/i.test(title)) return "lead";
  if (/\b(senior|sr)\b/i.test(title)) return "senior";
  if (/\b(junior|jr|entry|intern|graduate)\b/i.test(title)) return "junior";
  if (/\b(mid|intermediate)\b/i.test(title)) return "mid";
  return "unknown";
}

/** Largest "N years" / "N+ yrs" / "N-M years" mentioned, capped to ignore nonsense. */
export function yearsRequired(text: string): number | null {
  let best: number | null = null;
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)\b/gi;
  for (const m of text.matchAll(re)) {
    // For a range like "3-5 years" the requirement is the lower number.
    const n = Number(m[1]);
    if (n > 0 && n <= 15 && (best === null || n > best)) best = n;
  }
  return best;
}
