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
  it("empty list means unknown, not worldwide (Himalayas: company didn't say)", () => expect(list([]).eligible).toBe("unknown"));
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
  it("Gulf-only lists are left for the AI to judge", () => {
    const r = list(["United Arab Emirates", "Saudi Arabia"]);
    expect(r.scope).toBe("gulf");
    expect(r.eligible).toBe("unknown");
  });
});

describe("region phrases vs authorization phrases (EOR)", () => {
  it("'EU only' drops a job, unless it hires via an EOR (then the AI decides)", () => {
    expect(text("", "Remote, EU only.").eligible).toBe("no");
    const viaDeel = text("", "Remote, EU only. We hire through Deel.", true);
    expect(viaDeel.eligible).toBe("unknown");
    expect(viaDeel.scope).toBe("europe_only");
  });
  it("authorization phrases always drop the job, even with an EOR", () => {
    expect(text("", "Must be authorized to work in the US. We use Deel.", true).eligible).toBe("no");
    expect(text("", "Security clearance required.", true).eligible).toBe("no");
  });
  it("generic authorization boilerplate in worldwide posts is not a reject", () => {
    expect(text("Worldwide", "You must be authorized to work in your country of residence.").eligible).toBe("yes");
    expect(text("Anywhere", "We do not offer visa sponsorship or relocation.").eligible).toBe("yes");
  });
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
  it("finds Deel / EOR / worldwide-contractor signals", () => {
    expect(detectEor("We pay through Deel", t)).toBe(true);
    expect(detectEor("We hire worldwide contractors", t)).toBe(true);
    expect(detectEor("Employer of record available", t)).toBe(true);
    expect(detectEor("Full-time employee in Berlin", t)).toBe(false);
  });
  it("plain 'contractor' is not enough (\"US-based contractor\" must not count)", () => {
    expect(detectEor("This is a US-based contractor role", t)).toBe(false);
    expect(detectEor("Hired as an independent contractor", t)).toBe(false);
  });
});
