/**
 * One customer: their details and every order they have placed.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { customerInput } from "@/lib/customer-input";
import { ORDER_INCLUDE, orderView } from "@/lib/order-view";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      orders: { include: ORDER_INCLUDE, orderBy: { createdAt: "desc" }, take: 100 },
      calls: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, outcomes: true, duration: true } },
    },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const counted = customer.orders.filter((o) => o.status !== "cancelled");
  // What they order most, for the counter to recognise a regular's usual.
  const favourites = new Map<string, number>();
  for (const o of counted) for (const i of o.items) favourites.set(i.name, (favourites.get(i.name) ?? 0) + i.quantity);

  return NextResponse.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      town: customer.town,
      postcode: customer.postcode,
      deliveryNotes: customer.deliveryNotes,
      notes: customer.notes,
      createdAt: customer.createdAt.toISOString(),
    },
    stats: {
      orders: counted.length,
      spentPence: counted.reduce((s, o) => s + o.totalPence, 0),
      averagePence: counted.length ? Math.round(counted.reduce((s, o) => s + o.totalPence, 0) / counted.length) : 0,
      favourites: [...favourites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    },
    orders: customer.orders.map(orderView),
    calls: customer.calls.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const existing = await prisma.customer.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const parsed = customerInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.data.phone) {
    const clash = await prisma.customer.findFirst({
      where: { organizationId: ctx.organizationId, phone: parsed.data.phone, id: { not: id } },
      select: { name: true },
    });
    if (clash) return NextResponse.json({ error: `${clash.name ?? "Another customer"} already has that number.` }, { status: 409 });
  }
  await prisma.customer.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

/** The owner's only. Their past orders stay, with the name and address they were placed under. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const existing = await prisma.customer.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
