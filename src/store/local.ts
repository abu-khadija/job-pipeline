// Local files instead of the Sheet: out/<Tab>.json (state) + out/<Tab>.csv (to open in
// Excel/Numbers), and out/control.json (kill switch, same meaning as the Control tab).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseControl, TABS, type Control, type Store, type TabName, type TabRows } from "./types.js";

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[]): string {
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

  async readTable<T extends TabName>(tab: T): Promise<TabRows[T][]> {
    const f = this.file(`${tab}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as TabRows[T][]) : [];
  }

  async writeTable<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void> {
    writeFileSync(this.file(`${tab}.json`), JSON.stringify(rows, null, 2) + "\n");
    writeFileSync(this.file(`${tab}.csv`), toCsv(rows as unknown as Record<string, unknown>[], TABS[tab]));
  }

  async appendRows<T extends TabName>(tab: T, rows: TabRows[T][]): Promise<void> {
    await this.writeTable(tab, [...(await this.readTable(tab)), ...rows]);
  }
}
