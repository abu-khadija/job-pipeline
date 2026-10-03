// Decides whether a remote job is open to someone living in Egypt.
// Reject phrases win over accept phrases. "unknown" is left for the AI scorer to judge.
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
 * candidate_required_location split on commas).
 */
export function classifyLocationList(places: string[]): RemoteScope {
  const items = places.map((p) => p.trim()).filter(Boolean);
  if (items.length === 0) return "worldwide";
  if (items.some((p) => inList(p, ["egypt", "eg"]))) return "egypt";
  if (items.some((p) => inList(p, ["africa"]))) return "africa";
  if (items.some((p) => inList(p, ["emea", "mena", "middle east"]))) return "emea";
  if (items.some((p) => inList(p, ["worldwide", "anywhere", "global", "anywhere in the world"]))) return "worldwide";
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

  const rejects = findPhrases(text, t.location.reject);
  if (rejects.length > 0) {
    const usLike = rejects.some((r) => /\b(us|usa|u s|united states|green card|security clearance)\b/.test(normalizeForMatch(r)));
    return {
      scope: usLike ? "us_only" : "country_list",
      eligible: "no",
      reasons: rejects.map((r) => `location: "${r}"`),
    };
  }

  if (input.places !== undefined) {
    const scope = classifyLocationList(input.places);
    const eligible = eligibilityOf(scope, input.viaEor);
    if (eligible === "no") reasons.push(`location: limited to ${input.places.join(", ")}`);
    return { scope, eligible, reasons };
  }

  // No structured list: look at the location text first, then the description.
  // Words like "Remote" alone say nothing about where you may live, so they are dropped.
  const loc = normalizeForMatch(input.locationText).replace(NO_INFO_WORDS, " ").replace(/\s+/g, " ").trim();
  if (loc && OK_REGIONS.some((r) => ` ${loc} `.includes(` ${normalizeForMatch(r)} `))) {
    const scope = classifyLocationList([input.locationText.split(/[,;/]/)[0] ?? ""]);
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
    const scope = classifyLocationList(places);
    const eligible = eligibilityOf(scope, input.viaEor);
    if (eligible === "no") reasons.push(`location: limited to ${input.locationText}`);
    return { scope, eligible, reasons };
  }
  return { scope: "unknown", eligible: "unknown", reasons };
}

export function detectEor(text: string, t: Targeting): boolean {
  return findPhrases(text, t.location.eorSignals).length > 0;
}
