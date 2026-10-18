/**
 * The shop's customers: everyone who has ordered with a number, plus anyone
 * added by hand.
 *
 *   GET ?q=   search name, phone, street or postcode; newest order first
 *   POST { name, phone, addressLine1, ... }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { customerInput } from "@/lib/customer-input";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const where: Prisma.CustomerWhereInput = { organizationId: ctx.organizationId };
  if (q) {
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { addressLine1: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q.replace(/\s+/g, " "), mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    take: 300,
    orderBy: { updatedAt: "desc" },
    include: { orders: { where: { status: { not: "cancelled" } }, select: { totalPence: true, createdAt: true } } },
  });

  const rows = customers
    .map((c) => {
      const last = c.orders.reduce<Date | null>((m, o) => (!m || o.createdAt > m ? o.createdAt : m), null);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: [c.addressLine1, c.addressLine2, c.town, c.postcode].filter(Boolean).join(", ") || null,
        postcode: c.postcode,
        orders: c.orders.length,
        spentPence: c.orders.reduce((s, o) => s + o.totalPence, 0),
        lastOrderAt: last?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      };
    })
    .sort((a, b) => (b.lastOrderAt ?? b.createdAt).localeCompare(a.lastOrderAt ?? a.createdAt));

  return NextResponse.json({ customers: rows });
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const parsed = customerInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.data.name) return NextResponse.json({ error: "A customer needs a name." }, { status: 400 });
  if (parsed.data.phone) {
    const clash = await prisma.customer.findUnique({
      where: { organizationId_phone: { organizationId: ctx.organizationId, phone: parsed.data.phone } },
      select: { id: true, name: true },
    });
    if (clash) return NextResponse.json({ error: `${clash.name ?? "Another customer"} already has that number.`, id: clash.id }, { status: 409 });
  }
  const customer = await prisma.customer.create({ data: { organizationId: ctx.organizationId, ...parsed.data } });
  return NextResponse.json({ id: customer.id }, { status: 201 });
}
