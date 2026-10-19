/**
 * The order being taken on one call: collection or delivery, who it is for,
 * and what is in it. Held in memory for the length of the call and written to
 * the database once the caller has heard it read back and said it's right.
 *
 * That rule is enforced here, not left to the prompt. A model told "read the
 * order back before placing it" will usually do so, and now and then will
 * place it in the same breath. So:
 *
 * - every change to the order bumps `version`;
 * - confirm_order records the version it read back and the caller turn it
 *   was in;
 * - placing is refused unless the order is unchanged since that read-back
 *   AND the caller has spoken since (their "yes").
 *
 * A change after the order has gone to the kitchen ("oh, and some chips")
 * goes through the same read-back, then updates the order already placed
 * instead of making a second one.
 */

import type { MenuEntry } from "@/lib/menu";
import { formatPence, spokenNumber, spokenPrice } from "@/lib/money";

export type OrderType = "collection" | "delivery";

export interface DraftCustomer {
  name: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  postcode: string | null;
  deliveryNotes: string | null;
}

export interface DraftLine {
  item: MenuEntry;
  quantity: number;
  notes: string | null;
}

export const MAX_QUANTITY = 20;
export const MAX_LINES = 40;

export class OrderDraft {
  type: OrderType | null = null;
  customer: DraftCustomer = {
    name: null,
    phone: null,
    addressLine1: null,
    addressLine2: null,
    town: null,
    postcode: null,
    deliveryNotes: null,
  };
  lines: DraftLine[] = [];
  notes: string | null = null;
  /** Delivery charge for the address given, once it has been quoted. */
  deliveryFeePence = 0;

  version = 0;
  placed: { orderId: string; number: number } | null = null;
  /** The version that went to the kitchen. */
  private placedVersion: number | null = null;
  /** "Would you like any rice or chips?" has been asked: once a call is enough. */
  carbsOffered = false;
  /** The version read back with "is that correct?", and the caller turn it was asked in. */
  private confirmation: { version: number; turn: number } | null = null;

  private touch() {
    this.version++;
  }

  setType(type: OrderType) {
    if (this.type !== type) {
      this.type = type;
      if (type === "collection") this.deliveryFeePence = 0;
      this.touch();
    }
  }

