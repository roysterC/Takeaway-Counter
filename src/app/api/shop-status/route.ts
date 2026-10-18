/**
 * The switches the counter flips during service: pause phone orders, and turn
 * the quoted wait times up or down. Counter staff may use these; everything
 * else about the shop's setup is the owner's (Settings).
 *
 * The receptionist reads them fresh when it quotes and places an order, so a
 * change here applies to calls already in progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const data: { acceptingOrders?: boolean; collectionMinutes?: number; deliveryMinutes?: number } = {};
  if (typeof body.acceptingOrders === "boolean") data.acceptingOrders = body.acceptingOrders;
  for (const key of ["collectionMinutes", "deliveryMinutes"] as const) {
    if (body[key] === undefined) continue;
    const n = body[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 5 || n > 180) {
      return NextResponse.json({ error: "Wait times are between 5 and 180 minutes." }, { status: 400 });
    }
    data[key] = n;
  }
  const settings = await prisma.organizationSettings.update({
    where: { organizationId: ctx.organizationId },
    data,
    select: { acceptingOrders: true, collectionMinutes: true, deliveryMinutes: true },
  });
  return NextResponse.json(settings);
}
