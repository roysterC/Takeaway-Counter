/**
 * One menu section: rename it, change its note, move it, or remove it with
 * its dishes. The owner's only.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const existing = await prisma.menuCategory.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data: { name?: string; note?: string | null; sortOrder?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A section needs a name." }, { status: 400 });
    data.name = name;
  }
  if (body.note !== undefined) data.note = typeof body.note === "string" ? body.note.trim() || null : null;
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder;
  await prisma.menuCategory.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const existing = await prisma.menuCategory.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  await prisma.menuCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
