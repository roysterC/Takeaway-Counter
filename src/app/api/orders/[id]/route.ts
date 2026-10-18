/**
 * One order: read it, or move it along (cooking, ready, out, done) or cancel it.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders";
import { ORDER_INCLUDE, orderView } from "@/lib/order-view";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const order = await prisma.order.findFirst({ where: { id, organizationId: ctx.organizationId }, include: ORDER_INCLUDE });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order: orderView(order) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as { status?: unknown };
  if (!ORDER_STATUSES.includes(body.status as OrderStatus)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }
  const status = body.status as OrderStatus;
  const existing = await prisma.order.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, type: true } });
  if (!existing) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (status === "out_for_delivery" && existing.type !== "delivery") {
    return NextResponse.json({ error: "A collection doesn't go out for delivery." }, { status: 400 });
  }
  const now = new Date();
  const order = await prisma.order.update({
    where: { id },
    data: {
      status,
      completedAt: status === "completed" ? now : null,
      cancelledAt: status === "cancelled" ? now : null,
    },
    include: ORDER_INCLUDE,
  });
  return NextResponse.json({ order: orderView(order) });
}
