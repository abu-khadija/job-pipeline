import { describe, expect, it } from "vitest";
import { toCsv } from "../src/store/local.js";
import { colLetter } from "../src/store/sheet.js";
import { parseControl } from "../src/store/types.js";

describe("parseControl (kill switch cell)", () => {
  it.each([
    ["RUN", "RUN"],
    [" run ", "RUN"],
    ["STOP", "STOP"],
    ["stop", "STOP"],
    ["STPO", "STOP"], // a typo stops the run: the safe side
    [undefined, "RUN"], // empty cell on a fresh Sheet
  ])("%j → %s", (cell, expected) => expect(parseControl(cell, "dry").killSwitch).toBe(expected));

  it("mode is dry unless it says live", () => {
    expect(parseControl("RUN", "live").mode).toBe("live");
    expect(parseControl("RUN", "LIVE ").mode).toBe("live");
    expect(parseControl("RUN", "anything").mode).toBe("dry");
    expect(parseControl("RUN", undefined).mode).toBe("dry");
  });
});

describe("toCsv", () => {
  it("escapes commas, quotes and new lines", () => {
    const csv = toCsv([{ a: 'He said "hi", ok', b: "line1\nline2", c: 3 }], ["a", "b", "c"]);
    expect(csv).toBe('a,b,c\n"He said ""hi"", ok","line1\nline2",3\n');
  });
});

describe("colLetter", () => {
  it.each([[1, "A"], [21, "U"], [26, "Z"], [27, "AA"], [52, "AZ"]])("%i → %s", (n, l) => expect(colLetter(n)).toBe(l));
});
