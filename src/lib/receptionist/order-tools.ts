/**
 * The receptionist's tools for taking an order, and what each one does.
 *
 * The model talks; these keep the books. Prices, totals, delivery fees and
 * whether an order may be placed are all decided here from the menu and the
 * shop's rules, and handed back as results, so nothing the caller is told
 * about money is the model's own arithmetic.
 *
 * Kept free of the database: everything that reads or writes it comes in as
 * a dependency, so the whole ordering flow can be run in tests with a fake
 * shop.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { findMenuItem, itemForTool, itemLabel, type MenuEntry } from "@/lib/menu";
import { OrderDraft, type OrderType } from "@/lib/order-draft";
import { normalisePostcode, quoteDelivery, type DeliveryRules } from "@/lib/delivery";
import { formatPence, spokenPrice } from "@/lib/money";
import { normalisePhone, speakablePhone } from "@/lib/phone";
import type { PlaceOrderInput, PlaceOrderResult } from "@/lib/orders";

export const ORDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_order_type",
    description:
      "Record whether the order is for collection or delivery. Use it as soon as the caller says which. " +
      "Changing it later is fine.",
    input_schema: {
      type: "object",
      properties: { type: { type: "string", enum: ["collection", "delivery"] } },
      required: ["type"],
    },
  },
  {
    name: "set_customer_details",
    description:
      "Record who the order is for and, for delivery, where it is going. Send only what you have learned or " +
      "the caller has changed; everything else is kept. For delivery this checks the postcode is in the " +
      "delivery area and gives the delivery charge. The contact number is the one they are ringing from " +
      "unless they give another.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name the order is under." },
        phone: { type: "string", description: "Only if they want a different contact number from the one they are calling on." },
        addressLine1: { type: "string", description: "House number or name and street, e.g. '12 Smithy Lane'." },
        addressLine2: { type: "string" },
        town: { type: "string" },
        postcode: { type: "string", description: "UK postcode, e.g. 'ST18 0PP'." },
        deliveryNotes: { type: "string", description: "Directions for the driver, e.g. 'side door'." },
      },
    },
  },
  {
    name: "add_items",
    description:
      "Add dishes to the order. Use the menu number as the code whenever you know it, and the dish name as " +
      "well. Add everything the caller has just asked for in one call. If a dish needs a choice (quarter or " +
      "half, chicken or beef) or cannot be found, nothing is added for it and you are told what to ask.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Menu number, e.g. '65a', 'A' for set meal A." },
              name: { type: "string", description: "Dish name as on the menu." },
              quantity: { type: "integer", minimum: 1 },
              notes: { type: "string", description: "Only a request for this dish, e.g. 'no onions', 'extra spicy'." },
            },
            required: ["quantity"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "change_item",
    description:
      "Change or remove a line already on the order, by its line number from the latest order summary. " +
      "Quantity 0 removes it.",
    input_schema: {
      type: "object",
      properties: {
        line: { type: "integer", minimum: 1 },
        quantity: { type: "integer", minimum: 0 },
        notes: { type: "string", description: "Replaces the line's notes; empty clears them." },
      },
      required: ["line"],
    },
  },
  {
    name: "set_order_notes",
    description:
      "A note for the kitchen about the whole order, such as an allergy the caller has told you about or 'no MSG'. Empty clears it.",
    input_schema: { type: "object", properties: { notes: { type: "string" } }, required: ["notes"] },
  },
  {
    name: "review_order",
    description:
      "Get the order read-back once the caller has finished ordering. Read the readBack text to the caller and " +
      "ask if it is all correct. If something is still missing you are told what to ask for instead.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "place_order",
    description:
      "Send the order to the kitchen. Only after you have read the order back with review_order and the caller " +
      "has said it is right. Never in the same reply as the read-back.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_order_status",
    description: "Look up the caller's order from tonight when they ask where it is or how long it will be.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "take_message",
    description:
      "Leave a message for the shop's staff: a complaint, a question you cannot answer (such as an allergy " +
      "question), someone asking for the owner, or a change to an order already placed. Use it as soon as you " +
      "have their name and what it is about. Sending it again in the same call adds to the same message.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        message: { type: "string" },
        phone: { type: "string", description: "Only if they want to be called back on a different number." },
      },
      required: ["message"],
    },
  },
];

export type OrderToolName = (typeof ORDER_TOOLS)[number]["name"];

export interface OrderToolDeps {
  menu: MenuEntry[];
  delivery: DeliveryRules;
  /** Caller ID, E.164; null when withheld. */
  callerNumber: string | null;
  /** How many times the caller has spoken: see OrderDraft.placeRefusal. */
  turn: () => number;
  /** Null when orders can be taken now; otherwise what to tell the caller. */
  orderingRefusal: () => Promise<string | null>;
  /** Current wait times, read fresh so a change on the board applies at once. */
  waitMinutes: () => Promise<{ collection: number; delivery: number }>;
  placeOrder: (input: PlaceOrderInput) => Promise<PlaceOrderResult>;
  recentOrders: (phone: string) => Promise<
    Array<{ number: number; type: string; status: string; promisedAt: Date | null; spokenStatus: string; spokenTime: string | null }>
  >;
  /** Save a message, or add to the one already left on this call. */
  saveMessage: (msg: { id: string | null; name: string | null; phone: string | null; body: string }) => Promise<string>;
}

