/** Mark a caller's message dealt with, or not. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as { handled?: unknown };
  if (typeof body.handled !== "boolean") return NextResponse.json({ error: "handled must be true or false" }, { status: 400 });
  const result = await prisma.message.updateMany({
    where: { id, organizationId: ctx.organizationId },
    data: { handled: body.handled },
  });
  if (!result.count) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
