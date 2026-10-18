/**
 * The menu, by section.
 *
 *   GET                                       every section and dish (staff too: the counter's order form reads it)
 *   POST { kind: "category", name, note? }    a new section (owner)
 *   POST { kind: "item", categoryId, code?, name, price, description? }   a new dish (owner)
 *
 * The receptionist reads the menu when a call starts, so a change here is on
 * the next call.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { menuItemInput } from "@/lib/menu-input";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const categories = await prisma.menuCategory.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { items: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return NextResponse.json({
    sections: categories.map((c) => ({
      id: c.id,
      name: c.name,
      note: c.note,
      sortOrder: c.sortOrder,
      items: c.items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        description: i.description,
        pricePence: i.pricePence,
        available: i.available,
        aliases: i.aliases,
        categoryId: c.id,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (body.kind === "category") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A section needs a name." }, { status: 400 });
    const last = await prisma.menuCategory.aggregate({ where: { organizationId: ctx.organizationId }, _max: { sortOrder: true } });
    const category = await prisma.menuCategory.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        note: typeof body.note === "string" ? body.note.trim() || null : null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return NextResponse.json({ id: category.id }, { status: 201 });
  }

  if (body.kind === "item") {
    const category =
      typeof body.categoryId === "string"
        ? await prisma.menuCategory.findFirst({ where: { id: body.categoryId, organizationId: ctx.organizationId }, select: { id: true } })
        : null;
    if (!category) return NextResponse.json({ error: "Choose a section for the dish." }, { status: 400 });
    const parsed = menuItemInput(body, { creating: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const last = await prisma.menuItem.aggregate({ where: { categoryId: category.id }, _max: { sortOrder: true } });
    const item = await prisma.menuItem.create({
      data: {
        organizationId: ctx.organizationId,
        categoryId: category.id,
        name: parsed.data.name!,
        pricePence: parsed.data.pricePence!,
        code: parsed.data.code ?? null,
        description: parsed.data.description ?? null,
        aliases: parsed.data.aliases ?? [],
        available: parsed.data.available ?? true,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return NextResponse.json({ id: item.id }, { status: 201 });
  }

  return NextResponse.json({ error: "Say whether it's a section or a dish." }, { status: 400 });
}
