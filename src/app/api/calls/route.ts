/**
 * The call log and the messages callers left, newest first.
 *
 *   GET ?messages=open   only messages not yet dealt with
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const openOnly = req.nextUrl.searchParams.get("messages") === "open";

  const [calls, messages] = await Promise.all([
    prisma.call.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, number: true, totalPence: true, type: true } },
      },
    }),
    prisma.message.findMany({
      where: { organizationId: ctx.organizationId, ...(openOnly ? { handled: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return NextResponse.json({
    calls: calls.map((c) => ({
      id: c.id,
      phoneNumber: c.phoneNumber,
      outcomes: c.outcomes,
      duration: c.duration,
      createdAt: c.createdAt.toISOString(),
      customer: c.customer,
      order: c.order,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      body: m.body,
      handled: m.handled,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
