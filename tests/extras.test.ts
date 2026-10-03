// Link check, Telegram digest, results report, and Sheet header mapping.
import { describe, expect, it, vi } from "vitest";
import { buildDigest, sendTelegram } from "../src/digest.js";
import { checkLive } from "../src/liveness.js";
import { rowFromJob } from "../src/pipeline.js";
import { buildReport } from "../src/report.js";
import type { JobRow, RunLog } from "../src/schema.js";
import { rowsFromValues } from "../src/store/types.js";
import { NOW, job } from "./helpers.js";

describe("checkLive", () => {
  const f = (...statuses: number[]) => vi.fn(async () => ({ status: statuses.shift() ?? 200 }));
  it("live on 200", async () => expect(await checkLive("https://x", "ua", f(200))).toBe("live"));
  it("gone only on 404/410", async () => {
    expect(await checkLive("https://x", "ua", f(404))).toBe("gone");
    expect(await checkLive("https://x", "ua", f(410))).toBe("gone");
  });
  it("retries with GET when HEAD is refused", async () => {
    const fetcher = f(405, 404);
    expect(await checkLive("https://x", "ua", fetcher)).toBe("gone");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("unknown (never 'gone') on errors and odd statuses", async () => {
    expect(await checkLive("https://x", "ua", f(500))).toBe("unknown");
    expect(await checkLive("https://x", "ua", vi.fn(async () => { throw new Error("timeout"); }))).toBe("unknown");
  });
});

const run: RunLog = {
  run_id: "boards-1", started_at: "2026-10-02T06:00:00.000Z", finished_at: "", mode: "dry", fetched: 600,
  after_filters: 25, new: 12, scored: 12, shortlisted: 3, errors: "", cost_usd_est: 0.02,
  input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, watchlist_added: 2,
};

function row(over: Partial<JobRow>): JobRow {
  return { ...rowFromJob(job(), ["himalayas"], NOW), ...over };
}

describe("digest", () => {
  it("lists the best new shortlisted/maybe jobs, best first, max 5", () => {
    const rows = [
      row({ title: "A", status: "shortlisted", score: 75 }),
      row({ title: "B", status: "shortlisted", score: 90, why: "Great fit" }),
      row({ title: "C", status: "low_score", score: 40 }),
      ...Array.from({ length: 6 }, (_, i) => row({ title: `M${i}`, status: "maybe", score: 61 })),
    ];
    const d = buildDigest(rows, run);
    expect(d).toMatch(/^Job pipeline · 2026-10-02 06:00 UTC · dry/);
    expect(d).toContain("watchlist +2");
    expect(d.indexOf("90 · B")).toBeLessThan(d.indexOf("75 · A"));
    expect(d).not.toContain("· C —");
    expect(d.match(/^\d+ · /gm)).toHaveLength(5);
  });
  it("says so when there is nothing new", () => expect(buildDigest([], run)).toContain("No new shortlisted"));
  it("posts to the Telegram Bot API", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendTelegram("hi", "TOKEN", "42", fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "42", text: "hi" });
  });
});

describe("results report", () => {
  it("reply rate per source, CV variant and score band; only applied jobs count", () => {
    const rows = [
      row({ status: "applied", sources: "himalayas", cv_variant: "ai_automation", score_band: "80+" }),
      row({ status: "replied_invite", sources: "himalayas", cv_variant: "ai_automation", score_band: "80+" }),
      row({ status: "replied_reject", sources: "lever", cv_variant: "qa_analyst", score_band: "70-79" }),
      row({ status: "shortlisted", sources: "remoteok" }),
    ];
    const r = buildReport(rows);
    expect(r.bySource).toEqual([
      { key: "himalayas", applied: 2, replies: 1, invites: 1, replyRate: 50 },
      { key: "lever", applied: 1, replies: 1, invites: 0, replyRate: 100 },
    ]);
    expect(r.byCv.map((g) => g.key)).toEqual(["ai_automation", "qa_analyst"]);
    expect(r.text).toContain("| 80+ | 2 | 1 | 1 | 50% |");
  });
  it("works with no applications yet", () => expect(buildReport([]).text).toContain("no applications yet"));
});

describe("rowsFromValues (Sheet → objects by header name)", () => {
  it("maps by header, fills missing columns, turns numbers back into numbers, skips empty rows", () => {
    const rows = rowsFromValues<Record<string, unknown>>(["status", "job_id", "score", "extra"], [["shortlisted", "abc", "77", "x"], ["", "", "", ""]], ["job_id", "status", "score", "notes"]);
    expect(rows).toEqual([{ job_id: "abc", status: "shortlisted", score: 77, notes: "" }]);
  });
});
