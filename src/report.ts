// Learn from results, not volume: reply rate per source, CV variant and score band.
// Useful once applications go out (Phase 3+); safe to run any time.
import type { JobRow } from "./schema.js";

const APPLIED = new Set(["applied", "followed_up", "replied_invite", "replied_reject", "replied_question", "closed"]);
const REPLIED = new Set(["replied_invite", "replied_reject", "replied_question"]);

export interface Group {
  key: string;
  applied: number;
  replies: number;
  invites: number;
  replyRate: number;
}

function group(rows: JobRow[], keyOf: (r: JobRow) => string): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    if (!APPLIED.has(r.status)) continue;
    const k = keyOf(r) || "(none)";
    const g = m.get(k) ?? { key: k, applied: 0, replies: 0, invites: 0, replyRate: 0 };
    g.applied++;
    if (REPLIED.has(r.status)) g.replies++;
    if (r.status === "replied_invite") g.invites++;
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, replyRate: g.applied ? Math.round((g.replies / g.applied) * 1000) / 10 : 0 }))
    .sort((a, b) => b.applied - a.applied);
}

export function buildReport(rows: JobRow[]): { bySource: Group[]; byCv: Group[]; byBand: Group[]; text: string } {
  const bySource = group(rows, (r) => r.sources.split(", ")[0] ?? "");
  const byCv = group(rows, (r) => r.cv_variant);
  const byBand = group(rows, (r) => r.score_band);
  const table = (title: string, gs: Group[]) => [
    `## ${title}`, "", "| | applied | replies | invites | reply rate |", "| --- | ---: | ---: | ---: | ---: |",
    ...(gs.length ? gs.map((g) => `| ${g.key} | ${g.applied} | ${g.replies} | ${g.invites} | ${g.replyRate}% |`) : ["| (no applications yet) | 0 | 0 | 0 | – |"]),
    "",
  ].join("\n");
  const total = rows.filter((r) => APPLIED.has(r.status)).length;
  const text = [
    `# Results report`, "",
    `Applications: ${total}. If the overall reply rate stays under ~3% after two weeks, change targeting or the CV, not volume.`, "",
    table("By source", bySource), table("By CV variant", byCv), table("By score band", byBand),
  ].join("\n");
  return { bySource, byCv, byBand, text };
}
