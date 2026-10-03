// Decides whether a remote job is open to someone living in Egypt.
// Authorization/residence phrases always drop a job. Region limits ("EU only") drop it
// unless the post hires through an EOR/contractors; then the AI scorer decides.
// "unknown" and "gulf" are left for the AI scorer to judge.
import type { Targeting } from "../config.js";
import type { RemoteScope } from "../schema.js";
import { findPhrases, normalizeForMatch } from "./text.js";

export interface LocationResult {
  scope: RemoteScope;
  eligible: "yes" | "no" | "unknown";
  reasons: string[];
}

// Region names that sources put in a location list, and what they mean for Egypt.
const OK_REGIONS = ["worldwide", "anywhere", "global", "emea", "africa", "mena", "middle east", "egypt", "anywhere in the world"];
const US_REGIONS = ["usa", "us", "united states", "united states of america", "u s"];
const AMERICAS_REGIONS = ["northern america", "north america", "latam", "latin america", "americas", "canada", "south america"];
const EUROPE_REGIONS = ["europe", "eu", "european union", "uk", "united kingdom", "eea"];

const NO_INFO_WORDS = /\b(remote|fully|100|work from home|wfh|position|job|anywhere remote)\b/g;

function inList(item: string, list: string[]): boolean {
  const n = normalizeForMatch(item);
  return list.some((l) => normalizeForMatch(l) === n);
}

/**
 * Classifies a list of allowed places (Himalayas restrictions, Remotive's
 * candidate_required_location split on commas, an ATS location field).
 */
export function classifyLocationList(places: string[], gulfPlaces: string[] = []): RemoteScope {
  const items = places.map((p) => p.trim()).filter(Boolean);
  // An empty list means the company didn't say, not "worldwide" (Himalayas shows such jobs to
  // every country; TransPerfect and zvoove looked open to Egypt this way and were not).
  if (items.length === 0) return "unknown";
  if (items.some((p) => inList(p, ["egypt", "eg"]))) return "egypt";
  if (items.some((p) => inList(p, ["africa"]))) return "africa";
  if (items.some((p) => inList(p, ["emea", "mena", "middle east"]))) return "emea";
  if (items.some((p) => inList(p, ["worldwide", "anywhere", "global", "anywhere in the world"]))) return "worldwide";
  // Gulf only when the whole list is Gulf/MENA: Morocco among 14 other countries is just a country list.
  if (gulfPlaces.length && items.every((p) => inList(p, gulfPlaces))) return "gulf";
  if (items.every((p) => inList(p, US_REGIONS))) return "us_only";
  if (items.every((p) => inList(p, [...US_REGIONS, ...AMERICAS_REGIONS]))) return "americas_only";
  if (items.every((p) => inList(p, EUROPE_REGIONS))) return "europe_only";
  return "country_list";
}

export function eligibilityOf(scope: RemoteScope, viaEor: boolean): "yes" | "no" | "unknown" {
  switch (scope) {
    case "worldwide":
    case "emea":
    case "africa":
    case "egypt":
      return "yes";
    case "gulf":
      return "unknown";
    case "europe_only":
      return viaEor ? "unknown" : "no";
    case "us_only":
    case "americas_only":
    case "country_list":
      return "no";
    default:
      return "unknown";
  }
}

/** Region phrase → scope, used when a post says "EU only" etc. */
function scopeOfRegionPhrase(phrase: string): RemoteScope {
  const n = normalizeForMatch(phrase);
  if (/\b(us|usa|u s|united states)\b/.test(n)) return "us_only";
  if (/\b(americas|north america|latam|canada)\b/.test(n)) return "americas_only";
  if (/\b(eu|europe|uk)\b/.test(n)) return "europe_only";
  return "country_list";
}

/**
 * Full check: a location list (if the source gives one) plus free text
 * (location field + description) scanned for reject and accept phrases.
 */
export function classifyLocation(
  input: { places?: string[]; locationText: string; description: string; viaEor: boolean },
  t: Targeting,
): LocationResult {
  const reasons: string[] = [];
  const text = `${input.locationText}\n${input.description}`;
  const gulf = t.location.gulfPlaces;

  // 1. Work authorization, residence, clearance: always a no, EOR or not.
  const auth = findPhrases(text, t.location.rejectAuthorization);
  if (auth.length > 0) {
    const usLike = auth.some((r) => /\b(us|usa|u s|united states|green card|security clearance)\b/.test(normalizeForMatch(r)));
    return { scope: usLike ? "us_only" : "country_list", eligible: "no", reasons: auth.map((r) => `location: "${r}"`) };
  }

  // 2. Region limits: a no, unless the company hires through an EOR / contractors.
  const region = findPhrases(text, t.location.rejectRegion);
  if (region.length > 0) {
    const scope = scopeOfRegionPhrase(region[0]!);
    if (!input.viaEor) return { scope, eligible: "no", reasons: region.map((r) => `location: "${r}"`) };
    return { scope, eligible: "unknown", reasons: [`location: "${region[0]}" but hires via EOR/contractors`] };
  }

  // 3. A structured list from the source. An empty list says nothing: read the text instead.
  if (input.places !== undefined && input.places.some((p) => p.trim())) {
    const scope = classifyLocationList(input.places, gulf);
    const eligible = eligibilityOf(scope, input.viaEor);
    if (eligible === "no") reasons.push(`location: limited to ${input.places.join(", ")}`);
    return { scope, eligible, reasons };
  }

  // 4. Free text. Words like "Remote" alone say nothing about where you may live.
  const loc = normalizeForMatch(input.locationText).replace(NO_INFO_WORDS, " ").replace(/\s+/g, " ").trim();
  if (loc && OK_REGIONS.some((r) => ` ${loc} `.includes(` ${normalizeForMatch(r)} `))) {
    const scope = classifyLocationList([input.locationText.split(/[,;/]/)[0] ?? ""], gulf);
    return { scope: scope === "country_list" ? "worldwide" : scope, eligible: "yes", reasons };
  }
  const accepts = findPhrases(text, t.location.accept);
  if (accepts.length > 0) {
    const a = normalizeForMatch(accepts[0] ?? "");
    const scope: RemoteScope = a.includes("egypt") ? "egypt" : a.includes("africa") ? "africa"
      : a.includes("emea") || a.includes("mena") || a.includes("middle east") ? "emea" : "worldwide";
    return { scope, eligible: "yes", reasons };
  }
  if (loc) {
    const places = input.locationText.split(/[,;/]|\bor\b/).filter((p) => normalizeForMatch(p).replace(NO_INFO_WORDS, "").trim());
    const scope = classifyLocationList(places, gulf);
    const eligible = eligibilityOf(scope, input.viaEor);
    if (eligible === "no") reasons.push(`location: limited to ${input.locationText}`);
    return { scope, eligible, reasons };
  }
  return { scope: "unknown", eligible: "unknown", reasons };
}

export function detectEor(text: string, t: Targeting): boolean {
  return findPhrases(text, t.location.eorSignals).length > 0;
}

/** Posts that ask for Arabic or RTL testing: a plus for Islam (segment mena_gulf). */
export function detectArabic(text: string, t: Targeting): boolean {
  return findPhrases(text, t.arabicKeywords).length > 0;
}
