import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** For an uptime monitor: the app is up and can reach its database. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
