// Google Sheet store, using a service account the Sheet is shared with (docs/SETUP-ISLAM.md A5).
// Rows are read by header name, so adding or moving a column later doesn't break old data.
// Values are written RAW: a job title starting with "=" stays text, never a formula.
import { readFileSync } from "node:fs";
import { google, type sheets_v4 } from "googleapis";
import { parseControl, rowsFromValues, TABS, type Control, type Store, type TabName, type TabRows } from "./types.js";

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
    const wanted = [...Object.keys(TABS), "Control"];
    const missing = wanted.filter((t) => !existing.has(t));
    if (missing.length) {
      await this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }
    for (const tab of missing) {
      const values = tab === "Control" ? [["kill_switch", "RUN"], ["mode", "dry"]] : [[...TABS[tab as TabName]]];
      await this.api.spreadsheets.values.update({
        spreadsheetId: this.sheetId, range: `${tab}!A1`, valueInputOption: "RAW", requestBody: { values },
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

  async readTable<T extends TabName>(tab: T): Promise<TabRows[T][]> {
    await this.ensureTabs();
    const res = await this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${tab}!A1:ZZ` });
    const [header = [], ...values] = res.data.values ?? [];
    return rowsFromValues<TabRows[T]>(header.map(String), values, TABS[tab]);
  }

  async writeTable<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void> {
    await this.ensureTabs();
    const cols = TABS[tab];
    // Clear first: the table can shrink (for example when rows move to Filtered).
    await this.api.spreadsheets.values.clear({ spreadsheetId: this.sheetId, range: `${tab}!A1:ZZ` });
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `${tab}!A1:${colLetter(cols.length)}${rows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[...cols], ...rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c] ?? ""))] },
    });
  }

  async appendRows<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void> {
    if (rows.length === 0) return;
    await this.ensureTabs();
    const cols = TABS[tab];
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c] ?? "")) },
    });
  }
}
