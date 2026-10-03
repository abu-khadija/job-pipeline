// Where the pipeline keeps its state. The Google Sheet in production, local files with --local.
import type { JobRow, RunLog } from "../schema.js";

export interface Control {
  /** "STOP" halts every run before it does anything. */
  killSwitch: "RUN" | "STOP";
  /** Sending also needs DRY_RUN=false in the environment (Phase 3+). */
  mode: "dry" | "live";
}

export interface Store {
  readonly name: string;
  readControl(): Promise<Control>;
  readJobs(): Promise<JobRow[]>;
  /** Replaces the whole Jobs table with `rows` (existing rows first, then new ones). */
  writeJobs(rows: JobRow[]): Promise<void>;
  appendRun(run: RunLog): Promise<void>;
}

export function parseControl(killSwitch: unknown, mode: unknown): Control {
  // Anything other than an explicit RUN is treated as STOP: safer when the cell is mistyped.
  const ks = String(killSwitch ?? "RUN").trim().toUpperCase() === "RUN" ? "RUN" : "STOP";
  const m = String(mode ?? "dry").trim().toLowerCase() === "live" ? "live" : "dry";
  return { killSwitch: ks, mode: m };
}
