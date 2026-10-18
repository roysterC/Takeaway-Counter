/**
 * One dish. Counter staff may mark it sold out or back on; changing what it
 * is or costs, or removing it, is the owner's.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { menuItemInput } from "@/lib/menu-input";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const onlyAvailability = Object.keys(body).every((k) => k === "available");
  const ctx = await requireTenant(req, { members: onlyAvailability });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.menuItem.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Dish not found" }, { status: 404 });

  const parsed = menuItemInput(body, { creating: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  let categoryId: string | undefined;
  if (typeof body.categoryId === "string") {
    const cat = await prisma.menuCategory.findFirst({ where: { id: body.categoryId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!cat) return NextResponse.json({ error: "That section doesn't exist." }, { status: 400 });
    categoryId = cat.id;
  }
  await prisma.menuItem.update({ where: { id }, data: { ...parsed.data, ...(categoryId ? { categoryId } : {}) } });
  return NextResponse.json({ ok: true });
}

/** Past orders keep their own copy of the dish's name and price. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const existing = await prisma.menuItem.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Dish not found" }, { status: 404 });
  await prisma.menuItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
