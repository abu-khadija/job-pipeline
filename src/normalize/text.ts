// Small text helpers shared by the normalizers and filters.

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

/**
 * Some feeds (Remote OK) send UTF-8 text that was decoded as Latin-1, so "We're" arrives
 * as "Weâ\u0080\u0099re". Re-decode only when that pattern is present and it helps.
 */
export function fixMojibake(s: string): string {
  if (!/[ÃÂâ][\u0080-\u00bf]/.test(s)) return s;
  if (/[^\u0000-\u00ff]/.test(s)) return s; // real non-Latin-1 text: leave it alone
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("\ufffd") ? s : fixed;
}

/** Turns "&lt;p&gt;" back into "<p>" (Greenhouse sends its HTML escaped). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** HTML → plain text, keeping paragraph breaks so descriptions stay readable. */
export function stripHtml(html: string): string {
  return fixMojibake(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>]*$/, " ") // a tag cut off at the end
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lowercase, and turn punctuation into spaces so "AI-First QA" matches "ai first qa". */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

/**
 * True if `phrase` appears in `text` as whole words.
 * Both are normalized, so "U.S. only" matches "us only" but "focus only" does not.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizeForMatch(phrase);
  if (!p) return false;
  return ` ${normalizeForMatch(text)} `.includes(` ${p} `);
}

/** Every phrase from `phrases` that appears in `text`. */
export function findPhrases(text: string, phrases: string[]): string[] {
  const t = ` ${normalizeForMatch(text)} `;
  return phrases.filter((p) => {
    const n = normalizeForMatch(p);
    return n.length > 0 && t.includes(` ${n} `);
  });
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}
