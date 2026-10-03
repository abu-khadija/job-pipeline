// Works out which applicant tracking system an apply URL belongs to.
import type { Ats } from "../schema.js";

const HOSTS: [RegExp, Ats][] = [
  [/(^|\.)greenhouse\.io$/, "greenhouse"],
  [/^jobs\.lever\.co$/, "lever"],
  [/^jobs\.ashbyhq\.com$/, "ashby"],
  [/(^|\.)workable\.com$/, "workable"],
  [/(^|\.)recruitee\.com$/, "recruitee"],
  [/(^|\.)teamtailor\.com$/, "teamtailor"],
  [/(^|\.)bamboohr\.com$/, "bamboohr"],
  [/(^|\.)personio\.(de|com)$/, "personio"],
  [/(^|\.)breezy\.hr$/, "breezy"],
  [/(^|\.)applytojob\.com$|(^|\.)jazzhr\.com$/, "jazzhr"],
  [/(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$/, "workday"],
  [/(^|\.)icims\.com$/, "icims"],
  [/(^|\.)smartrecruiters\.com$/, "smartrecruiters"],
  [/(^|\.)taleo\.net$/, "taleo"],
  [/(^|\.)successfactors\.(com|eu)$/, "successfactors"],
];

export function detectAts(applyUrl: string | null, applyEmail: string | null): Ats {
  if (applyUrl?.startsWith("mailto:")) return "email";
  if (applyUrl) {
    try {
      const host = new URL(applyUrl).hostname.toLowerCase();
      for (const [re, ats] of HOSTS) if (re.test(host)) return ats;
      return "other";
    } catch {
      return "unknown";
    }
  }
  return applyEmail ? "email" : "unknown";
}

/** An application email only if it is literally in the post. Never constructed. */
export function findApplyEmail(text: string): string | null {
  const m = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (!m) return null;
  const email = m[0];
  // Ignore obvious non-application addresses.
  if (/^(no-?reply|privacy|legal|security|abuse|support)@/i.test(email)) return null;
  return email;
}

/** Keep only http(s) URLs; anything else becomes null. */
export function cleanUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
