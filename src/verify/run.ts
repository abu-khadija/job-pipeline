// `npm run verify`: checks jobs already in the Sheet (shortlisted, drafted, held) on the company's
// own site. Not open to Egypt → the job moves to Filtered and its draft is skipped. Found → the
// company's own link replaces the job board's (no more Himalayas paywall).
import { detectAts } from "../normalize/ats.js";
import type { JobRow } from "../schema.js";
import type { Store } from "../store/types.js";
import type { Verdict } from "./index.js";

const CHECK = new Set(["shortlisted", "drafted", "held"]);

export async function runVerify(opts: {
  store: Store;
  verify: (company: string, title: string) => Promise<Verdict>;
  log?: (msg: string) => void;
}): Promise<{ checked: number; dropped: number; linked: number }> {
  const { store, verify } = opts;
  const log = opts.log ?? (() => {});
  if ((await store.readControl()).killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting.");
    return { checked: 0, dropped: 0, linked: 0 };
  }
  const jobs = await store.readTable("Jobs");
  const filtered = await store.readTable("Filtered");
  const drafts = await store.readTable("Drafts");
  const todo = jobs.filter((j) => CHECK.has(j.status));
  let dropped = 0;
  let linked = 0;

  for (const j of todo) {
    const v = await verify(j.company, j.title).catch((): Verdict => ({ egypt: "unknown", reason: "check failed", posting: null }));
    const d = drafts.find((x) => x.job_id === j.job_id && x.status === "draft");
    log(`${j.company.slice(0, 30)} — ${j.title.slice(0, 40)}: ${v.egypt} (${v.reason.slice(0, 120)})`);
    if (v.egypt === "no") {
      j.status = "filtered_out";
      j.filter_reasons = `not open to Egypt: ${v.reason}`;
      if (d) {
        d.status = "skipped";
        d.hold_reason = `not open to Egypt: ${v.reason}`;
      }
      dropped++;
      continue;
    }
    if (v.posting) {
      j.apply_url = v.posting.url;
      j.ats = detectAts(v.posting.url, null);
      if (d && d.route !== "email") {
        d.apply_to = v.posting.url;
        d.route = "form";
      }
      linked++;
    }
    const note = v.egypt === "yes" ? `Egypt OK: ${v.reason}` : `location unclear: ${v.reason}`;
    if (!j.breakdown.includes(note)) j.breakdown = [j.breakdown, note].filter(Boolean).join(" | ");
  }

  const keep: JobRow[] = jobs.filter((j) => j.status !== "filtered_out");
  await store.writeTable("Jobs", keep);
  await store.writeTable("Filtered", [...filtered, ...jobs.filter((j) => j.status === "filtered_out")]);
  await store.writeTable("Drafts", drafts);
  log(`Done. Checked ${todo.length}: ${dropped} not open to Egypt (moved to Filtered), ${linked} now use the company's own link.`);
  return { checked: todo.length, dropped, linked };
}
