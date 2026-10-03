// Himalayas search API, filtered to jobs open to Egypt (country=EG). 20 jobs per page.
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import type { SalaryPeriod } from "../schema.js";
import type { HttpGet } from "../util/http.js";

interface HimalayasJob {
  title: string;
  companyName: string;
  companySlug?: string;
  employmentType?: string;
  minSalary: number | null;
  maxSalary: number | null;
  salaryPeriod?: string | null;
  currency: string | null;
  locationRestrictions: string[];
  description: string;
  pubDate: number;
  applicationLink: string;
  guid: string;
}

interface HimalayasResponse {
  totalCount: number;
  jobs: HimalayasJob[];
}

const PERIODS: Record<string, SalaryPeriod> = { annual: "year", yearly: "year", monthly: "month", hourly: "hour", daily: "day" };

export function parseHimalayas(body: string): RawJob[] {
  const data = JSON.parse(body) as HimalayasResponse;
  return (data.jobs ?? []).map((j) => ({
    source: "himalayas",
    sourceId: j.guid,
    url: j.guid,
    applyUrl: j.applicationLink,
    title: j.title,
    company: j.companyName,
    companyUrl: j.companySlug ? `https://himalayas.app/companies/${j.companySlug}` : null,
    locationText: j.locationRestrictions.join(", "),
    places: j.locationRestrictions,
    salaryNumbers:
      j.minSalary || j.maxSalary
        ? { min: j.minSalary, max: j.maxSalary, period: PERIODS[j.salaryPeriod ?? "annual"] ?? "year", currency: j.currency ?? "USD" }
        : null,
    employmentTypeRaw: j.employmentType ?? null,
    postedAt: new Date(j.pubDate * 1000).toISOString(),
    descriptionHtml: j.description ?? "",
  }));
}

export async function fetchHimalayas(cfg: Config, get: HttpGet): Promise<RawJob[]> {
  const s = cfg.sources.sources.himalayas;
  const out: RawJob[] = [];
  for (const q of s.queries) {
    for (let page = 0; page < s.maxPagesPerQuery; page++) {
      const url = `${s.url}?q=${encodeURIComponent(q)}&country=${s.country}&sort=recent&offset=${page * 20}`;
      const body = await get(url);
      const jobs = parseHimalayas(body);
      out.push(...jobs);
      const total = (JSON.parse(body) as HimalayasResponse).totalCount ?? 0;
      if (jobs.length < 20 || (page + 1) * 20 >= total) break;
    }
  }
  return out;
}
