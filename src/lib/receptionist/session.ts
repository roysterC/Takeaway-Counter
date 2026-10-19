/**
 * A receptionist wired to one takeaway: its settings, its menu, its tools.
 *
 * The menu and the shop's rules are read once, when the call starts, so the
 * instructions and tool list are byte-identical for every turn of the call
 * and the prompt cache holds. What can change mid-call and matters — the
 * pause switch, wait times, a dish selling out — is read again when an order
 * is placed (src/lib/orders.ts).
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getMenu, getShopConfig } from "@/lib/shop";
import { openStatus, spokenNextOpen, spokenTime, zonedNow } from "@/lib/hours";
import { amendOrder, placeOrder, recentOrdersFor, spokenStatus } from "@/lib/orders";
import { formatPence } from "@/lib/money";
import { lookupPostcode } from "@/lib/address-lookup";
import { END_CALL_TOOL, ReceptionistEngine, type StreamingClient } from "./engine";
import { ORDER_TOOLS, orderTools } from "./order-tools";
import { buildSystem, greetingFor } from "./prompt";
import { takeawayKeyterms } from "./voice/keyterms";
import type { OrderDraft } from "@/lib/order-draft";

/**
 * Claude Haiku 5.5 by default: a receptionist's turns are short and the rules
 * that matter are enforced by the order code, so speed is what the caller
 * notices. One setting, so a bigger model can be tried without touching code.
 */
export const DEFAULT_RECEPTIONIST_MODEL = "claude-haiku-5-5";

export function receptionistModel(): string {
  return process.env.RECEPTIONIST_MODEL?.trim() || DEFAULT_RECEPTIONIST_MODEL;
}

export type ReceptionistRequestOptions = Pick<Anthropic.MessageCreateParams, "thinking" | "output_config">;

const EFFORTS = ["low", "medium", "high"] as const;

/**
 * What a model needs sent alongside it. On Haiku 5.5 thinking is off: on a
 * phone line the pause before the first word is what the caller hears, and
 * thinking comes before any of it. Effort stays at the model's own default,
 * medium, unless RECEPTIONIST_EFFORT says otherwise.
 */
export function receptionistRequestOptions(model: string): ReceptionistRequestOptions {
  if (model !== "claude-haiku-5-5") return {};
  const asked = process.env.RECEPTIONIST_EFFORT?.trim().toLowerCase();
  const effort = EFFORTS.find((e) => e === asked) ?? "medium";
  return { thinking: { type: "disabled" }, output_config: { effort } };
}

export interface ReceptionistSession {
  engine: ReceptionistEngine;
  greeting: string;
  model: string;
  toolNames: string[];
  /** Whose Anthropic key the call is charged to. */
  keySource: "shop" | "shared";
  /** The menu's words for the recogniser to listen for. */
  keyterms: string[];
  /** The order taken on this call; `placed` once it has gone to the kitchen. */
  draft: OrderDraft;
}

/**
 * The Anthropic key a shop's receptionist runs on: its own, when one is set on
 * the organisation, so its usage is billed separately; otherwise the shared
 * key. Null when neither exists.
 */
export async function receptionistApiKey(
  organizationId: string
): Promise<{ apiKey: string; source: "shop" | "shared" } | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { anthropicApiKeyOverride: true },
  });
  const own = org?.anthropicApiKeyOverride?.trim();
  if (own) return { apiKey: own, source: "shop" };
  const shared = process.env.ANTHROPIC_API_KEY?.trim();
  return shared ? { apiKey: shared, source: "shared" } : null;
}