/**
 * One call's ordering state and the handler for its tools. Returns a result
 * for every call, including refusals: a tool only throws on a bug.
 */
export function orderTools(deps: OrderToolDeps) {
  const draft = new OrderDraft();
  if (deps.callerNumber) draft.setCustomer({ phone: deps.callerNumber });
  // The message left on this call, kept so a second take_message adds to it
  // without losing the name or number given the first time.
  let messageId: string | null = null;
  let messageBody = "";
  let messageName: string | null = null;
  let messagePhone: string | null = deps.callerNumber;

  const s = (v: unknown) => (typeof v === "string" ? v : undefined);

  async function execute(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "set_order_type": {
        const type = input.type === "delivery" || input.type === "collection" ? (input.type as OrderType) : null;
        if (!type) return { error: "Say collection or delivery." };
        if (type === "delivery" && !deps.delivery.enabled) {
          return { error: "The shop isn't delivering at the moment. Offer collection instead." };
        }
        draft.setType(type);
        if (type === "delivery" && draft.customer.postcode) requote();
        return {
          ok: true,
          type,
          ...(type === "delivery"
            ? {
                minimumOrder: spokenPrice(deps.delivery.minOrderPence),
                deliveryAreas: deps.delivery.zones.map((z) => `${z.name} (${spokenPrice(z.feePence)})`),
              }
            : {}),
          order: draft.summary(),
        };
      }

      case "set_customer_details": {
        const patch: Record<string, string | undefined> = {
          name: s(input.name),
          addressLine1: s(input.addressLine1),
          addressLine2: s(input.addressLine2),
          town: s(input.town),
          deliveryNotes: s(input.deliveryNotes),
        };
        if (s(input.phone)?.trim()) {
          const parsed = normalisePhone(s(input.phone));
          if (!parsed.ok) return { error: `That phone number doesn't look right: ${parsed.reason} Ask them to repeat it.` };
          patch.phone = parsed.e164;
        }
        if (s(input.postcode) !== undefined) {
          const pc = normalisePostcode(s(input.postcode));
          if (!pc) return { error: "That isn't a postcode. Ask the caller to say it again, letter by letter." };
          patch.postcode = pc.postcode;
        }
        draft.setCustomer(patch);
        const result: Record<string, unknown> = { ok: true, customer: spokenCustomer() };
        if (draft.type === "delivery" && draft.customer.postcode) {
          const q = requote();
          if (!q.ok) {
            return {
              ...result,
              ok: false,
              problem:
                q.reason === "outside_area"
                  ? `We don't deliver to ${q.postcode}. Apologise and offer collection instead.`
                  : "That postcode doesn't look complete. Ask for the full postcode.",
            };
          }
          if (!normalisePostcode(draft.customer.postcode)?.full) {
            result.problem = "That is only the start of the postcode. Ask for the full postcode.";
          }
          result.deliveryCharge = q.feePence ? spokenPrice(q.feePence) : "free";
          result.deliveryArea = q.zone;
        }
        return result;
      }

      case "add_items": {
        const refusal = await deps.orderingRefusal();
        if (refusal) return { error: `${refusal} Do not take an order.` };
        if (draft.placed) return { error: placedAlready() };
        const asked = Array.isArray(input.items) ? input.items : [];
        if (!asked.length) return { error: "No dishes were given." };
        const results = asked.slice(0, 20).map((raw) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const label = s(it.name) || s(it.code) || "that";
          const match = findMenuItem(deps.menu, { code: s(it.code), name: s(it.name) });
          if (match.kind === "none") {
            return { asked: label, added: false, problem: "Not on the menu. Ask the caller what they meant, or suggest the nearest dish." };
          }
          if (match.kind === "choose") {
            return {
              asked: label,
              added: false,
              problem: "More than one dish matches. Ask which one they want.",
              options: match.options.map((o) => itemLabel(o)),
            };
          }
          if (!match.item.available) {
            return { asked: label, added: false, problem: `${match.item.name} is sold out tonight. Apologise and suggest something similar.` };
          }
          const qty = typeof it.quantity === "number" ? it.quantity : 1;
          try {
            const { line, quantity } = draft.addItem(match.item, qty, s(it.notes) ?? null);
            return { asked: label, added: true, line, quantity, ...itemForTool(match.item) };
          } catch (err) {
            return { asked: label, added: false, problem: err instanceof Error ? err.message : String(err) };
          }
        });
        if (draft.type === "delivery" && draft.customer.postcode) requote();
        return { results, order: draft.summary() };
      }

      case "change_item": {
        if (draft.placed) return { error: placedAlready() };
        const line = typeof input.line === "number" ? input.line : NaN;
        if (!draft.lines[line - 1]) return { error: `There is no line ${input.line}. The order has ${draft.lines.length} lines.`, order: draft.summary() };
        draft.changeLine(line, {
          quantity: typeof input.quantity === "number" ? input.quantity : undefined,
          notes: input.notes === undefined ? undefined : (s(input.notes) ?? null),
        });
        if (draft.type === "delivery" && draft.customer.postcode) requote();
        return { ok: true, order: draft.summary() };
      }

      case "set_order_notes": {
        if (draft.placed) return { error: placedAlready() };
        draft.setNotes(s(input.notes) ?? null);
        return { ok: true, notes: draft.notes };
      }

      case "review_order": {
        if (draft.placed) return { error: placedAlready() };
        const missing = draft.missing();
        if (missing.length) return { ready: false, askFor: missing, order: draft.summary() };
        if (draft.type === "delivery") {
          const q = requote();
          if (!q.ok) return { ready: false, problem: "That address isn't in the delivery area. Offer collection.", order: draft.summary() };
          if (q.shortByPence > 0) {
            return {
              ready: false,
              problem: `Delivery needs at least ${spokenPrice(q.minOrderPence)} of food; the order is ${spokenPrice(q.shortByPence)} short. Tell the caller and ask if they would like to add something, or collect instead.`,
              order: draft.summary(),
            };
          }
        }
        const wait = await deps.waitMinutes();
        draft.markReviewed(deps.turn());
        return {
          ready: true,
          readBack: draft.readBack(draft.type === "delivery" ? wait.delivery : wait.collection),
          then: "Read this to the caller and ask if everything is correct. Place the order only once they say yes.",
          order: draft.summary(),
          ...(draft.notes ? { kitchenNote: draft.notes } : {}),
        };
      }

      case "place_order": {
        const refusal = draft.placeRefusal(deps.turn());
        if (refusal) return { error: refusal };
        const result = await deps.placeOrder({
          type: draft.type!,
          source: "phone",
          customer: {
            name: draft.customer.name!,
            phone: draft.customer.phone,
            addressLine1: draft.customer.addressLine1,
            addressLine2: draft.customer.addressLine2,
            town: draft.customer.town,
            postcode: draft.customer.postcode,
            deliveryNotes: draft.customer.deliveryNotes,
          },
          lines: draft.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, notes: l.notes })),
          notes: draft.notes,
        });
        if (!result.ok) return { success: false, error: result.message, then: "Tell the caller plainly; do not say the order is in." };
        draft.placed = { orderId: result.order.id, number: result.order.number };
        return {
          success: true,
          orderNumber: result.order.number,
          total: formatPence(result.order.totalPence),
          spokenTotal: spokenPrice(result.order.totalPence),
          readyInMinutes: result.order.readyInMinutes,
          then:
            draft.type === "delivery"
              ? "Tell them the order is in and roughly how long it will be, and that it's cash on delivery. Then ask if there's anything else."
              : "Tell them the order is in and when to come and collect it, and that it's cash on collection. Then ask if there's anything else.",
        };
      }

      case "check_order_status": {
        const phone = draft.customer.phone ?? deps.callerNumber;
        if (!phone) return { found: false, then: "The number is withheld, so the order can't be found. Ask for the phone number the order was placed with, record it with set_customer_details, and try again." };
        const orders = await deps.recentOrders(phone);
        if (!orders.length) return { found: false, then: `No order from ${speakablePhone(phone)} tonight. Ask if it was placed under a different number.` };
        return { found: true, orders };
      }

      case "take_message": {
        const body = s(input.message)?.trim();
        if (!body) return { error: "What is the message?" };
        if (s(input.phone)?.trim()) {
          const parsed = normalisePhone(s(input.phone));
          if (!parsed.ok) return { error: `That phone number doesn't look right: ${parsed.reason}` };
          messagePhone = parsed.e164;
        }
        messageName = s(input.name)?.trim() || messageName || draft.customer.name;
        messageBody = messageBody ? `${messageBody}\n${body}` : body;
        messageId = await deps.saveMessage({ id: messageId, name: messageName, phone: messagePhone, body: messageBody });
        return {
          success: true,
          then: messagePhone
            ? "Tell them the message is passed on and someone from the shop will ring them back."
            : "The number is withheld: ask for a number to ring them back on and send take_message again with it.",
        };
      }

      default:
        return { error: `There is no tool called ${name}.` };
    }
  }

  /** Re-quote delivery for the current address and food, and keep the fee on the draft. */
  function requote() {
    const q = quoteDelivery(deps.delivery, draft.customer.postcode ?? "", draft.subtotalPence);
    draft.setDeliveryFee(q.ok ? q.feePence : 0);
    return q;
  }

  function spokenCustomer() {
    const c = draft.customer;
    return {
      name: c.name,
      phone: c.phone ? speakablePhone(c.phone) : null,
      ...(draft.type === "delivery"
        ? { address: [c.addressLine1, c.addressLine2, c.town, c.postcode].filter(Boolean).join(", ") || null }
        : {}),
      ...(c.deliveryNotes ? { deliveryNotes: c.deliveryNotes } : {}),
    };
  }

  function placedAlready() {
    return `Order number ${draft.placed!.number} has already gone to the kitchen and can't be changed from here. Take a message so the staff can change it.`;
  }

  return { draft, execute };
}
