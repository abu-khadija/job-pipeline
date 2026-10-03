// Runs every enabled source. One source failing never stops the others.
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import type { HttpGet } from "../util/http.js";
import { fetchBuiltin } from "./builtin.js";
import { fetchHimalayas } from "./himalayas.js";
import { fetchRemoteOk } from "./remoteok.js";
import { fetchRemotive } from "./remotive.js";
import { fetchWwr } from "./wwr.js";

type Fetcher = (cfg: Config, get: HttpGet) => Promise<RawJob[]>;

const FETCHERS: { name: "himalayas" | "remoteok" | "remotive" | "weworkremotely" | "builtin"; run: Fetcher }[] = [
  { name: "himalayas", run: fetchHimalayas },
  { name: "remoteok", run: fetchRemoteOk },
  { name: "remotive", run: fetchRemotive },
  { name: "weworkremotely", run: fetchWwr },
  { name: "builtin", run: fetchBuiltin },
];

export interface FetchResult {
  jobs: RawJob[];
  perSource: Record<string, number>;
  errors: string[];
}

export async function fetchAll(cfg: Config, get: HttpGet): Promise<FetchResult> {
  const result: FetchResult = { jobs: [], perSource: {}, errors: [] };
  const enabled = FETCHERS.filter((f) => cfg.sources.sources[f.name].enabled);
  const settled = await Promise.allSettled(enabled.map((f) => f.run(cfg, get)));
  settled.forEach((s, i) => {
    const name = enabled[i]!.name;
    if (s.status === "fulfilled") {
      result.jobs.push(...s.value);
      result.perSource[name] = s.value.length;
    } else {
      result.perSource[name] = 0;
      result.errors.push(`${name}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
    }
  });
  return result;
}