export async function startReceptionist(
  organizationId: string,
  opts: {
    callerNumber: string | null;
    /** "lab": a test call; its orders are marked as tests and it may ignore the hours. */
    source?: "phone" | "lab";
    ignoreHours?: boolean;
    client?: StreamingClient;
    now?: Date;
  }
): Promise<ReceptionistSession> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? "phone";
  const ignoreHours = source === "lab" && Boolean(opts.ignoreHours);
  const key = opts.client ? null : await receptionistApiKey(organizationId);
  if (!opts.client && !key) {
    throw new Error("No Anthropic API key: neither this shop's own nor the shared one is set.");
  }

  const [shop, menu, returning] = await Promise.all([
    getShopConfig(organizationId),
    getMenu(organizationId),
    opts.callerNumber ? returningCustomer(organizationId, opts.callerNumber) : Promise.resolve(null),
  ]);

  const tools = orderTools({
    menu: menu.flatMap((s) => s.items),
    delivery: shop.delivery,
    callerNumber: opts.callerNumber,
    orderingRefusal: async () => {
      const fresh = await getShopConfig(organizationId);
      if (!fresh.acceptingOrders) return "The shop has paused phone orders for now.";
      if (ignoreHours) return null;
      const status = openStatus(fresh.hours, fresh.timeZone, new Date());
      if (status.open) return null;
      const next = spokenNextOpen(status);
      return `The shop is closed${next ? ` and opens ${next}` : ""}.`;
    },
    waitMinutes: async () => {
      const fresh = await getShopConfig(organizationId);
      return { collection: fresh.collectionMinutes, delivery: fresh.deliveryMinutes };
    },
    findAddresses: (postcode) => lookupPostcode(postcode, { apiKey: process.env.IDEAL_POSTCODES_API_KEY }),
    placeOrder: (input) => placeOrder(organizationId, { ...input, source }, { ignoreHours }),
    amendOrder: (orderId, input) => amendOrder(organizationId, orderId, { ...input, source }),
    recentOrders: async (phone) => {
      const orders = await recentOrdersFor(organizationId, phone);
      return orders.map((o) => {
        let time: string | null = null;
        if (o.promisedAt) {
          const z = zonedNow(o.promisedAt, shop.timeZone);
          time = spokenTime(`${String(Math.floor(z.minutes / 60)).padStart(2, "0")}:${String(z.minutes % 60).padStart(2, "0")}`);
        }
        return {
          number: o.number,
          type: o.type,
          status: o.status,
          promisedAt: o.promisedAt,
          spokenStatus: spokenStatus(o.type, o.status),
          spokenTime: time,
        };
      });
    },
    saveMessage: async ({ id, name, phone, body }) => {
      if (id) {
        await prisma.message.update({ where: { id }, data: { name, phone, body } });
        return id;
      }
      const m = await prisma.message.create({ data: { organizationId, name, phone, body }, select: { id: true } });
      return m.id;
    },
  });

  const status = openStatus(shop.hours, shop.timeZone, now);
  const canOrder = shop.acceptingOrders && (status.open || ignoreHours);
  const next = spokenNextOpen(status);
  const closedReason = !shop.acceptingOrders
    ? "Sorry, we've paused phone orders for a little while because the kitchen is so busy."
    : `Sorry, we're closed at the moment${next ? `; we open ${next}` : ""}.`;

  const engine: ReceptionistEngine = new ReceptionistEngine({
    client: opts.client ?? new Anthropic({ apiKey: key!.apiKey }),
    model: receptionistModel(),
    request: receptionistRequestOptions(receptionistModel()),
    system: buildSystem(
      {
        businessName: shop.businessName,
        notes: shop.notes,
        hours: shop.hours,
        timeZone: shop.timeZone,
        delivery: shop.delivery,
        menu,
      },
      {
        now,
        timeZone: shop.timeZone,
        hours: shop.hours,
        acceptingOrders: shop.acceptingOrders,
        ignoreHours,
        callerNumber: opts.callerNumber,
        returning,
        waitMinutes: { collection: shop.collectionMinutes, delivery: shop.deliveryMinutes },
      }
    ),
    // Hanging up is the engine's own; it goes last so the order tools keep
    // their place in the cached prefix.
    tools: [...ORDER_TOOLS, END_CALL_TOOL],
    execute: tools.execute,
    // An order can take a few tool calls in one turn: details, items, review.
    maxRoundTrips: 8,
  });

  // The call opens with the greeting already said. The API wants the
  // conversation to start with a user turn, so the connection stands in.
  const greeting = greetingFor({ businessName: shop.businessName, custom: shop.greeting, canOrder, closedReason });
  engine.messages.push(
    { role: "user", content: "[The call has connected.]" },
    { role: "assistant", content: greeting }
  );

  return {
    engine,
    greeting,
    model: receptionistModel(),
    toolNames: [...ORDER_TOOLS.map((t) => t.name), END_CALL_TOOL.name],
    keySource: key?.source ?? "shared",
    keyterms: takeawayKeyterms({ businessName: shop.businessName }),
    draft: tools.draft,
  };
}

/** What the shop knows about a caller from their number, for the receptionist to confirm. */
async function returningCustomer(organizationId: string, phone: string) {
  const customer = await prisma.customer.findUnique({
    where: { organizationId_phone: { organizationId, phone } },
    select: {
      name: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      postcode: true,
      orders: {
        where: { status: { not: "cancelled" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { type: true, totalPence: true, items: { select: { quantity: true, name: true } } },
      },
    },
  });
  if (!customer) return null;
  const last = customer.orders[0];
  const address = [customer.addressLine1, customer.addressLine2, customer.town, customer.postcode].filter(Boolean).join(", ");
  return {
    name: customer.name,
    address: address || null,
    lastOrder: last
      ? `${last.type}, ${last.items.map((i) => `${i.quantity} ${i.name}`).join(", ")} (${formatPence(last.totalPence)})`
      : null,
  };
}
