// Where the pipeline keeps its state. The Google Sheet in production, local files with --local.
import {
  JOB_COLUMNS, REFERRAL_COLUMNS, RUN_COLUMNS, WATCH_COLUMNS,
  type JobRow, type ReferralRow, type RunLog, type WatchRow,
} from "../schema.js";

export interface Control {
  /** "STOP" halts every run before it does anything. */
  killSwitch: "RUN" | "STOP";
  /** Sending also needs DRY_RUN=false in the environment (Phase 3+). */
  mode: "dry" | "live";
}

/** Every tab and its columns. Jobs keeps the useful rows; Filtered keeps the dropped ones. */
export const TABS = {
  Jobs: JOB_COLUMNS,
  Filtered: JOB_COLUMNS,
  Referrals: REFERRAL_COLUMNS,
  Watchlist: WATCH_COLUMNS,
  Runs: RUN_COLUMNS,
  Exceptions: ["created_at", "job_id", "company", "reason", "what_islam_must_do", "resolved"],
} as const;

export type TabName = keyof typeof TABS;

export interface TabRows {
  Jobs: JobRow;
  Filtered: JobRow;
  Referrals: ReferralRow;
  Watchlist: WatchRow;
  Runs: RunLog;
  Exceptions: Record<string, string>;
}

export interface Store {
  readonly name: string;
  readControl(): Promise<Control>;
  readTable<T extends TabName>(tab: T): Promise<TabRows[T][]>;
  /** Replaces the whole tab with `rows`. */
  writeTable<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void>;
  appendRows<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void>;
}

export function parseControl(killSwitch: unknown, mode: unknown): Control {
  // Anything other than an explicit RUN is treated as STOP: safer when the cell is mistyped.
  const ks = String(killSwitch ?? "RUN").trim().toUpperCase() === "RUN" ? "RUN" : "STOP";
  const m = String(mode ?? "dry").trim().toLowerCase() === "live" ? "live" : "dry";
  return { killSwitch: ks, mode: m };
}

/** Columns that hold numbers, so values read back from a Sheet or CSV become numbers again. */
const NUMERIC = new Set(["score", "fetched", "after_filters", "new", "scored", "shortlisted", "cost_usd_est",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "watchlist_added"]);

/** Maps a header row + value rows into objects, filling missing columns with "". */
export function rowsFromValues<T>(header: string[], values: unknown[][], columns: readonly string[]): T[] {
  const index = new Map(header.map((h, i) => [String(h).trim(), i]));
  return values
    .filter((r) => r.some((v) => v !== "" && v !== null && v !== undefined))
    .map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of columns) {
        const i = index.get(c);
        const v = i === undefined ? "" : r[i] ?? "";
        o[c] = NUMERIC.has(c) && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v === null ? "" : String(v);
      }
      return o as T;
    });
}
