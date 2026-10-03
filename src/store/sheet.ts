// Google Sheet store, using a service account the Sheet is shared with (docs/SETUP-ISLAM.md A5).
import { readFileSync } from "node:fs";
import { google, type sheets_v4 } from "googleapis";
import { JOB_COLUMNS, RUN_COLUMNS, type JobRow, type RunLog } from "../schema.js";
import { parseControl, type Control, type Store } from "./types.js";

const TABS: Record<string, string[]> = {
  Jobs: JOB_COLUMNS,
  Runs: RUN_COLUMNS,
  Exceptions: ["created_at", "job_id", "company", "reason", "what_islam_must_do", "resolved"],
  Control: [],
};

/** Column letter for a 1-based index (1 → A, 27 → AA). */
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function loadCredentials(): Record<string, string> {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline) return JSON.parse(inline);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  throw new Error("Google credentials missing: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_PATH (docs/SETUP-ISLAM.md A5-A7)");
}

export class SheetStore implements Store {
  readonly name = "Google Sheet";
  private api: sheets_v4.Sheets;
  private ready = false;

  constructor(private sheetId: string) {
    const auth = new google.auth.GoogleAuth({
      credentials: loadCredentials(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.api = google.sheets({ version: "v4", auth });
  }

  /** Creates missing tabs, headers and Control defaults. Safe to run every time. */
  private async ensureTabs(): Promise<void> {
    if (this.ready) return;
    const meta = await this.api.spreadsheets.get({ spreadsheetId: this.sheetId });
    const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
    const missing = Object.keys(TABS).filter((t) => !existing.has(t));
    if (missing.length) {
      await this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }
    for (const [tab, cols] of Object.entries(TABS)) {
      if (!missing.includes(tab)) continue;
      const values = tab === "Control"
        ? [["kill_switch", "RUN"], ["mode", "dry"]]
        : [cols];
      await this.api.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    }
    this.ready = true;
  }

  async readControl(): Promise<Control> {
    await this.ensureTabs();
    const res = await this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: "Control!B1:B2" });
    const v = res.data.values ?? [];
    return parseControl(v[0]?.[0], v[1]?.[0]);
  }

  async readJobs(): Promise<JobRow[]> {
    await this.ensureTabs();
    const last = colLetter(JOB_COLUMNS.length);
    const res = await this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `Jobs!A2:${last}` });
    return (res.data.values ?? [])
      .filter((r) => r[0])
      .map((r) => Object.fromEntries(JOB_COLUMNS.map((c, i) => [c, r[i] ?? ""])) as unknown as JobRow);
  }

  async writeJobs(rows: JobRow[]): Promise<void> {
    await this.ensureTabs();
    if (rows.length === 0) return;
    const last = colLetter(JOB_COLUMNS.length);
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `Jobs!A2:${last}${rows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: rows.map((r) => JOB_COLUMNS.map((c) => r[c] ?? "")) },
    });
  }

  async appendRun(run: RunLog): Promise<void> {
    await this.ensureTabs();
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: "Runs!A1",
      valueInputOption: "RAW",
      requestBody: { values: [RUN_COLUMNS.map((c) => run[c])] },
    });
  }
}
