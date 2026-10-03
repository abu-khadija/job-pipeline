// Entry point. Usage:
//   npm run fetch                      → everything, Google Sheet (needs SHEET_ID + Google key)
//   npm run fetch -- --only=boards     → job boards only (2x/day; Batch API scoring)
//   npm run fetch -- --only=ats        → watchlist ATS boards only (every 3h; real-time scoring)
//   npm run fetch -- --local           → write to out/ instead of the Sheet
//   npm run fetch -- --no-ai           → skip Haiku scoring (jobs saved as "unscored")
//   npm run report [-- --local]        → reply rates by source / CV variant / score band
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { sendTelegram } from "./digest.js";
import { runFetch, type RunKind } from "./pipeline.js";
import { buildReport } from "./report.js";
import { BatchHaikuScorer, HaikuScorer, type Scorer } from "./score/scorer.js";
import { LocalStore } from "./store/local.js";
import { SheetStore } from "./store/sheet.js";
import type { Store } from "./store/types.js";
import { makeHttpGet } from "./util/http.js";

function makeStore(local: boolean): Store {
  if (local) return new LocalStore();
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID is not set. Use --local, or follow docs/SETUP-ISLAM.md A5-A6.");
  return new SheetStore(sheetId);
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const local = flags.includes("--local");
  const cfg = loadConfig();

  if (command === "report") {
    const store = makeStore(local);
    const report = buildReport(await store.readTable("Jobs"));
    mkdirSync("out", { recursive: true });
    writeFileSync("out/report.md", report.text);
    console.log(report.text);
    return;
  }
  if (command !== "fetch") {
    console.error("Usage: npm run fetch [-- --only=boards|ats] [--local] [--no-ai]   |   npm run report [-- --local]");
    process.exit(2);
  }

  const only = flags.find((f) => f.startsWith("--only="))?.split("=")[1];
  const kind: RunKind = only === "boards" || only === "ats" ? only : "all";
  const noAi = flags.includes("--no-ai");
  const store = makeStore(local);

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!noAi && !hasKey) console.log("ANTHROPIC_API_KEY is not set: jobs will be saved as 'unscored' (docs/SETUP-ISLAM.md A4/A6).");
  let scorer: Scorer | null = null;
  if (!noAi && hasKey) {
    // Board runs aren't urgent: Batch API at half price. ATS runs need speed: real time.
    scorer = kind === "boards" && cfg.limits.scoring.useBatchForBoards ? new BatchHaikuScorer(cfg) : new HaikuScorer(cfg);
  }

  console.log(`Run: ${kind}. Writing to: ${store.name}. No applications are sent in this phase.`);
  const summary = await runFetch({ cfg, store, get: makeHttpGet(cfg.sources), scorer, kind, log: (m) => console.log(m) });
  if (summary.stopped) return;

  console.log(`\n${summary.digest}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    await sendTelegram(summary.digest, token, chat).catch((e) => console.log(`Telegram digest failed: ${e instanceof Error ? e.message : e}`));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
