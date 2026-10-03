// fetch with a timeout, a few retries and our User-Agent. Sources use only this.
import type { Sources } from "../config.js";

export type HttpGet = (url: string) => Promise<string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeHttpGet(cfg: Sources): HttpGet {
  return async (url: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": cfg.userAgent, Accept: "application/json, application/rss+xml, */*" },
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (res.ok) return await res.text();
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        // 4xx other than 429 will not get better by retrying.
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastError = err;
      }
      await sleep(1000 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}
