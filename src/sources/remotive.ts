// Remotive public API. They ask for at most 4 requests a day and a link back to Remotive.
// Their terms forbid republishing their jobs to collect sign-ups, so this data is for
// Islam's own applications only.
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import type { HttpGet } from "../util/http.js";

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  tags?: string[];
  job_type?: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

export function parseRemotive(body: string): RawJob[] {
  const data = JSON.parse(body) as { jobs?: RemotiveJob[] };
  return (data.jobs ?? []).map((j) => ({
    source: "remotive",
    sourceId: String(j.id),
    url: j.url,
    applyUrl: j.url,
    title: j.title,
    company: j.company_name,
    locationText: j.candidate_required_location ?? "",
    places: (j.candidate_required_location ?? "").split(",").map((p) => p.trim()).filter(Boolean),
    salaryText: j.salary || null,
    employmentTypeRaw: j.job_type ?? null,
    // Remotive dates have no timezone; they are UTC.
    postedAt: j.publication_date ? new Date(`${j.publication_date}Z`).toISOString() : null,
    descriptionHtml: j.description ?? "",
    tags: j.tags ?? [],
  }));
}

export async function fetchRemotive(cfg: Config, get: HttpGet): Promise<RawJob[]> {
  const s = cfg.sources.sources.remotive;
  const out: RawJob[] = [];
  for (const params of s.requests) {
    const qs = new URLSearchParams(params).toString();
    out.push(...parseRemotive(await get(`${s.url}?${qs}`)));
  }
  return out;
}
