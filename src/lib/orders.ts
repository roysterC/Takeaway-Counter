/**
 * Placing an order, for the phone receptionist and the counter alike, and
 * correcting one the receptionist placed moments ago on the same call.
 *
 * Everything the caller was told is checked again here against the database
 * as it is now: prices come from the menu, not from what the call had in
 * memory; a dish sold out since the call started is refused; the delivery
 * fee is re-quoted. The order number is taken in the same transaction as the
 * order, so two orders saved at once never share one.
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import { openStatus, spokenNextOpen } from "@/lib/hours";
import { normalisePostcode, quoteDelivery } from "@/lib/delivery";
import { formatPence } from "@/lib/money";
import { getShopConfig } from "@/lib/shop";

export * from "@/lib/order-status";
import type { OrderSource } from "@/lib/order-status";

export interface PlaceOrderInput {
  type: "collection" | "delivery";
  source: OrderSource;
  customer: {
    name: string;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    town?: string | null;
    postcode?: string | null;
    deliveryNotes?: string | null;
  };
  lines: Array<{ menuItemId: string; quantity: number; notes?: string | null }>;
  notes?: string | null;
}

export type PlaceOrderResult =
  | {
      ok: true;
      order: { id: string; number: number; totalPence: number; deliveryFeePence: number; promisedAt: Date; readyInMinutes: number };
    }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): { ok: false; code: string; message: string } => ({ ok: false, code, message });

type Shop = Awaited<ReturnType<typeof getShopConfig>>;

/**
 * An order checked against the database as it is now and priced from it:
 * what both placing and correcting an order write. Everything that can be
 * wrong with an order is found here, before anything is written.
 */
async function prepareOrder(organizationId: string, shop: Shop, input: PlaceOrderInput) {
  const name = input.customer.name?.trim();
  if (!name) return fail("no_name", "The order needs a name.");
  if (!input.lines.length) return fail("empty", "The order has nothing in it.");

  let phone: string | null = null;
  if (input.customer.phone?.trim()) {
    const parsed = normalisePhone(input.customer.phone);
    if (!parsed.ok) return fail("bad_phone", `That phone number won't work: ${parsed.reason}`);
    phone = parsed.e164;
  }
  if (!phone && input.source !== "counter") return fail("no_phone", "A phone order needs a contact number.");

  const ids = [...new Set(input.lines.map((l) => l.menuItemId))];
  const items = await prisma.menuItem.findMany({ where: { id: { in: ids }, organizationId } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines: Array<{
    menuItemId: string;
    code: string | null;
    name: string;
    unitPricePence: number;
    quantity: number;
    notes: string | null;
    sortOrder: number;
  }> = [];
  for (const [i, l] of input.lines.entries()) {
    const item = byId.get(l.menuItemId);
    if (!item) return fail("unknown_item", "Something on the order is no longer on the menu.");
    if (!item.available) return fail("sold_out", `${item.name} has just sold out.`);
    const quantity = Math.round(l.quantity);
    if (!(quantity >= 1 && quantity <= 50)) return fail("bad_quantity", `Check the quantity of ${item.name}.`);
    lines.push({
      menuItemId: item.id,
      code: item.code,
      name: item.name,
      unitPricePence: item.pricePence,
      quantity,
      notes: l.notes?.trim() || null,
      sortOrder: i,
    });
  }
  const subtotalPence = lines.reduce((s, l) => s + l.unitPricePence * l.quantity, 0);

  let deliveryFeePence = 0;
  let postcode: string | null = null;
  if (input.type === "delivery") {
    const line1 = input.customer.addressLine1?.trim();
    if (!line1) return fail("no_address", "A delivery needs the first line of the address.");
    const pc = normalisePostcode(input.customer.postcode);
    if (!pc?.full) return fail("bad_postcode", "A delivery needs the full postcode.");
    const quote = quoteDelivery(shop.delivery, pc.postcode, subtotalPence);
    if (!quote.ok) {
      return quote.reason === "disabled"
        ? fail("no_delivery", "The shop is not delivering at the moment.")
        : fail("outside_area", `The shop doesn't deliver to ${pc.postcode}.`);
    }
    if (quote.shortByPence > 0 && input.source !== "counter") {
      return fail(
        "below_minimum",
        `Delivery needs at least ${formatPence(quote.minOrderPence)} of food; this order is ${formatPence(quote.shortByPence)} short.`
      );
    }
    deliveryFeePence = quote.feePence;
    postcode = quote.postcode;
  }

  const address = input.type === "delivery"
    ? {
        addressLine1: input.customer.addressLine1?.trim() || null,
        addressLine2: input.customer.addressLine2?.trim() || null,
        town: input.customer.town?.trim() || null,
        postcode,
        deliveryNotes: input.customer.deliveryNotes?.trim() || null,
      }
    : null;

  return {
    ok: true as const,
    name,
    phone,
    address,
    lines,
    subtotalPence,
    deliveryFeePence,
    readyInMinutes: input.type === "delivery" ? shop.deliveryMinutes : shop.collectionMinutes,
  };
}

export async function placeOrder(
  organizationId: string,
  input: PlaceOrderInput,
  opts: { now?: Date; ignoreHours?: boolean } = {}
): Promise<PlaceOrderResult> {
  const now = opts.now ?? new Date();
  const shop = await getShopConfig(organizationId);

  // The counter can always ring an order through; the phone obeys the hours
  // and the pause switch.
  if (input.source !== "counter" && !opts.ignoreHours) {
    if (!shop.acceptingOrders) return fail("paused", "The shop has paused phone orders for now.");
    const status = openStatus(shop.hours, shop.timeZone, now);
    if (!status.open) {
      const next = spokenNextOpen(status);
      return fail("closed", `The shop is closed${next ? `; it opens ${next}` : ""}.`);
    }
  }

  const ready = await prepareOrder(organizationId, shop, input);
  if (!ready.ok) return ready;
  const { name, phone, address, lines, subtotalPence, deliveryFeePence, readyInMinutes } = ready;
  const promisedAt = new Date(now.getTime() + readyInMinutes * 60_000);

  const order = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: organizationId },
      data: { nextOrderNumber: { increment: 1 } },
      select: { nextOrderNumber: true },
    });
    const number = org.nextOrderNumber - 1;

    // A regular is known by their number: the name and address they gave
    // tonight become the ones on file. A collection leaves the address alone.
    const customer = phone
      ? await tx.customer.upsert({
          where: { organizationId_phone: { organizationId, phone } },
          create: { organizationId, phone, name, ...(address ?? {}) },
          update: { name, ...(address ?? {}) },
          select: { id: true },
        })
      : null;

    return tx.order.create({
      data: {
        organizationId,
        number,
        type: input.type,
        source: input.source,
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: phone,
        ...(address ?? {}),
        notes: input.notes?.trim() || null,
        subtotalPence,
        deliveryFeePence,
        totalPence: subtotalPence + deliveryFeePence,
        promisedAt,
        createdAt: now,
        items: { create: lines },
      },
      select: { id: true, number: true, totalPence: true },
    });
  });

  return { ok: true, order: { ...order, deliveryFeePence, promisedAt, readyInMinutes } };
}

