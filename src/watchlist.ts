// The company watchlist: companies that have posted an Egypt-eligible job are likely to
// hire from Egypt again, so their own ATS board is polled directly every 3 hours.
// It grows by itself; Islam can switch a company off by setting active = "no".
import type { Config } from "./config.js";
import { normalizeCompany } from "./normalize/index.js";
import { eligibilityOf } from "./normalize/location.js";
import type { AtsBoard, Job, WatchRow } from "./schema.js";
import { probeCompany } from "./sources/atsBoards.js";
import type { HttpGet } from "./util/http.js";

export interface WatchUpdate {
  rows: WatchRow[];
  added: WatchRow[];
}

const key = (company: string) => normalizeCompany(company);

/** Seeds from config/sources.yaml are always on the list. */
export function withSeeds(rows: WatchRow[], cfg: Config, nowIso: string): WatchRow[] {
  const have = new Set(rows.map((r) => `${r.ats}:${r.slug}`));
  const seeds = cfg.sources.ats.seeds
    .filter((s) => !have.has(`${s.ats}:${s.slug}`))
    .map((s): WatchRow => ({ company: s.company, ats: s.ats, slug: s.slug, added_at: nowIso, reason: "seed (config)", active: "yes", last_checked: "" }));
  return [...rows, ...seeds];
}

/** Boards to poll: active rows with a real ATS. */
export function activeBoards(rows: WatchRow[]): { board: AtsBoard; company: string }[] {
  const pollable = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workable"]);
  return rows
    .filter((r) => r.active !== "no" && pollable.has(r.ats) && r.slug)
    .map((r) => ({ board: { ats: r.ats as AtsBoard["ats"], slug: r.slug }, company: r.company }));
}

/**
 * Adds companies with Egypt-eligible jobs. If the job already points at the company's
 * board, it is added straight away; otherwise up to `maxNewCompanyLookupsPerRun` companies
 * are looked up on Greenhouse/Lever/Ashby. Companies with no board are remembered as
 * ats "none" so they are not looked up again.
 */
export async function updateWatchlist(
  rows: WatchRow[],
  jobs: Job[],
  cfg: Config,
  get: HttpGet,
  nowIso: string,
  probe: typeof probeCompany = probeCompany,
): Promise<WatchUpdate> {
  const out = [...rows];
  const added: WatchRow[] = [];
  const knownCompanies = new Set(out.map((r) => key(r.company)));
  const knownBoards = new Set(out.map((r) => `${r.ats}:${r.slug}`));

  const eligible = jobs.filter((j) => eligibilityOf(j.remoteScope, j.viaEor) === "yes");
  const toProbe: Job[] = [];

  for (const j of eligible) {
    if (j.atsBoard) {
      const b = `${j.atsBoard.ats}:${j.atsBoard.slug}`;
      if (knownBoards.has(b)) continue;
      const row: WatchRow = { company: j.company, ats: j.atsBoard.ats, slug: j.atsBoard.slug, added_at: nowIso, reason: `${j.remoteScope} job: ${j.title}`.slice(0, 200), active: "yes", last_checked: "" };
      out.push(row);
      added.push(row);
      knownBoards.add(b);
      knownCompanies.add(key(j.company));
    } else if (!knownCompanies.has(key(j.company)) && !toProbe.some((p) => key(p.company) === key(j.company))) {
      toProbe.push(j);
    }
  }

  for (const j of toProbe.slice(0, cfg.sources.ats.maxNewCompanyLookupsPerRun)) {
    const board = await probe(cfg, get, j.company);
    const row: WatchRow = board && !knownBoards.has(`${board.ats}:${board.slug}`)
      ? { company: j.company, ats: board.ats, slug: board.slug, added_at: nowIso, reason: `${j.remoteScope} job: ${j.title} (board found by name)`.slice(0, 200), active: "yes", last_checked: "" }
      : { company: j.company, ats: "none", slug: "", added_at: nowIso, reason: "no Greenhouse/Lever/Ashby board found", active: "no", last_checked: nowIso };
    out.push(row);
    if (row.ats !== "none") {
      added.push(row);
      knownBoards.add(`${row.ats}:${row.slug}`);
    }
    knownCompanies.add(key(j.company));
  }

  return { rows: out, added };
}