  setCustomer(patch: Partial<DraftCustomer>) {
    let changed = false;
    for (const [k, v] of Object.entries(patch) as Array<[keyof DraftCustomer, string | null | undefined]>) {
      if (v === undefined) continue;
      const value = typeof v === "string" ? v.trim() || null : null;
      if (this.customer[k] !== value) {
        this.customer[k] = value;
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  setNotes(notes: string | null) {
    const value = notes?.trim() || null;
    if (this.notes !== value) {
      this.notes = value;
      this.touch();
    }
  }

  setDeliveryFee(pence: number) {
    if (this.deliveryFeePence !== pence) {
      this.deliveryFeePence = pence;
      this.touch();
    }
  }

  /**
   * Add a dish. The same dish with the same notes joins its existing line
   * ("and another 65") rather than making a second one.
   */
  addItem(item: MenuEntry, quantity: number, notes: string | null): { line: number; quantity: number } {
    const n = clampQuantity(quantity);
    const note = notes?.trim() || null;
    const existing = this.lines.findIndex((l) => l.item.id === item.id && l.notes === note);
    if (existing >= 0) {
      const line = this.lines[existing];
      line.quantity = Math.min(MAX_QUANTITY, line.quantity + n);
      this.touch();
      return { line: existing + 1, quantity: line.quantity };
    }
    if (this.lines.length >= MAX_LINES) throw new Error("That's more dishes than one phone order can take.");
    this.lines.push({ item, quantity: n, notes: note });
    this.touch();
    return { line: this.lines.length, quantity: n };
  }

  /** Change a line by its number (1-based); quantity 0 takes it off. */
  changeLine(line: number, change: { quantity?: number; notes?: string | null }): DraftLine | null {
    const i = line - 1;
    const current = this.lines[i];
    if (!current) return null;
    if (change.quantity !== undefined) {
      if (change.quantity <= 0) {
        this.lines.splice(i, 1);
        this.touch();
        return null;
      }
      current.quantity = clampQuantity(change.quantity);
    }
    if (change.notes !== undefined) current.notes = change.notes?.trim() || null;
    this.touch();
    return current;
  }

  get subtotalPence(): number {
    return this.lines.reduce((sum, l) => sum + l.item.pricePence * l.quantity, 0);
  }

  get totalPence(): number {
    return this.subtotalPence + (this.type === "delivery" ? this.deliveryFeePence : 0);
  }

  /** The order as a tool result shows it to the model. */
  summary() {
    return {
      type: this.type,
      lines: this.lines.map((l, i) => ({
        line: i + 1,
        quantity: l.quantity,
        code: l.item.code,
        name: l.item.name,
        ...(l.notes ? { notes: l.notes } : {}),
        lineTotal: formatPence(l.item.pricePence * l.quantity),
      })),
      foodTotal: formatPence(this.subtotalPence),
      ...(this.type === "delivery" ? { deliveryFee: formatPence(this.deliveryFeePence) } : {}),
      total: formatPence(this.totalPence),
      spokenTotal: spokenPrice(this.totalPence),
    };
  }

  /** What still stops the order being placed, in the order to ask about it. */
  missing(): string[] {
    const out: string[] = [];
    if (!this.type) out.push("whether it is for collection or delivery");
    if (!this.customer.name) out.push("the caller's name");
    if (this.type === "delivery") {
      if (!this.customer.addressLine1) out.push("the first line of the delivery address");
      if (!this.customer.postcode) out.push("the delivery postcode");
    }
    if (!this.customer.phone) out.push("a contact phone number");
    if (!this.lines.length) out.push("at least one dish");
    return out;
  }

  /** Something on the order is, or comes with, rice, chips or noodles. */
  get hasStaple(): boolean {
    return this.lines.some((l) => l.item.staple);
  }

  /** The order, as it stands, has gone to the kitchen as `number`. */
  markPlaced(orderId: string, number: number) {
    this.placed = { orderId, number };
    this.placedVersion = this.version;
  }

  /** Placed, and changed since: the kitchen's copy is out of date. */
  get needsSaving(): boolean {
    return this.placed !== null && this.placedVersion !== this.version;
  }

  /**
   * The dishes as the caller hears them confirmed: "one Chicken Chow Mein and
   * two Egg Fried Rice". Quantities in words, no prices.
   */
  static spokenDishes(lines: Array<{ quantity: number; name: string; notes?: string | null }>): string {
    return listing(lines.map((l) => `${spokenNumber(l.quantity)} ${l.name}${l.notes ? `, ${l.notes}` : ""}`));
  }

  /**
   * The read-back before placing, as a question: the dishes and how they are
   * reaching the caller, no prices. "So that's one Chicken Curry and one
   * Boiled Rice, for collection, is that correct?"
   */
  confirmationQuestion(): string {
    const how =
      this.type === "delivery"
        ? `for delivery to ${[this.customer.addressLine1, this.customer.addressLine2, this.customer.postcode].filter(Boolean).join(", ")}`
        : "for collection";
    return `So that's ${OrderDraft.spokenDishes(this.lines.map((l) => ({ quantity: l.quantity, name: l.item.name, notes: l.notes })))}, ${how}, is that correct?`;
  }

  /** The order, as it stands, has been read back during caller turn `turn`. */
  markConfirmationAsked(turn: number) {
    this.confirmation = { version: this.version, turn };
  }

  /** Why the order can't be placed yet, or null when it can. */
  placeRefusal(turn: number): string | null {
    if (!this.confirmation || this.confirmation.version !== this.version) {
      return "Not placed: the order hasn't been read back as it now stands. Use confirm_order, ask if it's correct, and wait for them to say yes.";
    }
    if (turn <= this.confirmation.turn) {
      return "Not placed: wait for the caller to say the order is correct before placing it.";
    }
    return null;
  }

  /**
   * Said once the order has gone to the kitchen: the money and how long.
   * Prices in words, so the voice never says "pound sign". No goodbye: the
   * caller may have something more to say.
   */
  priceAndTime(readyInMinutes: number): string {
    const money =
      this.type === "delivery" && this.deliveryFeePence > 0
        ? `That's ${spokenPrice(this.totalPence)} including ${spokenPrice(this.deliveryFeePence)} delivery, cash on delivery.`
        : `That's ${spokenPrice(this.totalPence)}, cash on ${this.type === "delivery" ? "delivery" : "collection"}.`;
    const when =
      this.type === "delivery"
        ? `It'll be with you in about ${readyInMinutes} minutes.`
        : `It'll be ready to collect in about ${readyInMinutes} minutes.`;
    return `${money} ${when}`;
  }
}

function clampQuantity(q: number): number {
  if (!Number.isFinite(q)) return 1;
  return Math.max(1, Math.min(MAX_QUANTITY, Math.round(q)));
}

/** "a, b and c" */
function listing(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