/**
 * Correct an order placed earlier on the same call: the caller heard the
 * read-back and said "no, I said two". Only while it is still New on the
 * board; once the kitchen has started it, a change is a message for the
 * staff. It keeps its number. Hours and the pause switch are not checked
 * again: the order was taken while the shop was open.
 */
export async function amendOrder(
  organizationId: string,
  orderId: string,
  input: PlaceOrderInput,
  opts: { now?: Date } = {}
): Promise<PlaceOrderResult> {
  const shop = await getShopConfig(organizationId);
  const existing = await prisma.order.findFirst({
    where: { id: orderId, organizationId },
    select: { status: true, type: true, createdAt: true, promisedAt: true },
  });
  if (!existing) return fail("not_found", "That order can't be found.");
  if (existing.status !== "new") {
    return fail("started", "The kitchen has already started that order, so it can't be changed from here.");
  }

  const ready = await prepareOrder(organizationId, shop, input);
  if (!ready.ok) return ready;
  const { name, phone, address, lines, subtotalPence, deliveryFeePence, readyInMinutes } = ready;
  // Same promise as before, unless it has gone from collection to delivery or back.
  const promisedAt =
    existing.type === input.type && existing.promisedAt
      ? existing.promisedAt
      : new Date(Math.max(existing.createdAt.getTime(), (opts.now ?? new Date()).getTime()) + readyInMinutes * 60_000);

  const order = await prisma.$transaction(async (tx) => {
    const customer = phone
      ? await tx.customer.upsert({
          where: { organizationId_phone: { organizationId, phone } },
          create: { organizationId, phone, name, ...(address ?? {}) },
          update: { name, ...(address ?? {}) },
          select: { id: true },
        })
      : null;
    await tx.orderItem.deleteMany({ where: { orderId } });
    return tx.order.update({
      where: { id: orderId },
      data: {
        type: input.type,
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: phone,
        addressLine1: address?.addressLine1 ?? null,
        addressLine2: address?.addressLine2 ?? null,
        town: address?.town ?? null,
        postcode: address?.postcode ?? null,
        deliveryNotes: address?.deliveryNotes ?? null,
        notes: input.notes?.trim() || null,
        subtotalPence,
        deliveryFeePence,
        totalPence: subtotalPence + deliveryFeePence,
        promisedAt,
        items: { create: lines },
      },
      select: { id: true, number: true, totalPence: true },
    });
  });

  const minutesLeft = Math.max(1, Math.round((promisedAt.getTime() - (opts.now ?? new Date()).getTime()) / 60_000));
  return { ok: true, order: { ...order, deliveryFeePence, promisedAt, readyInMinutes: minutesLeft } };
}

/** A caller's orders from the last twelve hours, newest first: "where's my food?" */
export async function recentOrdersFor(organizationId: string, phone: string, now = new Date()) {
  return prisma.order.findMany({
    where: { organizationId, customerPhone: phone, createdAt: { gte: new Date(now.getTime() - 12 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, number: true, type: true, status: true, promisedAt: true, totalPence: true, createdAt: true },
  });
}
