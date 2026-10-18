/**
 * Who the shop delivers to, and for how much.
 *
 * Zones are postcode prefixes: "ST18 0" is Hixon itself, "ST18" the villages
 * around it, "ST16" Stafford. A postcode is matched against every zone and
 * the longest matching prefix wins, so Hixon's own fee applies in Hixon even
 * though "ST18" matches too.
 *
 * The figures seeded for Hixon are placeholders until the shop gives its own;
 * they are all editable in Settings.
 */

export interface DeliveryZone {
  name: string;
  /** Upper-case, single-spaced: "ST18 0", "ST16". */
  prefixes: string[];
  feePence: number;
}

export interface DeliveryRules {
  enabled: boolean;
  zones: DeliveryZone[];
  minOrderPence: number;
  freeOverPence: number | null;
}

/** Full UK postcode: outward code, a space, inward code ("ST18 0PP"). */
const FULL = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;
/** Just the outward code ("ST18"), which is enough to quote a fee. */
const OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/**
 * A postcode as typed or as the recogniser heard it, tidied: upper case, one
 * space before the inward code. "st180pp", "ST 18 0PP" and "st18 0pp" all
 * become "ST18 0PP". Null when it cannot be a postcode at all.
 */
export function normalisePostcode(raw: string | null | undefined): { full: boolean; postcode: string } | null {
  const squashed = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!squashed) return null;
  const full = squashed.match(FULL);
  if (full) return { full: true, postcode: `${full[1]} ${full[2]}` };
  if (OUTWARD.test(squashed)) return { full: false, postcode: squashed };
  return null;
}

export function parseZones(raw: unknown): DeliveryZone[] {
  if (!Array.isArray(raw)) return [];
  const zones: DeliveryZone[] = [];
  for (const z of raw) {
    if (!z || typeof z !== "object") continue;
    const { name, prefixes, feePence } = z as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof feePence !== "number" || !Number.isInteger(feePence) || feePence < 0) continue;
    const list = (Array.isArray(prefixes) ? prefixes : [])
      .filter((p): p is string => typeof p === "string")
      .map(tidyPrefix)
      .filter(Boolean);
    if (list.length) zones.push({ name: name.trim(), prefixes: list, feePence });
  }
  return zones;
}

/** "st18 0" -> "ST18 0"; "st180" -> "ST18 0" (the inward digit is split off). */
export function tidyPrefix(p: string): string {
  const s = p.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const squashed = s.replace(/ /g, "");
  // An outward code with the inward sector digit run on: "ST180".
  const m = squashed.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d)$/);
  if (m && !s.includes(" ") && !OUTWARD.test(squashed)) return `${m[1]} ${m[2]}`;
  return s;
}

/** Does `postcode` (normalised) fall under `prefix`, on a whole-part boundary? */
function covers(prefix: string, postcode: string): boolean {
  if (!postcode.startsWith(prefix)) return false;
  // "ST1" must not cover "ST18": a prefix that is a whole outward code needs
  // the postcode's outward code to end there too.
  const outward = postcode.split(" ")[0];
  if (!prefix.includes(" ")) return outward === prefix;
  return true;
}

export function zoneFor(zones: DeliveryZone[], postcode: string): DeliveryZone | null {
  let best: { zone: DeliveryZone; len: number } | null = null;
  for (const zone of zones) {
    for (const prefix of zone.prefixes) {
      if (covers(prefix, postcode) && (!best || prefix.length > best.len)) best = { zone, len: prefix.length };
    }
  }
  return best?.zone ?? null;
}

export type DeliveryQuote =
  | {
      ok: true;
      postcode: string;
      zone: string;
      /** What delivery costs on this order; zero once over the free threshold. */
      feePence: number;
      /** The zone's fee before any free-delivery threshold. */
      zoneFeePence: number;
      minOrderPence: number;
      /** How much more food is needed to reach the minimum; 0 when met. */
      shortByPence: number;
    }
  | { ok: false; reason: "disabled" | "bad_postcode" | "outside_area"; postcode?: string };

export function quoteDelivery(rules: DeliveryRules, rawPostcode: string, subtotalPence: number): DeliveryQuote {
  if (!rules.enabled) return { ok: false, reason: "disabled" };
  const pc = normalisePostcode(rawPostcode);
  if (!pc) return { ok: false, reason: "bad_postcode" };
  const zone = zoneFor(rules.zones, pc.postcode);
  if (!zone) return { ok: false, reason: "outside_area", postcode: pc.postcode };
  const free = rules.freeOverPence !== null && subtotalPence >= rules.freeOverPence;
  return {
    ok: true,
    postcode: pc.postcode,
    zone: zone.name,
    feePence: free ? 0 : zone.feePence,
    zoneFeePence: zone.feePence,
    minOrderPence: rules.minOrderPence,
    shortByPence: Math.max(0, rules.minOrderPence - subtotalPence),
  };
}

/**
 * Placeholder zones for Hixon (ST18 0PP), until the shop sets its own:
 * the village itself, the neighbouring ST18 villages, and Stafford.
 */
export const MOCK_HIXON_ZONES: DeliveryZone[] = [
  { name: "Hixon", prefixes: ["ST18 0"], feePence: 150 },
  { name: "Nearby villages", prefixes: ["ST18"], feePence: 250 },
  { name: "Stafford", prefixes: ["ST16", "ST17"], feePence: 350 },
];
