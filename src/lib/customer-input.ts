/**
 * A customer's details as the CRM's form sends them, checked and tidied:
 * the phone to E.164, the postcode to its standard form. Only the fields
 * present are returned, so an edit touches only what was changed.
 */

import { normalisePhone } from "@/lib/phone";
import { normalisePostcode } from "@/lib/delivery";

const TEXT_FIELDS = ["name", "addressLine1", "addressLine2", "town", "deliveryNotes", "notes"] as const;

export interface CustomerFields {
  name?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  postcode?: string | null;
  deliveryNotes?: string | null;
  notes?: string | null;
}

export function customerInput(raw: unknown): { ok: true; data: CustomerFields } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing was sent." };
  const body = raw as Record<string, unknown>;
  const data: CustomerFields = {};
  for (const key of TEXT_FIELDS) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== "string") return { ok: false, error: `${key} must be text.` };
    const v = (body[key] as string | null)?.trim() || null;
    if (v && v.length > 500) return { ok: false, error: `${key} is too long.` };
    data[key] = v;
  }
  if (body.phone !== undefined) {
    const raw = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!raw) data.phone = null;
    else {
      const parsed = normalisePhone(raw);
      if (!parsed.ok) return { ok: false, error: `Phone: ${parsed.reason}` };
      data.phone = parsed.e164;
    }
  }
  if (body.postcode !== undefined) {
    const raw = typeof body.postcode === "string" ? body.postcode.trim() : "";
    if (!raw) data.postcode = null;
    else {
      const pc = normalisePostcode(raw);
      if (!pc) return { ok: false, error: "That isn't a UK postcode." };
      data.postcode = pc.postcode;
    }
  }
  return { ok: true, data };
}
