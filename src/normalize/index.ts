// Turns what a source adapter extracted (RawJob) into the one Job schema.
import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import { Job, type AtsBoard, type SalaryPeriod } from "../schema.js";
import { cleanUrl, detectAts, findApplyEmail, findAtsBoard } from "./ats.js";
import { classifyLocation, detectArabic, detectEor } from "./location.js";
import { parseSalaryText, salaryFromNumbers, type Salary } from "./salary.js";
import { normalizeForMatch, stripHtml, truncate } from "./text.js";
import { seniorityOf, yearsRequired } from "./title.js";

/** The fields each source adapter must fill in. Everything else is derived here. */
export interface RawJob {
  source: string;
  sourceId: string;
  url: string;
  applyUrl: string | null;
  title: string;
  company: string;
  companyUrl?: string | null;
  locationText: string;
  /** Structured list of allowed countries/regions, when the source provides one. */
  places?: string[];
  salaryText?: string | null;
  salaryNumbers?: { min: number | null; max: number | null; period: SalaryPeriod; currency: string } | null;
  employmentTypeRaw?: string | null;
  postedAt: string | null;
  descriptionHtml: string;
  tags?: string[];
  /** Set by the ATS adapters, which know the board they read from. */
  atsBoard?: AtsBoard | null;
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|bv|ag|srl)\b/g;

export function normalizeCompany(name: string): string {
  return normalizeForMatch(name).replace(COMPANY_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

/** Seniority words are kept out of the id so "Sr QA Engineer" and "Senior QA Engineer" match. */
export function normalizeTitleForId(title: string): string {
  return normalizeForMatch(title)
    .replace(/\b(senior|sr|junior|jr|mid|level|remote|i{1,3}|[0-9])\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jobId(company: string, title: string): string {
  return createHash("sha1").update(`${normalizeCompany(company)}|${normalizeTitleForId(title)}`).digest("hex").slice(0, 16);
}

function employmentType(raw: string | null | undefined): Job["employmentType"] {
  const t = (raw ?? "").toLowerCase();
  if (/full/.test(t)) return "full_time";
  if (/part/.test(t)) return "part_time";
  if (/contract|contractor/.test(t)) return "contract";
  if (/freelance/.test(t)) return "freelance";
  return "unknown";
}

/** Returns a validated Job, or throws with the reason (caller logs and skips it). */
export function toJob(raw: RawJob, cfg: Config, now: Date): Job {
  const description = truncate(stripHtml(raw.descriptionHtml), cfg.limits.maxDescriptionChars);
  const fullText = `${raw.title}\n${raw.locationText}\n${description}`;
  const viaEor = detectEor(fullText, cfg.targeting);
  const location = classifyLocation(
    { places: raw.places, locationText: raw.locationText, description, viaEor },
    cfg.targeting,
  );

  let salary: Salary | null = null;
  if (raw.salaryNumbers) {
    const s = raw.salaryNumbers;
    salary = salaryFromNumbers(s.min, s.max, s.period, s.currency, cfg.limits.fx);
  }
  if (!salary && raw.salaryText) salary = parseSalaryText(raw.salaryText, cfg.limits.fx);

  const applyUrl = cleanUrl(raw.applyUrl);
  const applyEmail = findApplyEmail(description);
  const arabicPlus = detectArabic(fullText, cfg.targeting);
  // The company's own ATS board: from the apply link, else from a link inside the post.
  const atsBoard = raw.atsBoard ?? findAtsBoard(applyUrl) ?? findAtsBoard(raw.descriptionHtml);

  return Job.parse({
    id: jobId(raw.company, raw.title),
    source: raw.source,
    sourceId: raw.sourceId,
    url: raw.url,
    applyUrl,
    applyEmail,
    ats: detectAts(applyUrl, applyEmail),
    title: raw.title.trim(),
    company: raw.company.trim(),
    companyUrl: raw.companyUrl ?? null,
    locationRaw: raw.places?.length ? raw.places.join(", ") : raw.locationText,
    remoteScope: location.scope,
    allowedCountries: raw.places ?? [],
    viaEor,
    segment: location.scope === "gulf" || arabicPlus ? "mena_gulf" : "global",
    arabicPlus,
    atsBoard,
    salaryRaw: raw.salaryText ?? (raw.salaryNumbers ? `${raw.salaryNumbers.min ?? ""}-${raw.salaryNumbers.max ?? ""} ${raw.salaryNumbers.currency}/${raw.salaryNumbers.period}` : null),
    salaryMinUsdMonth: salary?.minUsdMonth ?? null,
    salaryMaxUsdMonth: salary?.maxUsdMonth ?? null,
    salaryPeriod: salary?.period ?? null,
    employmentType: employmentType(raw.employmentTypeRaw),
    seniorityHint: seniorityOf(raw.title),
    yearsRequired: yearsRequired(description),
    postedAt: raw.postedAt,
    description,
    tags: raw.tags ?? [],
    fetchedAt: now.toISOString(),
  });
}
