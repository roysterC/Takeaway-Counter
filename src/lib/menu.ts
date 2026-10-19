/**
 * The menu as the receptionist and the order code see it, and the matching
 * that turns "two number sixty-fives" or "a chicken chow mein" into a line on
 * the order.
 *
 * The model is shown the whole menu with its numbers and asked to order by
 * number, so most look-ups are exact. Name matching is the fallback for when
 * it passes a name, and it refuses to guess: anything short of one clear
 * match goes back to the model as a list to ask the caller about.
 */

import { formatPence, spokenPrice } from "@/lib/money";

export interface MenuEntry {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  pricePence: number;
  available: boolean;
  aliases: string[];
  category: string;
  /** Rice, chips or noodles, or comes with them: see isStapleByDefault. */
  staple: boolean;
}

export interface MenuSection {
  name: string;
  note: string | null;
  items: MenuEntry[];
}

/** Lower case, "&" as "and", punctuation and brackets gone, single spaces. */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that carry no meaning for telling dishes apart. */
const FILLER = new Set(["a", "an", "the", "with", "in", "and", "of", "number", "no", "please", "portion", "some"]);

function words(s: string): string[] {
  return normaliseName(s)
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .map(singular);
}

/** "noodles" and "noodle", "ribs" and "rib", "chips" and "chip" match. */
function singular(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** "number 65a", "no. 65A", "#65a", "65 a" -> "65a". Null if it is not a code. */
export function normaliseCode(s: string): string | null {
  const t = s.toLowerCase().replace(/^(number|num|no\.?|#)\s*/, "").replace(/\s+/g, "");
  return /^[a-z]?\d{1,3}[a-z]?$|^[a-z]\d?$/.test(t) ? t : null;
}

export type MenuMatch =
  | { kind: "found"; item: MenuEntry }
  | { kind: "choose"; options: MenuEntry[] }
  | { kind: "none" };

/**
 * Find one menu item from a code and/or a name.
 *
 * A code that names exactly one item wins, unless a name given with it
 * clearly means a different dish. A code shared by more than one
 * (22: quarter or half duck; 89: chicken or beef) is narrowed by the name if
 * one was given, otherwise the choices go back. A name is matched exactly
 * first, then by every word of it appearing in the item's name or aliases.
 */
export function findMenuItem(menu: MenuEntry[], query: { code?: string | null; name?: string | null }): MenuMatch {
  const code = query.code ? normaliseCode(query.code) : null;
  const name = query.name?.trim() || null;

  if (code) {
    const byCode = menu.filter((m) => m.code && m.code.toLowerCase() === code);
    if (byCode.length === 1) {
      // A number and a name that point at different dishes ("146, chicken
      // chow mein": 146 is king prawn) is a mishearing on one side or the
      // other. Ask, rather than let the number win and send the wrong dish.
      if (name) {
        const byName = matchByName(menu, name);
        if (byName.length && !byName.includes(byCode[0])) {
          return { kind: "choose", options: [byCode[0], ...byName.slice(0, 3)] };
        }
      }
      return { kind: "found", item: byCode[0] };
    }
    if (byCode.length > 1) {
      if (name) {
        const narrowed = matchByName(byCode, name);
        if (narrowed.length === 1) return { kind: "found", item: narrowed[0] };
      }
      return { kind: "choose", options: byCode };
    }
  }

  if (name) {
    // A number said as the name: "sixty-five" never reaches here (the model
    // converts it), but "65a" sometimes does.
    const asCode = normaliseCode(name);
    if (asCode && !code) return findMenuItem(menu, { code: asCode });
    const found = matchByName(menu, name);
    if (found.length === 1) return { kind: "found", item: found[0] };
    if (found.length > 1) return { kind: "choose", options: found.slice(0, 6) };
  }
  return { kind: "none" };
}

function matchByName(menu: MenuEntry[], name: string): MenuEntry[] {
  const target = normaliseName(name);
  const exact = menu.filter(
    (m) => normaliseName(m.name) === target || m.aliases.some((a) => normaliseName(a) === target)
  );
  if (exact.length) return exact;

  const want = words(name);
  if (!want.length) return [];
  const scored = menu
    .map((m) => {
      const have = new Set([...words(m.name), ...m.aliases.flatMap(words)]);
      const hits = want.filter((w) => have.has(w)).length;
      // Every word asked for must be there; fewer extra words is a closer match.
      return { m, ok: hits === want.length, extra: have.size - hits };
    })
    .filter((s) => s.ok)
    .sort((a, b) => a.extra - b.extra);
  if (!scored.length) return [];
  // One item that matches with nothing left over ("chicken chow mein") is
  // the dish asked for, even though "house special chicken chow mein"
  // contains the same words.
  if (scored[0].extra === 0 && (scored.length === 1 || scored[1].extra > 0)) return [scored[0].m];
  return scored.map((s) => s.m);
}

/**
 * Whether a dish is, or comes with, rice, chips or noodles, when the owner
 * hasn't said either way. By name: anything with rice, chips, noodles, chow
 * mein or vermicelli in it, and a "3 in 1" (chips, rice and curry sauce).
 * By section: fried rice and chow mein sections, omelettes (which come with
 * chips) and set menus (which come with rice). Soups don't count, even
 * chicken and noodle: nobody has that instead of rice.
 */
export function isStapleByDefault(name: string, category: string): boolean {
  if (/\bsoup\b/i.test(name)) return false;
  if (/\b(rice|chips?|noodles?|chow mein|vermicelli|3 in 1)\b/i.test(name)) return true;
  return /fried rice|chow mein|omelette|set men/i.test(category);
}

/** "65a Roast Pork with Mushroom in Black Bean Sauce" */
export function itemLabel(item: Pick<MenuEntry, "code" | "name">): string {
  return item.code ? `${item.code} ${item.name}` : item.name;
}

/**
 * The menu as text for the receptionist's instructions: every section, its
 * note, and one line per dish with its number and price. Sold-out dishes are
 * listed as such rather than left out, so "sorry, that's sold out tonight"
 * is what a caller hears instead of "we don't do that".
 */
export function menuForPrompt(sections: MenuSection[]): string {
  const out: string[] = [];
  for (const s of sections) {
    out.push(`## ${s.name}`);
    if (s.note) out.push(`(${s.note})`);
    for (const i of s.items) {
      const parts = [`- ${itemLabel(i)}: ${formatPence(i.pricePence)}`];
      if (i.description) parts.push(` (${i.description})`);
      if (!i.available) parts.push(" SOLD OUT TONIGHT");
      out.push(parts.join(""));
    }
    out.push("");
  }
  return out.join("\n").trim();
}

/** For a tool result: what the model needs to say, and nothing it might read out wrongly. */
export function itemForTool(item: MenuEntry) {
  return {
    code: item.code,
    name: item.name,
    price: formatPence(item.pricePence),
    spokenPrice: spokenPrice(item.pricePence),
    ...(item.available ? {} : { soldOut: true }),
  };
}
