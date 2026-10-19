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
    .replace(/\b(number|no)\b\.?/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export type AddressMatch =
  | { kind: "found"; address: FoundAddress }
  | { kind: "choose"; options: FoundAddress[] }
  | { kind: "none" };

/**
 * The caller's address among a postcode's, from what they said: a house
 * number ("14", "2a"), a house name ("Rose Cottage"), a flat ("flat 2, 14"),
 * optionally the street when the postcode covers more than one.
 */
export function matchAddress(addresses: FoundAddress[], said: { house: string; street?: string | null }): AddressMatch {
  const want = tokens(said.house);
  if (!want.length) return { kind: "none" };
  const streetWords = tokens(said.street);

  const scored = addresses
    .map((a) => {
      const have = new Set([...tokens(a.number), ...tokens(a.building), ...tokens(a.subBuilding), ...tokens(a.line1)]);
      const numbers = new Set([...tokens(a.number), ...tokens(a.subBuilding).filter((t) => /\d/.test(t))]);
      // Every word they said must be there, and any number they said must be a
      // house or flat number here, not part of a street name.
      const ok = want.every((w) => have.has(w)) && want.filter((w) => /\d/.test(w)).every((w) => numbers.has(w));
      const onStreet = !streetWords.length || streetWords.every((w) => tokens(a.street ?? a.line1).includes(w));
      return { a, ok: ok && onStreet, exactNumber: a.number?.toLowerCase() === want.join("") && !a.subBuilding };
    })
    .filter((s) => s.ok);

  if (scored.length === 1) return { kind: "found", address: scored[0].a };
  if (!scored.length) return { kind: "none" };
  // "14" with a house at 14 and flats at 14: the house, unless they said a flat.
  const exact = scored.filter((s) => s.exactNumber);
  if (exact.length === 1) return { kind: "found", address: exact[0].a };
  return { kind: "choose", options: scored.slice(0, 6).map((s) => s.a) };
}
