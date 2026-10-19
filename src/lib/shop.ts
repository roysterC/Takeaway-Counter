/**
 * A shop's settings and menu, read and validated in one place, for the
 * receptionist, the order code and the CRM alike.
 */

import { prisma } from "@/lib/prisma";
import { parseOpeningHours, type DayHours } from "@/lib/hours";
import { parseZones, type DeliveryRules } from "@/lib/delivery";
import { isStapleByDefault, type MenuEntry, type MenuSection } from "@/lib/menu";

export interface ShopConfig {
  organizationId: string;
  businessName: string;
  greeting: string | null;
  voiceEnabled: boolean;
  acceptingOrders: boolean;
  timeZone: string;
  contactPhone: string | null;
  address: string | null;
  hours: DayHours[];
  notes: string | null;
  collectionMinutes: number;
  deliveryMinutes: number;
  delivery: DeliveryRules;
}

export async function getShopConfig(organizationId: string): Promise<ShopConfig> {
  const s = await prisma.organizationSettings.findUnique({ where: { organizationId } });
  const org = s ? null : await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return {
    organizationId,
    businessName: s?.businessName || org?.name || "the takeaway",
    greeting: s?.greeting?.trim() || null,
    voiceEnabled: s?.voiceEnabled ?? false,
    acceptingOrders: s?.acceptingOrders ?? true,
    timeZone: s?.timezone || "Europe/London",
    contactPhone: s?.contactPhone ?? null,
    address: s?.address ?? null,
    hours: parseOpeningHours(s?.openingHours),
    notes: s?.receptionistNotes ?? null,
    collectionMinutes: s?.collectionMinutes ?? 20,
    deliveryMinutes: s?.deliveryMinutes ?? 45,
    delivery: {
      enabled: s?.deliveryEnabled ?? false,
      zones: parseZones(s?.deliveryZones),
      minOrderPence: s?.minDeliveryPence ?? 0,
      freeOverPence: s?.freeDeliveryOverPence ?? null,
    },
  };
}

export async function getMenu(organizationId: string): Promise<MenuSection[]> {
  const categories = await prisma.menuCategory.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { items: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return categories.map((c) => ({
    name: c.name,
    note: c.note,
    items: c.items.map(
      (i): MenuEntry => ({
        id: i.id,
        code: i.code,
        name: i.name,
        description: i.description,
        pricePence: i.pricePence,
        available: i.available,
        aliases: i.aliases,
        staple: i.staple ?? isStapleByDefault(i.name, c.name),
        category: c.name,
      })
    ),
  }));
}
