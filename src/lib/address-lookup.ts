/**
 * Postcode to addresses, so a new delivery customer is asked only for their
 * postcode and house number rather than spelling out a street on a bad line.
 *
 * Royal Mail's address file (PAF) is licensed, so this needs a paid
 * provider: Ideal Postcodes, with its key in IDEAL_POSTCODES_API_KEY.
 * Without a key the lookup says so and the receptionist falls back to asking
 * for the address in full. A postcode the provider doesn't recognise costs
 * nothing; found ones are kept for a day, since a takeaway's customers come
 * from the same few streets.
 */

import { normalisePostcode } from "@/lib/delivery";

export interface FoundAddress {
  /** "14 Smithy Lane", "Flat 2, The Old Forge" */
  line1: string;
  /** Further lines, usually the village: "Hixon" */
  line2: string | null;
  /** "Stafford" */
  town: string | null;
  postcode: string;
  /** "14", "2a" */
  number: string | null;
  /** "The Old Forge", "Rose Cottage" */
  building: string | null;
  /** "Flat 2" */
  subBuilding: string | null;
  /** "Smithy Lane" */
  street: string | null;
}

export type LookupResult =
  | { ok: true; addresses: FoundAddress[] }
  | { ok: false; reason: "not_found"; suggestions: string[] }
  | { ok: false; reason: "not_configured" | "unavailable" };

const DAY_MS = 24 * 3600_000;
const MAX_CACHED = 500;
const g = globalThis as unknown as { __postcodeCache?: Map<string, { at: number; addresses: FoundAddress[] }> };
const cache: Map<string, { at: number; addresses: FoundAddress[] }> = (g.__postcodeCache ??= new Map());

/** "STAFFORD" -> "Stafford", "NEWCASTLE-UNDER-LYME" -> "Newcastle-under-Lyme" */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/-(Under|Upon|On|In|Le|By)-/g, (m) => m.toLowerCase());
}

interface IdealAddress {
  line_1?: string;
  line_2?: string;
  line_3?: string;
  post_town?: string;
  postcode?: string;
  building_number?: string;
  building_name?: string;
  sub_building_name?: string;
  thoroughfare?: string;
}

export function fromIdeal(a: IdealAddress): FoundAddress {
  const extra = [a.line_2, a.line_3].map((l) => l?.trim()).filter(Boolean);
  return {
    line1: a.line_1?.trim() ?? "",
    line2: extra.length ? extra.join(", ") : null,
    town: a.post_town ? titleCase(a.post_town) : null,
    postcode: a.postcode ?? "",
    number: a.building_number?.trim() || null,
    building: a.building_name?.trim() || null,
    subBuilding: a.sub_building_name?.trim() || null,
    street: a.thoroughfare?.trim() || null,
  };
}

