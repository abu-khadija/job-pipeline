import { describe, expect, it } from "vitest";
import { parseSalaryText, salaryFromNumbers } from "../src/normalize/salary.js";
import { fixMojibake, stripHtml } from "../src/normalize/text.js";
import { cfg } from "./helpers.js";

const fx = cfg.limits.fx;
const parse = (s: string | null) => parseSalaryText(s, fx);

describe("parseSalaryText", () => {
  // [input, expected max USD/month, expected min USD/month, expected period]
  const cases: [string, number, number | null, string][] = [
    ["$60k - $80k", 6667, 5000, "year"],
    ["$90k - $105k", 8750, 7500, "year"],
    ["60,000-80,000 USD/year", 6667, 5000, "year"],
    ["USD 72000 per annum", 6000, 6000, "year"],
    ["$120K", 10000, 10000, "year"],
    ["$5,000/month", 5000, 5000, "month"],
    ["3000 - 4000 USD monthly", 4000, 3000, "month"],
    ["$2500 per month", 2500, 2500, "month"],
    ["$30/hr", 4800, 4800, "hour"],
    ["$25 - $35 per hour", 5600, 4000, "hour"],
    ["USD 20 hourly", 3200, 3200, "hour"],
    ["$200/day", 4200, 4200, "day"],
    ["€4,000/month", 4320, 4320, "month"],
    ["€50k-€60k", 5400, 4500, "year"],
    ["50.000 - 60.000 EUR", 5400, 4500, "year"],
    ["£45,000 - £55,000", 5821, 4763, "year"],
    ["CAD 90,000", 5475, 5475, "year"],
    ["Up to $80k", 6667, null, "year"],
    ["$1.5k/month", 1500, 1500, "month"],
    ["12 USD/hour", 1920, 1920, "hour"],
  ];

  for (const [input, max, min, period] of cases) {
    it(`parses "${input}"`, () => {
      const s = parse(input);
      expect(s).not.toBeNull();
      expect(s!.maxUsdMonth).toBe(max);
      expect(s!.minUsdMonth).toBe(min);
      expect(s!.period).toBe(period);
    });
  }

  it.each([null, "", "   ", "Competitive", "DOE", "Negotiable based on experience"])("returns null for %j", (input) => {
    expect(parse(input)).toBeNull();
  });

  it("does not read years of experience as a salary", () => {
    expect(parse("5+ years, competitive pay")).toBeNull();
  });

  it("returns null for an unknown currency rate", () => {
    expect(salaryFromNumbers(1000, 2000, "month", "XYZ", fx)).toBeNull();
  });
});

describe("salaryFromNumbers", () => {
  it("converts yearly USD to monthly", () => {
    expect(salaryFromNumbers(60000, 84000, "year", "USD", fx)).toMatchObject({ minUsdMonth: 5000, maxUsdMonth: 7000 });
  });
  it("uses min as max when max is missing", () => {
    expect(salaryFromNumbers(48000, null, "year", "USD", fx)).toMatchObject({ minUsdMonth: 4000, maxUsdMonth: 4000 });
  });
  it("returns null when both are missing or zero", () => {
    expect(salaryFromNumbers(null, null, "year", "USD", fx)).toBeNull();
    expect(salaryFromNumbers(0, 0, "year", "USD", fx)).toBeNull();
  });
});

describe("text cleanup", () => {
  it("repairs UTF-8 read as Latin-1", () => {
    const broken = Buffer.from("We’re hiring — café", "utf8").toString("latin1");
    expect(fixMojibake(broken)).toBe("We’re hiring — café");
  });
  it("leaves normal text alone", () => {
    expect(fixMojibake("Café in São Paulo")).toBe("Café in São Paulo");
    expect(fixMojibake("مرحبا")).toBe("مرحبا");
  });
  it("strips tags, entities and a tag cut off at the end", () => {
    expect(stripHtml("<p>A &amp; B</p><ul><li>One</li></ul><p class=\"x")).toBe("A & B\nOne");
  });
});
