// Entry point. Usage:
//   npm run fetch                  → Google Sheet (needs SHEET_ID + Google credentials)
//   npm run fetch -- --local       → out/ folder, no Google needed
//   npm run fetch -- --no-ai       → skip Haiku scoring (jobs saved as "unscored")
import "dotenv/config";
import { loadConfig } from "./config.js";
import { runFetch } from "./pipeline.js";
import { HaikuScorer } from "./score/scorer.js";
import { LocalStore } from "./store/local.js";
import { SheetStore } from "./store/sheet.js";
import type { Store } from "./store/types.js";
import { makeHttpGet } from "./util/http.js";

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  if (command !== "fetch") {
    console.error("Usage: npm run fetch [-- --local] [-- --no-ai]");
    process.exit(2);
  }
  const local = flags.includes("--local");
  const noAi = flags.includes("--no-ai");
  const cfg = loadConfig();

  let store: Store;
  if (local) {
    store = new LocalStore();
  } else {
    const sheetId = process.env.SHEET_ID;
    if (!sheetId) throw new Error("SHEET_ID is not set. Use --local, or follow docs/SETUP-ISLAM.md A5-A6.");
    store = new SheetStore(sheetId);
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!noAi && !hasKey) console.log("ANTHROPIC_API_KEY is not set: jobs will be saved as 'unscored' (docs/SETUP-ISLAM.md A4/A6).");
  const scorer = !noAi && hasKey ? new HaikuScorer(cfg) : null;

  console.log(`Writing to: ${store.name}. Mode: no sending in Phase 1.`);
  const summary = await runFetch({ cfg, store, get: makeHttpGet(cfg.sources), scorer, log: (m) => console.log(m) });
  if (summary.stopped) return;

  const top = summary.rows
    .filter((r) => typeof r.score === "number")
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 10);
  if (top.length) {
    console.log("\nTop scored jobs:");
    for (const r of top) console.log(`  ${r.score}  ${r.title} — ${r.company}  [${r.status}]  ${r.url}`);
  }
  if (summary.run?.errors) console.log(`\nErrors (also in the Runs log): ${summary.run.errors}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