export async function lookupPostcode(
  raw: string,
  opts: { apiKey?: string | null; fetch?: typeof fetch; now?: number } = {}
): Promise<LookupResult> {
  const pc = normalisePostcode(raw);
  if (!pc?.full) return { ok: false, reason: "not_found", suggestions: [] };
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const now = opts.now ?? Date.now();
  const hit = cache.get(pc.postcode);
  if (hit && now - hit.at < DAY_MS) return { ok: true, addresses: hit.addresses };

  const url = `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(pc.postcode)}?api_key=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const body = (await res.json().catch(() => null)) as { result?: IdealAddress[]; suggestions?: string[] } | null;
  if (res.status === 404) return { ok: false, reason: "not_found", suggestions: body?.suggestions ?? [] };
  if (!res.ok || !Array.isArray(body?.result)) {
    // A bad key or an empty balance is the shop's to fix, not the caller's: log it, carry on without.
    console.warn(`[ADDRESS] postcode lookup failed with ${res.status}`);
    return { ok: false, reason: "unavailable" };
  }
  const addresses = body.result.map(fromIdeal).filter((a) => a.line1);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(pc.postcode, { at: now, addresses });
  return { ok: true, addresses };
}

const tokens = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\b(number|no)\b\.?/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const hasDigit = (t: string) => /\d/.test(t);

/** Words that are never what tells two houses apart. */
const FILLER = new Set(["the", "a", "at", "its", "it", "is", "called"]);

/**
 * A name word as it is compared: plural and possessive endings taken off, so
 * "The Hollies", "Hollys" and "Holly's" all come to "holly".
 */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

/**
 * How close a heard word is to a word of a house name: 2 the same, 1 a
 * likely mishearing ("cotage", "forje"), 0 different. Short words must match
 * exactly, or "Rose" would be taken for "Ross".
 */
function closeness(heard: string, name: string): 0 | 1 | 2 {
  if (heard === name) return 2;
  const n = Math.min(heard.length, name.length);
  if (n < 5) return 0;
  return distance(heard, name) <= (n >= 8 ? 2 : 1) ? 1 : 0;
}

export type AddressMatch =
  | { kind: "found"; address: FoundAddress }
  | { kind: "choose"; options: FoundAddress[] }
  | { kind: "none" };

/**
 * The caller's address among a postcode's, from what they said: a house
 * number ("14", "2a"), a house name ("Rose Cottage"), a flat ("flat 2, 14"),
 * optionally the street when the postcode covers more than one.
 *
 * Numbers must match exactly: 14 and 41 are different houses. House names
 * are matched the way they reach us down a phone line: a word or two
 * misheard ("Rose Cotage"), run together or split ("Wood Lands"), part of
 * the name ("Ivy" when it's the only Ivy), an extra word ("the Old Forge
 * house"), or the street said with it ("Rose Cottage, Smithy Lane").
 */
export function matchAddress(addresses: FoundAddress[], said: { house: string; street?: string | null }): AddressMatch {
  const heard = tokens(said.house);
  if (!heard.length) return { kind: "none" };
  const numbersSaid = heard.filter(hasDigit);
  const wordsSaid = heard.filter((t) => !hasDigit(t) && !FILLER.has(t)).map(stem);
  const streetWords = tokens(said.street);

  const scored = addresses
    .map((a) => {
      // Any number they said must be this house's or flat's number, never a
      // number that happens to be in a street name.
      const numbers = new Set([...tokens(a.number), ...tokens(a.subBuilding).filter(hasDigit)]);
      if (!numbersSaid.every((n) => numbers.has(n))) return null;
      if (streetWords.length && !streetWords.every((w) => tokens(a.street ?? a.line1).includes(w))) return null;

      const exactNumber = numbersSaid.length > 0 && a.number?.toLowerCase() === numbersSaid.join("") && !a.subBuilding;
      const nameWords = [...tokens(a.building), ...tokens(a.subBuilding)].filter((t) => !hasDigit(t) && !FILLER.has(t)).map(stem);
      // The street, village or town said along with the name is not part of it.
      const place = new Set([...tokens(a.street), ...tokens(a.line2), ...tokens(a.town)].map(stem));
      const spoken = wordsSaid.filter((w) => !place.has(w) || nameWords.includes(w));

      if (!spoken.length) return numbersSaid.length ? { a, score: exactNumber ? 3 : 1, exactNumber } : null;
      if (!nameWords.length) return null;

      let score = 0;
      let unmatched = 0;
      for (const w of spoken) {
        const best = Math.max(0, ...nameWords.map((n) => closeness(w, n)));
        if (best) score += best;
        else unmatched++;
      }
      const covered = nameWords.filter((n) => spoken.some((w) => closeness(w, n))).length;
      // "Wood Lands" for Woodlands, "Oak Tree" for Oaktree.
      const joined = closeness(spoken.join(""), nameWords.join("")) > 0;
      const wholeName = covered === nameWords.length || joined;
      // Everything they said is in the name (word by word, or run together),
      // or they said the whole name and at most one word more ("house").
      if (joined) unmatched = 0;
      if (!(unmatched === 0 || (wholeName && unmatched <= 1))) return null;
      return { a, score: score + (wholeName ? 2 : 0) + (joined ? 2 : 0) - unmatched, exactNumber };
    })
    .filter((s): s is { a: FoundAddress; score: number; exactNumber: boolean } => s !== null);

  if (scored.length === 1) return { kind: "found", address: scored[0].a };
  if (!scored.length) return { kind: "none" };
  // "14" with a house at 14 and flats at 14: the house, unless they said a flat.
  const exact = scored.filter((s) => s.exactNumber);
  if (exact.length === 1) return { kind: "found", address: exact[0].a };
  // One clearly closer than the rest: "Ivy House" over Ivy Cottage.
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  if (best.length === 1) return { kind: "found", address: best[0].a };
  return { kind: "choose", options: best.slice(0, 6).map((s) => s.a) };
}

/**
 * The named houses at a postcode nearest to a name that matched none of
 * them, for "did you mean The Hollies?". Closest first; at most three, and
 * only ones near enough to be worth asking about.
 */
export function nearestNames(addresses: FoundAddress[], name: string): FoundAddress[] {
  const heard = tokens(name).filter((t) => !hasDigit(t) && !FILLER.has(t)).map(stem).join("");
  if (heard.length < 3) return [];
  return addresses
    .filter((a) => a.building)
    .map((a) => {
      const full = tokens(a.building).filter((t) => !FILLER.has(t)).map(stem).join("");
      return { a, ratio: distance(heard, full) / Math.max(heard.length, full.length) };
    })
    .filter((x) => x.ratio <= 0.5)
    .sort((x, y) => x.ratio - y.ratio)
    .slice(0, 3)
    .map((x) => x.a);
}
