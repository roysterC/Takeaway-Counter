/**
 * The words a general-purpose recogniser gets wrong on a takeaway's calls:
 * the shop's own name and the dishes. "Char siu" heard as "chart sue", or
 * "foo yung" as "few young", puts the wrong dish on the order, so Deepgram is
 * told to listen for them (Nova-3's keyterm prompting).
 *
 * Kept short: Deepgram caps the list, and a long one dilutes the boost for
 * the words that matter. Whole dish names are not sent (there are nearly two
 * hundred); the distinctive words in them are.
 */

export const MAX_KEYTERMS = 60;

/**
 * Chinese takeaway words callers use that ordinary speech recognition
 * mangles. Everyday words ("chicken", "rice") are left out on purpose: they
 * are heard fine already, and boosting short common words makes the
 * recogniser hear them where they were not said.
 */
export const TAKEAWAY_TERMS = [
  "char siu",
  "chow mein",
  "foo yung",
  "Szechuan",
  "Kung Po",
  "satay",
  "yuk sung",
  "won ton",
  "vermicelli",
  "Singapore",
  "Yeung Chow",
  "Hong Kong style",
  "chop suey",
  "beansprout",
  "beancurd",
  "hoi sin",
  "Peking",
  "salt and chilli",
  "salt chilli pepper",
  "black bean",
  "oyster sauce",
  "water chestnuts",
  "bamboo shoots",
  "prawn crackers",
  "prawn toast",
  "spring rolls",
  "aromatic duck",
  "crispy shredded",
  "say so",
  "egg fried rice",
  "boiled rice",
  "three in one",
  "collection",
  "delivery",
];

const MAX_TOTAL_CHARS = 1000;
const MAX_TERM_CHARS = 50;

export function takeawayKeyterms(input: { businessName?: string | null; extra?: string[] }): string[] {
  const candidates: string[] = [];
  if (input.businessName) candidates.push(input.businessName);
  candidates.push(...TAKEAWAY_TERMS, ...(input.extra ?? []));

  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of candidates) {
    const term = raw.replace(/[^\p{L}\p{N}'&\- ]+/gu, " ").replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > MAX_TERM_CHARS) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= MAX_KEYTERMS || chars + term.length > MAX_TOTAL_CHARS) break;
    seen.add(key);
    out.push(term);
    chars += term.length;
  }
  return out;
}
