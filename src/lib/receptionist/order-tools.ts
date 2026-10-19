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
import type { CheckOrderResult, PlaceOrderInput, PlaceOrderResult } from "@/lib/orders";
import { matchAddress, nearestNames, type FoundAddress, type LookupResult } from "@/lib/address-lookup";

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
    name: "find_address",
    description:
      "For a delivery to someone whose address you don't have: look up their postcode. Checks it is in the " +
      "delivery area and finds every address there. Then ask for their house number or name and use " +
      "choose_address.",
    input_schema: {
      type: "object",
      properties: { postcode: { type: "string", description: "UK postcode, e.g. 'ST18 0PP'." } },
      required: ["postcode"],
    },
  },
  {
    name: "choose_address",
    description:
      "Pick the caller's address from the postcode just looked up with find_address, by what they said: a " +
      "house number ('14', '2a'), a house name ('Rose Cottage') or a flat ('flat 2, 14'). Add the street only " +
      "if the postcode covers more than one. Records it as the delivery address.",
    input_schema: {
      type: "object",
      properties: {
        house: { type: "string", description: "House number or name, and flat if any, as the caller said it." },
        street: { type: "string" },
      },
      required: ["house"],
    },
  },
  {
    name: "add_items",
    description:
      "Add dishes to the order. Use the menu number as the code whenever you know it, and the dish name as " +
      "well. Add everything the caller has just asked for in one call. The result's `say` is how to confirm " +
      "it, e.g. \"One Chicken Chow Mein.\" If a dish needs a choice (quarter or half, chicken or beef) or " +
      "cannot be found, nothing is added for it and you are told what to ask.",
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
      "Quantity 0 removes it. Fine after the caller has agreed the order too: then confirm_order and agree_order again.",
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
      "What is on the order so far and what it comes to. Only for when the caller asks (\"what have I got?\", " +
      "\"how much is that?\"). To read the order back when they have finished, use confirm_order instead.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "confirm_order",
    description:
      "Read the order back for the caller to check, as soon as they say they have finished ordering " +
      "(\"that's everything\", \"that's all\", \"no, that's it\"). If anything is still needed, such as their " +
      "name or address, or the order has no rice or chips, you are told what to ask instead. Otherwise say the " +
      "result's \"say\" exactly (\"So that's ..., is that correct?\") and wait for their answer.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "agree_order",
    description:
      "The caller has said yes to confirm_order's question. Never in the same reply as the question. Checks " +
      "the order can be made and gives the price and how long; say the result's \"say\" and wait: do not say " +
      "goodbye yet. The order goes to the kitchen when the call ends. If they change something after this, " +
      "make the change, then confirm_order and agree_order again.",
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
      "question), someone asking for the owner, or a change to an order placed on an earlier call or already " +
      "being cooked. Use it as soon as you " +
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

/** Asked before placing an order that has no rice, chips or noodles. */
export const CARBS_QUESTION = "Would you like any rice or chips with that?";

/** Said to end a call once the order is in and the caller has nothing more. */
export const GOODBYE = "See you soon!";

/** "two Egg Fried Rice" -> "Two Egg Fried Rice." */
function sentence(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export interface OrderToolDeps {
  menu: MenuEntry[];
  delivery: DeliveryRules;
  /** Caller ID, E.164; null when withheld. */
  callerNumber: string | null;
  /** Null when orders can be taken now; otherwise what to tell the caller. */
  orderingRefusal: () => Promise<string | null>;
  /** Current wait times, read fresh so a change on the board applies at once. */
  waitMinutes: () => Promise<{ collection: number; delivery: number }>;
  /** How many times the caller has spoken: see OrderDraft.agreeRefusal. */
  turn: () => number;
  /** Every address at a postcode: see src/lib/address-lookup.ts. */
  findAddresses: (postcode: string) => Promise<LookupResult>;
  /** Everything placing would check, without placing: when the caller says yes. */
  checkOrder: (input: PlaceOrderInput) => Promise<CheckOrderResult>;
  /** Send the order to the kitchen: when the call ends. */
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
  // The addresses at the postcode the caller gave, for choose_address.
  let found: FoundAddress[] = [];
  // What the caller said yes to, sent to the kitchen when the call ends.
  let agreedInput: PlaceOrderInput | null = null;
  let finishing = false;

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
          ...afterAgreeing(),
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
        return { ...result, ...afterAgreeing() };
      }

      case "find_address": {
        if (!deps.delivery.enabled) return { error: "The shop isn't delivering at the moment. Offer collection instead." };
        const pc = normalisePostcode(s(input.postcode));
        if (!pc) return { error: "That isn't a postcode. Ask the caller to say it again, letter by letter." };
        if (!pc.full) return { error: "That's only the start of a postcode. Ask for the whole postcode." };
        if (draft.type !== "delivery") draft.setType("delivery");
        // A postcode moves the delivery somewhere else: the old address goes.
        if (draft.customer.postcode !== pc.postcode) {
          draft.setCustomer({ postcode: pc.postcode, addressLine1: null, addressLine2: null, town: null });
        }
        found = [];
        // Outside the area: no need to look it up at all.
        const q = requote();
        if (!q.ok) return { found: false, problem: `We don't deliver to ${pc.postcode}. Apologise and offer collection instead.` };
        const lookup = await deps.findAddresses(pc.postcode);
        if (!lookup.ok) {
          if (lookup.reason === "not_found") {
            return {
              found: false,
              problem: `${pc.postcode} isn't a postcode we can find. Read it back to check it.`,
              ...(lookup.suggestions.length ? { didTheyMean: lookup.suggestions.slice(0, 3) } : {}),
            };
          }
          return {
            found: false,
            then: "The address search isn't available. Ask for the house number and street, and record them with set_customer_details.",
            deliveryCharge: q.feePence ? spokenPrice(q.feePence) : "free",
          };
        }
        found = lookup.addresses;
        if (found.length === 1) {
          setAddress(found[0]);
          return { found: true, address: spokenAddress(found[0]), then: "There is only one address at this postcode. Check it with the caller in a few words." };
        }
        const streets = [...new Set(found.map((a) => a.street).filter(Boolean))];
        return {
          found: true,
          addresses: found.length,
          streets: streets.slice(0, 6),
          deliveryCharge: q.feePence ? spokenPrice(q.feePence) : "free",
          then:
            "Ask \"What's the house number or name?\"" + (streets.length > 1 ? ", and the street" : "") + ", then use choose_address.",
        };
      }

      case "choose_address": {
        if (!found.length) return { error: "Look the postcode up with find_address first." };
        const match = matchAddress(found, { house: s(input.house) ?? "", street: s(input.street) });
        if (match.kind === "none") {
          // A name that matched nothing may still be a mishearing of one that's there.
          const near = nearestNames(found, s(input.house) ?? "");
          if (near.length) {
            return {
              ok: false,
              didTheyMean: near.map(spokenAddress),
              then: "No house by that name here. Ask if they meant the first of these (one at a time; never read the list out). If they say yes, use choose_address with that name.",
            };
          }
          return {
            ok: false,
            problem: `There's no ${s(input.house)} at ${draft.customer.postcode}. Ask them to say the house number or name again, or to spell the name; if it still isn't found, take the first line of the address as they say it and record it with set_customer_details.`,
          };
        }
        if (match.kind === "choose") {
          return { ok: false, problem: "More than one address fits. Ask which one.", options: match.options.map(spokenAddress) };
        }
        setAddress(match.address);
        return {
          ok: true,
          address: spokenAddress(match.address),
          then: "Say the address back in a few words, then carry on.",
          ...afterAgreeing(),
        };
      }

      case "add_items": {
        const refusal = await deps.orderingRefusal();
        if (refusal) return { error: `${refusal} Do not take an order.` };
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
            const notes = s(it.notes) ?? null;
            const before = draft.lines.find((l) => l.item.id === match.item.id && l.notes === (notes?.trim() || null))?.quantity ?? 0;
            const { line, quantity } = draft.addItem(match.item, qty, notes);
            return { asked: label, added: true, line, quantity, addedNow: quantity - before, notes, ...itemForTool(match.item) };
          } catch (err) {
            return { asked: label, added: false, problem: err instanceof Error ? err.message : String(err) };
          }
        });
        if (draft.type === "delivery" && draft.customer.postcode) requote();
        const added = results.flatMap((r) =>
          "addedNow" in r && r.addedNow ? [{ quantity: r.addedNow, name: r.name, notes: r.notes }] : []
        );
        return {
          results,
          // All the caller needs to hear back: the quantity and the dish, no price.
          ...(added.length ? { say: sentence(OrderDraft.spokenDishes(added)) } : {}),
          order: draft.summary(),
          ...afterAgreeing(),
        };
      }

      case "change_item": {
        const line = typeof input.line === "number" ? input.line : NaN;
        if (!draft.lines[line - 1]) return { error: `There is no line ${input.line}. The order has ${draft.lines.length} lines.`, order: draft.summary() };
        draft.changeLine(line, {
          quantity: typeof input.quantity === "number" ? input.quantity : undefined,
          notes: input.notes === undefined ? undefined : (s(input.notes) ?? null),
        });
        if (draft.type === "delivery" && draft.customer.postcode) requote();
        return { ok: true, order: draft.summary(), ...afterAgreeing() };
      }

      case "set_order_notes": {
        draft.setNotes(s(input.notes) ?? null);
        return { ok: true, notes: draft.notes, ...afterAgreeing() };
      }

      case "review_order": {
        return {
          dishes: draft.lines.length ? OrderDraft.spokenDishes(draft.lines.map((l) => ({ quantity: l.quantity, name: l.item.name, notes: l.notes }))) : "nothing yet",
          ...(draft.type === "delivery" ? { deliveryCharge: spokenPrice(draft.deliveryFeePence) } : {}),
          spokenTotal: spokenPrice(draft.totalPence),
          order: draft.summary(),
        };
      }

      case "confirm_order": {
        // Agreed and unchanged since: nothing to check again.
        if (draft.agreed) return { ready: true, alreadyAgreed: true, then: "They have already agreed the order as it stands. Carry on." };
        const missing = draft.missing();
        if (missing.length) return { ready: false, askFor: missing, then: "Ask for these, then use confirm_order again." };
        // Nothing to eat it with: offer rice or chips, once, now the caller
        // has finished ordering. Not when changing an order already agreed.
        if (!draft.everAgreed && !draft.hasStaple && !draft.carbsOffered) {
          draft.carbsOffered = true;
          return {
            ready: false,
            ask: CARBS_QUESTION,
            then:
              "The order has no rice, chips or noodles. Ask exactly this and nothing else. If they want some, add " +
              "it with add_items and use confirm_order in the same reply, without confirming the dish. If they " +
              "don't, use confirm_order straight away.",
          };
        }
        if (draft.type === "delivery") {
          const q = requote();
          if (!q.ok) return { ready: false, problem: "That address isn't in the delivery area. Offer collection." };
          if (q.shortByPence > 0) {
            return {
              ready: false,
              problem: `Delivery needs at least ${spokenPrice(q.minOrderPence)} of food; the order is ${spokenPrice(q.shortByPence)} short. Tell the caller and ask if they would like to add something, or collect instead.`,
            };
          }
        }
        draft.markConfirmationAsked(deps.turn());
        return {
          ready: true,
          say: draft.confirmationQuestion(),
          then: "Say this exactly and wait. If they say yes, use agree_order. If not, ask what to change, change it, and use confirm_order again.",
        };
      }

      case "agree_order": {
        if (draft.agreed) return { agreed: true, then: "Already agreed as it stands. Carry on." };
        const refusal = draft.agreeRefusal(deps.turn());
        if (refusal) return { agreed: false, error: refusal };
        const input = orderInput();
        const check = await deps.checkOrder(input);
        if (!check.ok) return { agreed: false, error: check.message, then: "Tell the caller plainly; the order can't go through as it is." };
        draft.markAgreed();
        agreedInput = input;
        return {
          agreed: true,
          total: formatPence(check.totalPence),
          say: draft.priceAndTime(check.readyInMinutes),
          then: `Say this exactly, then wait for them. The order goes to the kitchen when the call ends. When they say goodbye, thanks or that's all, say "${GOODBYE}" and end the call with end_call in the same reply. If they ask something, answer it.`,
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

  /** A looked-up address becomes the delivery address. */
  function setAddress(a: FoundAddress) {
    draft.setCustomer({ addressLine1: a.line1, addressLine2: a.line2, town: a.town, postcode: a.postcode || draft.customer.postcode });
    requote();
  }

  /** "14 Smithy Lane, Hixon": how the address is said back. */
  function spokenAddress(a: FoundAddress) {
    return [a.line1, a.line2].filter(Boolean).join(", ");
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

  /** A change after the caller agreed the order: say so, so it is agreed again. */
  function afterAgreeing() {
    return draft.everAgreed && !draft.agreed
      ? { note: "The order has changed since they agreed it. When they have finished changing it, read it back with confirm_order and wait for yes." }
      : {};
  }

  /** The order as it stands, in the shape placing takes. */
  function orderInput(): PlaceOrderInput {
    return {
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
    };
  }

  /**
   * The call has ended: send the order the caller agreed to the kitchen.
   * Once only, and only an agreed order. If they changed it after agreeing
   * and hung up before agreeing again, the agreed version goes and the staff
   * get a message about the change. If it can't be placed at all (a dish
   * sold out in the last minute), the staff get a message to ring them back,
   * since the caller is no longer there to be told.
   */
  async function finish(): Promise<{ orderId: string; number: number } | null> {
    if (!agreedInput || draft.placed || finishing) return draft.placed;
    finishing = true;
    const input = agreedInput;
    const who = [input.customer.name, input.customer.phone ? speakablePhone(input.customer.phone) : null].filter(Boolean).join(", ");
    const result = await deps.placeOrder(input);
    if (!result.ok) {
      await deps.saveMessage({
        id: null,
        name: input.customer.name,
        phone: input.customer.phone ?? null,
        body: `Phone order couldn't be sent to the kitchen after the call: ${result.message} They were expecting: ${OrderDraft.spokenDishes(
          draft.lines.map((l) => ({ quantity: l.quantity, name: l.item.name, notes: l.notes }))
        )} (${input.type}). Please ring ${who} back.`,
      });
      return null;
    }
    draft.placed = { orderId: result.order.id, number: result.order.number };
    if (!draft.agreed) {
      await deps.saveMessage({
        id: null,
        name: input.customer.name,
        phone: input.customer.phone ?? null,
        body: `Order #${result.order.number}: the caller started changing it after agreeing, and the call ended before they agreed the change. The order went through as first agreed; please check with ${who}.`,
      });
    }
    return draft.placed;
  }

  return { draft, execute, finish };
}
