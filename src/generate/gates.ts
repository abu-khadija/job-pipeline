// Plain-code checks on a generated draft (docs/PLAN.md section 12). Gate 1 (fact check) is a model
// pass in writer.ts; everything here is code, so a job post can never talk its way through.
import type { Writing } from "../config.js";
import type { AiDraft, CvVariant, DraftRow } from "../schema.js";

export interface GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

/** "Codest Ltd. Company No. 12590542, VAT number: GB363431020" → "Codest". */
export function cleanCompany(name: string): string {
  let s = name.split(/\b(company no|company number|vat|registration|reg\. no)\b/i)[0] ?? name;
  s = s.replace(/[\s,.;:-]+$/, "").trim();
  // Legal suffixes read oddly in a letter; drop one at the end.
  s = s.replace(/[\s,]+(ltd\.?|limited|inc\.?|llc|gmbh|s\.?a\.?|b\.?v\.?|sp\. z o\.o\.|plc|corp\.?|co\.)$/i, "").trim();
  return s || name.trim();
}

/** "QA Automation Engineer (m/f/d) - AI-First Quality Engineering" → "QA Automation Engineer". */
export function cleanTitle(title: string): string {
  let s = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  s = s.split(/\s[-–—|]\s|,/)[0] ?? s;
  return s.replace(/\s+/g, " ").trim() || title.trim();
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** First match on the job title wins (config/writing.yaml → variants). */
export function pickVariant(title: string, w: Writing): CvVariant {
  const t = title.toLowerCase();
  if (w.variants.mobile_qa.some((k) => t.includes(k))) return "mobile_qa";
  if (w.variants.qa_analyst.some((k) => t.includes(k)) && !t.includes("automation")) return "qa_analyst";
  return "ai_automation";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Gate 2: banned words and claims, numbers not in the profile, ticket ids, AI-built work called hand-written, lengths. */
export function bannedClaimsGate(d: AiDraft, w: Writing, job: { title: string; company: string }): GateResult {
  const problems: string[] = [];
  const texts: [string, string][] = [
    ["cover letter", d.coverLetter],
    ["email", `${d.emailSubject}\n${d.emailBody}`],
    ["CV summary", d.cvSummary],
  ];
  // Numbers that are part of the company or job title are fine ("Web3", "Company 42").
  const ownNumbers = new Set((`${job.title} ${job.company}`.match(/\d+/g) ?? []).map(Number));
  const allowed = new Set([...w.allowedNumbers, ...ownNumbers]);
  const verbs = w.handBuiltVerbs.map(escapeRe).join("|");
  const work = w.aiBuiltWork.map(escapeRe).join("|");
  const handBuilt = new RegExp(`\\b(${verbs})\\b[^.\\n]{0,60}?(${work})|(${work})[^.\\n]{0,30}?\\b(i|we)\\s+(${verbs})\\b`, "i");

  for (const [where, text] of texts) {
    const lower = text.toLowerCase();
    for (const word of w.bannedWords) if (lower.includes(word.toLowerCase())) problems.push(`${where}: banned word "${word}"`);
    for (const pattern of w.bannedClaims) {
      const m = text.match(new RegExp(pattern, "i"));
      if (m) problems.push(`${where}: banned claim "${m[0]}"`);
    }
    for (const n of text.match(/\b\d[\d,]*(\.\d+)?\b/g) ?? []) {
      const value = Number(n.replace(/,/g, ""));
      if (!allowed.has(value)) problems.push(`${where}: number "${n}" is not in the profile`);
    }
    const ticket = text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/);
    if (ticket) problems.push(`${where}: looks like a ticket id "${ticket[0]}"`);
    const hb = text.match(handBuilt);
    if (hb && !/selenium|vezeeta|testng/i.test(hb[0])) problems.push(`${where}: AI-built work described as hand-built ("${hb[0]}")`);
    if ((text.match(/—/g) ?? []).length > 1) problems.push(`${where}: more than one em dash`);
  }

  const len = (label: string, text: string, r: { min: number; max: number }) => {
    const n = wordCount(text);
    if (n < r.min || n > r.max) problems.push(`${label}: ${n} words (allowed ${r.min}-${r.max})`);
  };
  len("cover letter", d.coverLetter, w.words.coverLetter);
  len("email", d.emailBody, w.words.emailBody);
  len("CV summary", d.cvSummary, w.words.cvSummary);
  if (!d.emailSubject.trim()) problems.push("email: empty subject");

  return { gate: "2 banned", pass: problems.length === 0, detail: problems.join("; ") };
}

/** Gate 3: both messages name the company and the role, and the post detail appears in at least one. */
export function companyRoleGate(d: AiDraft, company: string, role: string): GateResult {
  const problems: string[] = [];
  const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());
  for (const [label, text] of [["cover letter", d.coverLetter], ["email", `${d.emailSubject}\n${d.emailBody}`]] as const) {
    if (!has(text, company)) problems.push(`${label} does not name "${company}"`);
    if (!has(text, role)) problems.push(`${label} does not name the role "${role}"`);
  }
  if (!d.postDetail.trim()) problems.push("no specific detail from the post");
  return { gate: "3 match", pass: problems.length === 0, detail: problems.join("; ") };
}

/** Gate 4: one draft per company within the cooldown (Contacts tab takes over in Phase 3). */
export function companyLimitGate(company: string, drafts: DraftRow[], now: Date, cooldownDays: number): GateResult {
  const key = cleanCompany(company).toLowerCase();
  const since = now.getTime() - cooldownDays * 86_400_000;
  const recent = drafts.find(
    (r) => r.status !== "skipped" && cleanCompany(r.company).toLowerCase() === key && Date.parse(r.created_at) >= since,
  );
  return recent
    ? { gate: "4 company", pass: false, detail: `already drafted for "${recent.title}" on ${recent.created_at.slice(0, 10)}` }
    : { gate: "4 company", pass: true, detail: "" };
}

/** Gate 6: where the application goes. An email address is used only if it was literally in the post. */
export function routeFor(job: { applyEmail: string | null; applyUrl: string | null; url: string; ats: string }): { route: "email" | "form" | "link"; to: string } {
  if (job.applyEmail) return { route: "email", to: job.applyEmail };
  if (["greenhouse", "lever", "ashby"].includes(job.ats) && job.applyUrl) return { route: "form", to: job.applyUrl };
  return { route: "link", to: job.applyUrl ?? job.url };
}

export function formatGates(results: GateResult[]): string {
  return results.map((g) => `${g.gate}: ${g.pass ? "pass" : "FAIL"}${g.detail ? ` (${g.detail})` : ""}`).join(" | ");
}
