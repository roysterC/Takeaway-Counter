/**
 * A dish as the menu editor sends it, checked. Price arrives in pounds
 * ("7.60") from the form and is stored in pence.
 */

import { parsePounds } from "@/lib/money";

export interface MenuItemFields {
  code?: string | null;
  name?: string;
  description?: string | null;
  pricePence?: number;
  available?: boolean;
  aliases?: string[];
  /** Null: work it out from the name and section. */
  staple?: boolean | null;
}

export function menuItemInput(
  body: Record<string, unknown>,
  opts: { creating: boolean }
): { ok: true; data: MenuItemFields } | { ok: false; error: string } {
  const data: MenuItemFields = {};
  if (body.name !== undefined || opts.creating) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { ok: false, error: "A dish needs a name." };
    if (name.length > 120) return { ok: false, error: "That name is too long." };
    data.name = name;
  }
  if (body.price !== undefined || opts.creating) {
    const pence = typeof body.price === "number" ? Math.round(body.price * 100) : parsePounds(String(body.price ?? ""));
    if (pence === null || !Number.isFinite(pence) || pence < 0 || pence > 50000) {
      return { ok: false, error: "Enter a price like 7.60." };
    }
    data.pricePence = pence;
  }
  if (body.code !== undefined) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code.length > 8) return { ok: false, error: "Menu numbers are short, like 65a." };
    data.code = code || null;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.available !== undefined) {
    if (typeof body.available !== "boolean") return { ok: false, error: "Available is yes or no." };
    data.available = body.available;
  }
  if (body.staple !== undefined) {
    if (body.staple !== null && typeof body.staple !== "boolean") return { ok: false, error: "Rice, chips or noodles is yes, no or automatic." };
    data.staple = body.staple;
  }
  if (body.aliases !== undefined) {
    const list = Array.isArray(body.aliases)
      ? body.aliases
      : typeof body.aliases === "string"
        ? body.aliases.split(",")
        : [];
    data.aliases = list
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  return { ok: true, data };
}
