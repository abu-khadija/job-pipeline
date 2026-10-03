import { describe, expect, it } from "vitest";
import { classifyLocation, classifyLocationList, detectEor } from "../src/normalize/location.js";
import { cfg } from "./helpers.js";

const t = cfg.targeting;
const text = (locationText: string, description = "", viaEor = false) =>
  classifyLocation({ locationText, description, viaEor }, t);
const list = (places: string[], description = "", viaEor = false) =>
  classifyLocation({ places, locationText: places.join(", "), description, viaEor }, t);

describe("classifyLocation — free text (WWR, Remote OK)", () => {
  // [location text, description, expected scope, expected eligibility]
  const cases: [string, string, string, string][] = [
    ["Anywhere in the World", "", "worldwide", "yes"],
    ["Worldwide", "", "worldwide", "yes"],
    ["EMEA", "", "emea", "yes"],
    ["Africa", "", "africa", "yes"],
    ["Egypt", "", "egypt", "yes"],
    ["Middle East", "", "emea", "yes"],
    ["Remote", "", "unknown", "unknown"],
    ["", "", "unknown", "unknown"],
    ["", "We hire globally. Work from anywhere.", "worldwide", "yes"],
    ["", "Open to candidates in EMEA time zones.", "emea", "yes"],
    ["USA", "", "us_only", "no"],
    ["United States", "", "us_only", "no"],
    ["Remote - Americas", "", "country_list", "no"],
    ["Europe", "", "europe_only", "no"],
    ["Greater Newcastle Area", "", "country_list", "no"],
    ["Worldwide", "Applicants must be authorized to work in the United States.", "us_only", "no"],
    ["", "US only. No visa sponsorship.", "us_only", "no"],
    ["Anywhere", "Candidates must reside in Canada.", "country_list", "no"],
    ["", "This role requires security clearance.", "us_only", "no"],
    ["", "Our focus only on quality.", "unknown", "unknown"],
  ];
  for (const [loc, desc, scope, eligible] of cases) {
    it(`"${loc}" + "${desc.slice(0, 40)}" → ${scope}/${eligible}`, () => {
      const r = text(loc, desc);
      expect(r.scope).toBe(scope);
      expect(r.eligible).toBe(eligible);
    });
  }
});

describe("classifyLocation — structured lists (Himalayas, Remotive)", () => {
  it("empty list means worldwide", () => expect(list([]).eligible).toBe("yes"));
  it("a list containing Egypt is eligible", () => expect(list(["Saudi Arabia", "Egypt"]).scope).toBe("egypt"));
  it("USA only is not eligible", () => expect(list(["USA"]).scope).toBe("us_only"));
  it("Americas mix is not eligible", () => expect(list(["USA", "Canada"]).scope).toBe("americas_only"));
  it("country list without Egypt is not eligible", () => expect(list(["Poland", "Germany"]).eligible).toBe("no"));
  it("Remotive region list without EMEA is not eligible", () =>
    expect(list(["Northern America", "LATAM", "Europe", "APAC"]).eligible).toBe("no"));
  it("Europe only becomes unknown when hiring via an EOR", () => {
    expect(list(["Europe"]).eligible).toBe("no");
    expect(list(["Europe"], "", true).eligible).toBe("unknown");
  });
  it("reject phrases beat an eligible list", () =>
    expect(list([], "Must be located in the US").eligible).toBe("no"));
});

describe("classifyLocationList", () => {
  it.each([
    [["Worldwide"], "worldwide"],
    [["EMEA"], "emea"],
    [["Africa", "Europe"], "africa"],
    [["UK"], "europe_only"],
    [["USA", "LATAM"], "americas_only"],
  ])("%j → %s", (places, scope) => expect(classifyLocationList(places)).toBe(scope));
});

describe("detectEor", () => {
  it("finds Deel and contractor signals", () => {
    expect(detectEor("We pay through Deel", t)).toBe(true);
    expect(detectEor("Hired as an independent contractor", t)).toBe(true);
    expect(detectEor("Full-time employee in Berlin", t)).toBe(false);
  });
});
