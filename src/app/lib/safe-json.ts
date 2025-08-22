// src/lib/safe-json.ts
/**
 * Try very hard to parse slightly-broken payloads:
 *  - strips BOM
 *  - removes trailing commas
 *  - replaces NaN/Infinity with null
 *  - converts simple single-quoted strings to double-quoted
 *  - if still failing, treats input as JSONL (newline-delimited JSON)
 *  - if still failing, extracts first {...} or [...] block and retries
 */
export function safeParseJSON<T = unknown>(text: string): T | null {
  const clean0 = text.replace(/^\uFEFF/, "");

  // 1) straight parse
  try { return JSON.parse(clean0) as T; } catch {}

  // 2) light cleanup + parse
  const cleaned = clean0
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*NaN/gi, ": null")
    .replace(/:\s*Infinity/gi, ": null")
    .replace(/:\s*-Infinity/gi, ": null")
    .replace(/:\s*'([^']*)'/g, ': "$1"');
  try { return JSON.parse(cleaned) as T; } catch {}

  // 3) JSONL (newline-delimited JSON objects/arrays)
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(l => l && /[\{\[]/.test(l[0]));
  if (lines.length > 0) {
    const arr: any[] = [];
    for (const line of lines) {
      try { arr.push(JSON.parse(line)); } catch {}
    }
    if (arr.length > 0) return arr as any as T;
  }

  // 4) Extract first JSON-looking block and parse
  const m = cleaned.match(/([\[{][\s\S]*[\]}])/);
  if (m) {
    try { return JSON.parse(m[1]) as T; } catch {}
  }

  return null;
}
