// Local files instead of the Sheet: out/jobs.json (state), out/jobs.csv (to open in Excel/Numbers),
// out/runs.csv, and out/control.json (kill switch, same meaning as the Control tab).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { JOB_COLUMNS, RUN_COLUMNS, type JobRow, type RunLog } from "../schema.js";
import { parseControl, type Control, type Store } from "./types.js";

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

export class LocalStore implements Store {
  readonly name = "local files (out/)";
  constructor(private dir = path.join(process.cwd(), "out")) {
    mkdirSync(this.dir, { recursive: true });
  }

  private file(name: string) {
    return path.join(this.dir, name);
  }

  async readControl(): Promise<Control> {
    const f = this.file("control.json");
    if (!existsSync(f)) writeFileSync(f, JSON.stringify({ killSwitch: "RUN", mode: "dry" }, null, 2) + "\n");
    const c = JSON.parse(readFileSync(f, "utf8")) as { killSwitch?: string; mode?: string };
    return parseControl(c.killSwitch, c.mode);
  }

  async readJobs(): Promise<JobRow[]> {
    const f = this.file("jobs.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as JobRow[]) : [];
  }

  async writeJobs(rows: JobRow[]): Promise<void> {
    writeFileSync(this.file("jobs.json"), JSON.stringify(rows, null, 2) + "\n");
    writeFileSync(this.file("jobs.csv"), toCsv(rows as unknown as Record<string, unknown>[], JOB_COLUMNS));
  }

  async appendRun(run: RunLog): Promise<void> {
    const f = this.file("runs.csv");
    const csv = toCsv([run as unknown as Record<string, unknown>], RUN_COLUMNS);
    if (existsSync(f)) appendFileSync(f, csv.split("\n").slice(1).join("\n"));
    else writeFileSync(f, csv);
  }
}
