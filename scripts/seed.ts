/**
 * Sets up Hixon Chinese: the organisation, its settings, its menu and an
 * owner login. Safe to run again: it only fills in what is missing, so it
 * never overwrites a menu or settings edited in the CRM.
 *
 *   npm run seed                 # shop, menu, owner login
 *   npm run seed -- --demo       # plus a few customers and tonight's orders, to see the screens
 *
 * Optional environment:
 *   SEED_ADMIN_EMAIL     owner login (default owner@hixonchinese.co.uk)
 *   SEED_ADMIN_PASSWORD  its password (default: generated and printed once)
 *   SEED_PHONE_NUMBER    the Twilio number callers ring, e.g. +441889000000
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { randomBytes } from "crypto";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { hashPassword } = await import("@/lib/password");
  const { HIXON_MENU, HIXON_NOTES } = await import("@/lib/menu-data/hixon");
  const { MOCK_HIXON_ZONES } = await import("@/lib/delivery");
  const { normalisePhone } = await import("@/lib/phone");

  const org = await prisma.organization.upsert({
    where: { slug: "hixon" },
    create: { slug: "hixon", name: "Hixon Chinese" },
    update: {},
  });
  console.log(`Organisation: ${org.name} (${org.id})`);

  const existingSettings = await prisma.organizationSettings.findUnique({ where: { organizationId: org.id } });
  if (!existingSettings) {
    await prisma.organizationSettings.create({
      data: {
        organizationId: org.id,
        businessName: "Hixon Chinese Takeaway",
        voiceEnabled: true,
        contactPhone: "01889 270870",
        address: "2A Smithy Lane, Hixon, Stafford, ST18 0PP",
        // Monday and Tuesday closed; Wednesday to Sunday 5pm to 9:30pm.
        openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          closed: day === 1 || day === 2,
          open: "17:00",
          close: "21:30",
        })),
        receptionistNotes: HIXON_NOTES,
        collectionMinutes: 20,
        deliveryMinutes: 45,
        deliveryEnabled: true,
        deliveryZones: MOCK_HIXON_ZONES as unknown as object,
        minDeliveryPence: 1500,
        freeDeliveryOverPence: null,
      },
    });
    console.log("Settings: created (delivery zones and fees are placeholders; change them in Settings)");
  } else {
    console.log("Settings: already there, left alone");
  }

  const categories = await prisma.menuCategory.count({ where: { organizationId: org.id } });
  if (categories === 0) {
    let items = 0;
    for (const [ci, cat] of HIXON_MENU.entries()) {
      await prisma.menuCategory.create({
        data: {
          organizationId: org.id,
          name: cat.name,
          note: cat.note ?? null,
          sortOrder: ci,
          items: {
            create: cat.items.map(([code, name, pounds, description], ii) => ({
              organizationId: org.id,
              code,
              name,
              pricePence: Math.round(pounds * 100),
              description: description ?? null,
              sortOrder: ii,
            })),
          },
        },
      });
      items += cat.items.length;
    }
    console.log(`Menu: ${HIXON_MENU.length} sections, ${items} dishes`);
  } else {
    console.log("Menu: already there, left alone");
  }

  const phoneRaw = process.env.SEED_PHONE_NUMBER?.trim();
  if (phoneRaw) {
    const parsed = normalisePhone(phoneRaw);
    if (!parsed.ok) throw new Error(`SEED_PHONE_NUMBER: ${parsed.reason}`);
    await prisma.phoneNumber.upsert({
      where: { number: parsed.e164 },
      create: { organizationId: org.id, number: parsed.e164, label: "Shop line" },
      update: { organizationId: org.id, active: true },
    });
    console.log(`Phone line: ${parsed.e164}`);
  }

  const email = (process.env.SEED_ADMIN_EMAIL || "owner@hixonchinese.co.uk").toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
    await prisma.user.create({
      data: { email, name: "Owner", role: "admin", organizationId: org.id, passwordHash: await hashPassword(password) },
    });
    console.log(`Owner login: ${email}${process.env.SEED_ADMIN_PASSWORD ? "" : ` / ${password}  (shown once; change it after signing in)`}`);
  } else {
    console.log(`Owner login: ${email} already exists`);
  }

  if (process.argv.includes("--demo")) await demo(org.id);
  await prisma.$disconnect();
}

/** A few regulars and tonight's orders, so the Orders and Customers screens have something on them. */
async function demo(organizationId: string) {
  const { prisma } = await import("@/lib/prisma");
  const { placeOrder } = await import("@/lib/orders");
  const items = await prisma.menuItem.findMany({ where: { organizationId } });
  const byCode = (code: string) => {
    const item = items.find((i) => i.code === code);
    if (!item) throw new Error(`No menu item ${code}`);
    return item.id;
  };
  const orders = [
    {
      type: "delivery" as const,
      customer: { name: "Sarah Mitchell", phone: "07700 900111", addressLine1: "14 Smithy Lane", town: "Hixon", postcode: "ST18 0PQ" },
      lines: [
        { menuItemId: byCode("147"), quantity: 2 },
        { menuItemId: byCode("94"), quantity: 1 },
        { menuItemId: byCode("170"), quantity: 2 },
        { menuItemId: byCode("173"), quantity: 1 },
      ],
    },
    {
      type: "collection" as const,
      customer: { name: "Dave Turner", phone: "07700 900222" },
      lines: [
        { menuItemId: byCode("65"), quantity: 1, notes: "no onions" },
        { menuItemId: byCode("162"), quantity: 1 },
        { menuItemId: byCode("172"), quantity: 1 },
      ],
    },
    {
      type: "delivery" as const,
      customer: { name: "Priya Shah", phone: "07700 900333", addressLine1: "3 Church Road", town: "Weston", postcode: "ST18 0HX", deliveryNotes: "Side door" },
      lines: [{ menuItemId: byCode("B"), quantity: 1 }],
      notes: "Nut allergy: please take care",
    },
  ];
  for (const o of orders) {
    const r = await placeOrder(organizationId, { ...o, source: "counter" }, { ignoreHours: true });
    console.log(r.ok ? `Demo order #${r.order.number} (${o.customer.name})` : `Demo order failed: ${r.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
