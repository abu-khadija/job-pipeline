// We Work Remotely RSS feeds. Titles look like "Company: Job title".
import { XMLParser } from "fast-xml-parser";
import type { Config } from "../config.js";
import type { RawJob } from "../normalize/index.js";
import type { HttpGet } from "../util/http.js";

interface WwrItem {
  title: string;
  region?: string;
  country?: string;
  category?: string;
  type?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text": string };
  link: string;
}

const parser = new XMLParser({ ignoreAttributes: true });

export function parseWwr(body: string): RawJob[] {
  const channel = parser.parse(body)?.rss?.channel;
  const items: WwrItem[] = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  return items.map((i) => {
    const full = String(i.title);
    const sep = full.indexOf(": ");
    const company = sep > 0 ? full.slice(0, sep) : "Unknown";
    const title = sep > 0 ? full.slice(sep + 2) : full;
    const guid = typeof i.guid === "object" ? i.guid["#text"] : i.guid;
    return {
      source: "weworkremotely",
      sourceId: guid ?? i.link,
      url: i.link,
      applyUrl: i.link,
      title,
      company,
      // WWR gives a region ("Anywhere in the World", "Europe") plus an HQ country we ignore.
      locationText: i.region ?? "",
      employmentTypeRaw: i.type ?? null,
      postedAt: i.pubDate ? new Date(i.pubDate).toISOString() : null,
      descriptionHtml: i.description ?? "",
      tags: i.category ? [String(i.category)] : [],
    };
  });
}

export async function fetchWwr(cfg: Config, get: HttpGet): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const feed of cfg.sources.sources.weworkremotely.feeds) {
    out.push(...parseWwr(await get(feed)));
  }
  return out;
}
