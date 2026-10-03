// Verdict: can someone in Egypt get this job, according to the company's own site?
// Used by the fetch run (before a job is shortlisted) and by `npm run verify` (jobs already in the Sheet).
import type { Targeting } from "../config.js";
import { classifyLocation, detectEor } from "../normalize/location.js";
import type { HttpGet } from "../util/http.js";
import { findCompanyPosting, type CompanyPosting } from "./companySite.js";

export interface Verdict {
  egypt: "yes" | "no" | "unknown";
  reason: string;
  posting: CompanyPosting | null;
}

/**
 * One country next to a remote job is usually just the company's office (The Codest: Poland),
 * so it is not read as a limit. Two or more countries are a real list (TransPerfect: 15, no Egypt).
 */
const REGION = /\b(europe|eu|eea|emea|apac|asia|americas|north america|latam|usa?|united states|uk|united kingdom|canada)\b/i;

export function judgePosting(p: CompanyPosting, t: Targeting): Verdict {
  // A single country is ignored as "the office"; a single region ("Europe") is a real limit.
  const officeOnly = p.remote && p.places.length === 1 && !REGION.test(p.places[0]!);
  const places = (officeOnly ? [] : p.places).map((x) => x.replace(/\(\s*\)/g, "").trim()).filter(Boolean);
  const viaEor = detectEor(p.text, t);
  const loc = classifyLocation({ places, locationText: places.join(", "), description: p.text, viaEor }, t);
  const where = `${p.provider}: ${p.places.join(", ") || (p.remote ? "remote, no country given" : "no location given")}`;
  if (loc.eligible === "no") return { egypt: "no", reason: `company site (${where})${loc.reasons[0] ? ` — ${loc.reasons[0]}` : ""}`, posting: p };
  if (loc.eligible === "yes") return { egypt: "yes", reason: `company site (${where})`, posting: p };
  return { egypt: "unknown", reason: `company site doesn't say (${where})`, posting: p };
}

export async function verifyJob(get: HttpGet, company: string, title: string, t: Targeting): Promise<Verdict> {
  const p = await findCompanyPosting(get, company, title);
  return p ? judgePosting(p, t) : { egypt: "unknown", reason: "not found on the company's own careers site", posting: null };
}
