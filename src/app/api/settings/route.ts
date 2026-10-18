/**
 * The shop's setup: its name and greeting, hours, delivery rules, the notes
 * the receptionist answers questions from, and the phone line. The owner's
 * only. Hours and zones are validated on the way in because they decide
 * whether a caller can order and what they are charged.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { parseOpeningHours } from "@/lib/hours";
import { parseZones } from "@/lib/delivery";
import { normalisePhone } from "@/lib/phone";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const [s, numbers] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
    prisma.phoneNumber.findMany({ where: { organizationId: ctx.organizationId, active: true }, select: { number: true } }),
  ]);
  if (!s) return NextResponse.json({ error: "This shop has no settings yet. Run the seed script." }, { status: 404 });
  return NextResponse.json({
    businessName: s.businessName,
    greeting: s.greeting,
    voiceEnabled: s.voiceEnabled,
    acceptingOrders: s.acceptingOrders,
    contactPhone: s.contactPhone,
    address: s.address,
    openingHours: parseOpeningHours(s.openingHours),
    receptionistNotes: s.receptionistNotes,
    collectionMinutes: s.collectionMinutes,
    deliveryMinutes: s.deliveryMinutes,
    deliveryEnabled: s.deliveryEnabled,
    deliveryZones: parseZones(s.deliveryZones),
    minDeliveryPence: s.minDeliveryPence,
    freeDeliveryOverPence: s.freeDeliveryOverPence,
    phoneNumbers: numbers.map((n) => n.number),
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

  if (b.businessName !== undefined) {
    if (typeof b.businessName !== "string" || !b.businessName.trim()) return bad("The shop needs a name.");
    data.businessName = b.businessName.trim();
  }
  for (const key of ["greeting", "contactPhone", "address", "receptionistNotes"] as const) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && typeof b[key] !== "string") return bad(`${key} must be text.`);
    const v = (b[key] as string | null)?.trim() || null;
    if (v && v.length > 8000) return bad(`${key} is too long.`);
    data[key] = v;
  }
  for (const key of ["voiceEnabled", "acceptingOrders", "deliveryEnabled"] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "boolean") return bad(`${key} must be on or off.`);
    data[key] = b[key];
  }
  for (const key of ["collectionMinutes", "deliveryMinutes"] as const) {
    if (b[key] === undefined) continue;
    const n = b[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 5 || n > 180) return bad("Wait times are between 5 and 180 minutes.");
    data[key] = n;
  }
  if (b.minDeliveryPence !== undefined) {
    const n = b.minDeliveryPence;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 20000) return bad("Check the minimum delivery order.");
    data.minDeliveryPence = n;
  }
  if (b.freeDeliveryOverPence !== undefined) {
    const n = b.freeDeliveryOverPence;
    if (n !== null && (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 50000)) return bad("Check the free delivery amount.");
    data.freeDeliveryOverPence = n;
  }
  if (b.openingHours !== undefined) {
    if (!Array.isArray(b.openingHours)) return bad("Opening hours are a list of days.");
    data.openingHours = parseOpeningHours(b.openingHours);
  }
  if (b.deliveryZones !== undefined) {
    if (!Array.isArray(b.deliveryZones)) return bad("Delivery zones are a list.");
    const zones = parseZones(b.deliveryZones);
    if (zones.length !== b.deliveryZones.length) return bad("Each delivery zone needs a name, at least one postcode and a fee.");
    data.deliveryZones = zones;
  }

  if (b.phoneNumbers !== undefined) {
    if (!Array.isArray(b.phoneNumbers)) return bad("Phone numbers are a list.");
    const numbers: string[] = [];
    for (const raw of b.phoneNumbers) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const parsed = normalisePhone(raw);
      if (!parsed.ok) return bad(`${raw}: ${parsed.reason}`);
      numbers.push(parsed.e164);
    }
    const taken = await prisma.phoneNumber.findFirst({
      where: { number: { in: numbers }, organizationId: { not: ctx.organizationId } },
      select: { number: true },
    });
    if (taken) return bad(`${taken.number} belongs to another shop.`);
    await prisma.$transaction([
      prisma.phoneNumber.deleteMany({ where: { organizationId: ctx.organizationId, number: { notIn: numbers } } }),
      ...numbers.map((number) =>
        prisma.phoneNumber.upsert({
          where: { number },
          create: { organizationId: ctx.organizationId, number, label: "Shop line" },
          update: { active: true },
        })
      ),
    ]);
  }

  if (Object.keys(data).length) {
    await prisma.organizationSettings.update({ where: { organizationId: ctx.organizationId }, data });
  }
  return NextResponse.json({ ok: true });
}
