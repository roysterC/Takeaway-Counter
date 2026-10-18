/**
 * Orders, for the counter.
 *
 *   GET ?view=live                     everything still in the kitchen or on the road, plus tonight's figures
 *   GET ?view=history&date=YYYY-MM-DD  one day's orders (the shop's day), &q= to search name, phone or number
 *   POST { type, customer, lines, notes }   an order taken at the counter or on the shop's own phone
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { ACTIVE_STATUSES, placeOrder, type PlaceOrderInput } from "@/lib/orders";
import { ORDER_INCLUDE, orderView } from "@/lib/order-view";
import { getShopConfig } from "@/lib/shop";
import { openStatus, shopDayRange, shopToday, spokenNextOpen, spokenTime } from "@/lib/hours";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  const shop = await getShopConfig(ctx.organizationId);
  const view = req.nextUrl.searchParams.get("view") ?? "live";
  const now = new Date();
  const today = shopDayRange(shopToday(now, shop.timeZone), shop.timeZone)!;

  if (view === "history") {
    const date = req.nextUrl.searchParams.get("date") || shopToday(now, shop.timeZone);
    const range = shopDayRange(date, shop.timeZone);
    if (!range) return NextResponse.json({ error: "That isn't a date." }, { status: 400 });
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const where: Prisma.OrderWhereInput = {
      organizationId: ctx.organizationId,
      createdAt: { gte: range.start, lt: range.end },
    };
    if (q) {
      const digits = q.replace(/\D/g, "");
      where.OR = [
        { customerName: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ customerPhone: { contains: digits.replace(/^0/, "") } }] : []),
        ...(/^\d{1,6}$/.test(q) ? [{ number: Number(q) }] : []),
      ];
    }
    const orders = await prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: "desc" }, take: 500 });
    const counted = orders.filter((o) => o.status !== "cancelled");
    return NextResponse.json({
      date,
      orders: orders.map(orderView),
      totals: {
        orders: counted.length,
        takingsPence: counted.reduce((s, o) => s + o.totalPence, 0),
        deliveries: counted.filter((o) => o.type === "delivery").length,
        collections: counted.filter((o) => o.type === "collection").length,
      },
    });
  }

  const [orders, tonight] = await Promise.all([
    prisma.order.findMany({
      where: { organizationId: ctx.organizationId, status: { in: ACTIVE_STATUSES } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.order.findMany({
      where: {
        organizationId: ctx.organizationId,
        createdAt: { gte: today.start, lt: today.end },
        status: { not: "cancelled" },
        source: { not: "lab" },
      },
      select: { totalPence: true, source: true },
    }),
  ]);
  const status = openStatus(shop.hours, shop.timeZone, now);
  return NextResponse.json({
    orders: orders.map(orderView),
    tonight: {
      orders: tonight.length,
      takingsPence: tonight.reduce((s, o) => s + o.totalPence, 0),
      byPhone: tonight.filter((o) => o.source === "phone").length,
    },
    shop: {
      acceptingOrders: shop.acceptingOrders,
      voiceEnabled: shop.voiceEnabled,
      collectionMinutes: shop.collectionMinutes,
      deliveryMinutes: shop.deliveryMinutes,
      open: status.open,
      hoursNote: status.open ? `Open until ${spokenTime(status.closes)}` : `Closed${spokenNextOpen(status) ? `, opens ${spokenNextOpen(status)}` : ""}`,
    },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  const body = ((await req.json().catch(() => null)) ?? {}) as Partial<PlaceOrderInput>;
  if (body.type !== "collection" && body.type !== "delivery") {
    return NextResponse.json({ error: "Choose collection or delivery." }, { status: 400 });
  }
  if (!body.customer || typeof body.customer.name !== "string") {
    return NextResponse.json({ error: "The order needs a name." }, { status: 400 });
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const result = await placeOrder(ctx.organizationId, {
    type: body.type,
    source: "counter",
    customer: {
      name: body.customer.name,
      phone: str(body.customer.phone),
      addressLine1: str(body.customer.addressLine1),
      addressLine2: str(body.customer.addressLine2),
      town: str(body.customer.town),
      postcode: str(body.customer.postcode),
      deliveryNotes: str(body.customer.deliveryNotes),
    },
    lines: lines
      .filter((l) => l && typeof l.menuItemId === "string" && typeof l.quantity === "number")
      .map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, notes: str(l.notes) })),
    notes: str(body.notes),
  });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 400 });
  return NextResponse.json({ order: result.order }, { status: 201 });
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
