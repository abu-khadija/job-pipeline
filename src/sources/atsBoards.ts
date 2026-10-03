// Companies' own job boards on Greenhouse, Lever and Ashby (public, read-only APIs).
// Jobs appear here the day they are posted, often a day or two before the job boards.
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import { normalizeCompany } from "../normalize/index.js";
import { decodeEntities } from "../normalize/text.js";
import type { AtsBoard } from "../schema.js";
import type { HttpGet } from "../util/http.js";

export type AtsName = AtsBoard["ats"];

export function boardUrl(cfg: Config, board: AtsBoard): string {
  return cfg.sources.ats[board.ats].replace("{slug}", encodeURIComponent(board.slug));
}

// ---- Greenhouse -------------------------------------------------------------------------

interface GreenhouseJob {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
}

export function parseGreenhouse(body: string, slug: string, company?: string): RawJob[] {
  const data = JSON.parse(body) as { jobs?: GreenhouseJob[] };
  return (data.jobs ?? []).map((j) => ({
    source: "greenhouse",
    sourceId: String(j.id),
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    title: j.title,
    company: company ?? j.company_name?.trim() ?? slug,
    locationText: j.location?.name ?? "",
    postedAt: j.first_published ?? j.updated_at ?? null,
    // Greenhouse escapes its HTML ("&lt;p&gt;"), so decode before the normal HTML cleanup.
    descriptionHtml: decodeEntities(j.content ?? ""),
    atsBoard: { ats: "greenhouse" as const, slug },
  }));
}

// ---- Lever ------------------------------------------------------------------------------

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  country?: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string };
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  lists?: { text: string; content: string }[];
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

const LEVER_INTERVAL: Record<string, "hour" | "day" | "month" | "year"> = {
  "per-hour-wage": "hour", "per-day-wage": "day", "per-month-salary": "month", "per-year-salary": "year",
};

export function parseLever(body: string, slug: string, company?: string): RawJob[] {
  const data = JSON.parse(body) as LeverJob[];
  if (!Array.isArray(data)) return [];
  return data.map((j) => {
    const places = j.categories?.allLocations?.length ? j.categories.allLocations : [j.categories?.location ?? ""];
    // Lever says "remote", "hybrid" or "on-site" separately; keep it in the location text
    // so the not-remote filter can see it.
    const workplace = j.workplaceType && j.workplaceType !== "remote" ? `${j.workplaceType} - ` : "";
    const lists = (j.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
    const sr = j.salaryRange;
    return {
      source: "lever",
      sourceId: j.id,
      url: j.hostedUrl,
      applyUrl: j.applyUrl ?? j.hostedUrl,
      title: j.text,
      company: company ?? slug,
      locationText: `${workplace}${places.filter(Boolean).join(", ")}`,
      salaryNumbers: sr && (sr.min || sr.max)
        ? { min: sr.min ?? null, max: sr.max ?? null, period: LEVER_INTERVAL[sr.interval ?? ""] ?? "year", currency: sr.currency ?? "USD" }
        : null,
      employmentTypeRaw: j.categories?.commitment ?? null,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      descriptionHtml: `${j.description ?? ""}${lists}${j.additional ?? ""}`,
      atsBoard: { ats: "lever" as const, slug },
    };
  });
}

// ---- Ashby ------------------------------------------------------------------------------

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  workplaceType?: string;
  isListed?: boolean;
  publishedAt?: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionHtml?: string;
  compensation?: { scrapeableCompensationSalarySummary?: string | null; compensationTierSummary?: string | null };
}

export function parseAshby(body: string, slug: string, company?: string): RawJob[] {
  const data = JSON.parse(body) as { jobs?: AshbyJob[] };
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const places = [j.location ?? "", ...(j.secondaryLocations ?? []).map((s) => s.location ?? "")].filter(Boolean);
      const workplace = j.workplaceType && j.workplaceType.toLowerCase() !== "remote" ? `${j.workplaceType} - ` : "";
      return {
        source: "ashby",
        sourceId: j.id,
        url: j.jobUrl,
        applyUrl: j.applyUrl ?? j.jobUrl,
        title: j.title,
        company: company ?? slug,
        locationText: `${workplace}${places.join(", ")}`,
        salaryText: j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary ?? null,
        employmentTypeRaw: j.employmentType ?? null,
        postedAt: j.publishedAt ?? null,
        descriptionHtml: j.descriptionHtml ?? "",
        atsBoard: { ats: "ashby" as const, slug },
      };
    });
}

const PARSERS: Record<AtsName, (body: string, slug: string, company?: string) => RawJob[]> = {
  greenhouse: parseGreenhouse,
  lever: parseLever,
  ashby: parseAshby,
};

/** Reads one company's board. Throws on HTTP errors (the caller logs them). */
export async function fetchBoard(cfg: Config, get: HttpGet, board: AtsBoard, company?: string): Promise<RawJob[]> {
  return PARSERS[board.ats](await get(boardUrl(cfg, board)), board.slug, company);
}

// ---- Finding a company's board ----------------------------------------------------------

/** Slugs to try for a company name: "Acme Labs Inc." → ["acmelabs", "acme-labs"]. */
export function slugCandidates(company: string): string[] {
  const words = normalizeCompany(company).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join("");
  const hyphen = words.join("-");
  return [...new Set([joined, hyphen])].filter((s) => s.length >= 3);
}

/**
 * Looks for a company's board by trying likely slugs on each ATS. Greenhouse returns the
 * company name, so it must match; Lever and Ashby don't, so only an exact name-slug counts.
 * A 404 means "no board here". Returns null if nothing matches.
 */
export async function probeCompany(cfg: Config, get: HttpGet, company: string): Promise<AtsBoard | null> {
  const want = normalizeCompany(company);
  for (const slug of slugCandidates(company)) {
    for (const ats of ["greenhouse", "lever", "ashby"] as const) {
      let body: string;
      try {
        body = await get(boardUrl(cfg, { ats, slug }));
      } catch {
        continue; // 404 or network error: not here
      }
      try {
        if (ats === "greenhouse") {
          const jobs = (JSON.parse(body) as { jobs?: GreenhouseJob[] }).jobs ?? [];
          const name = normalizeCompany(jobs[0]?.company_name ?? "");
          if (jobs.length === 0 || !(name.includes(want) || want.includes(name))) continue;
        } else if (slug !== want.replace(/ /g, "") && slug !== want.replace(/ /g, "-")) {
          continue;
        }
        JSON.parse(body); // must be valid JSON
        return { ats, slug };
      } catch {
        continue;
      }
    }
  }
  return null;
}
