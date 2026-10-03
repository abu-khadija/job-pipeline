// Built In: remote QA jobs filtered to Egypt (country=EGY). Each job page carries schema.org
// JobPosting data with applicantLocationRequirements, so "open to Egypt" is stated by the
// company, not guessed (Storyteller's "QA Engineer - AI Native" was found here).
// robots.txt allows these listing and job pages; search queries (?search=) and ?page= are
// disallowed, so only the category pages in config are read, slowly, a few times a day.
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import type { HttpGet } from "../util/http.js";

interface LdJob {
  "@type": string;
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string;
  jobLocationType?: string;
  applicantLocationRequirements?: { name?: string } | { name?: string }[];
  hiringOrganization?: { name?: string; sameAs?: string };
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } };
}

const COUNTRY: Record<string, string> = { EGY: "Egypt", USA: "United States", GBR: "United Kingdom", DEU: "Germany", CAN: "Canada", IND: "India" };
const PERIOD: Record<string, "hour" | "day" | "month" | "year"> = { HOUR: "hour", DAY: "day", MONTH: "month", YEAR: "year" };

const decode = (s: string) => s.replace(/&#x2B;/g, "+").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

/** Job page links on a listing page: /job/<slug>/<id>. */
export function parseBuiltinList(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(\/job\/[a-z0-9-]+\/\d+)"/g)].map((m) => `https://builtin.com${m[1]}`))];
}

/** The JobPosting object on a job page, as a RawJob. Null if the page has none. */
export function parseBuiltinJob(html: string, url: string): RawJob | null {
  for (const m of html.matchAll(/<script type="application\/ld(?:\+|&#x2B;)json">([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(decode(m[1]!));
    } catch {
      continue;
    }
    const graph = ((data as { "@graph"?: unknown[] })["@graph"] ?? [data]) as LdJob[];
    const j = graph.find((x) => x && x["@type"] === "JobPosting");
    if (!j?.title || !j.hiringOrganization?.name) continue;
    const req = j.applicantLocationRequirements;
    const places = (Array.isArray(req) ? req : req ? [req] : []).map((r) => COUNTRY[r.name ?? ""] ?? r.name ?? "").filter(Boolean);
    const v = j.baseSalary?.value;
    return {
      source: "builtin",
      sourceId: url.split("/").pop() ?? url,
      url,
      // Built In's own apply step is off-limits (robots: /apply/); the company-site check finds the real form.
      applyUrl: url,
      title: j.title,
      company: j.hiringOrganization.name,
      companyUrl: j.hiringOrganization.sameAs ?? null,
      locationText: j.jobLocationType === "TELECOMMUTE" ? `Remote, ${places.join(", ")}` : places.join(", "),
      places,
      salaryNumbers: v && (v.minValue || v.maxValue)
        ? { min: v.minValue ?? null, max: v.maxValue ?? null, period: PERIOD[v.unitText ?? "YEAR"] ?? "year", currency: j.baseSalary?.currency ?? "USD" }
        : null,
      employmentTypeRaw: j.employmentType ?? null,
      postedAt: j.datePosted ? new Date(j.datePosted).toISOString() : null,
      descriptionHtml: j.description ?? "",
    };
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchBuiltin(cfg: Config, get: HttpGet): Promise<RawJob[]> {
  const s = cfg.sources.sources.builtin;
  const links: string[] = [];
  for (const page of s.listPages) links.push(...parseBuiltinList(await get(page)));
  const out: RawJob[] = [];
  for (const url of [...new Set(links)].slice(0, s.maxJobsPerRun)) {
    try {
      const job = parseBuiltinJob(await get(url), url);
      if (job) out.push(job);
    } catch {
      // One job page failing doesn't stop the rest.
    }
    await sleep(s.delayMs);
  }
  return out;
}
