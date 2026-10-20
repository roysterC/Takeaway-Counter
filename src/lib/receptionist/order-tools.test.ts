import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { END_CALL_TOOL, ReceptionistEngine, type StreamingClient } from "./engine";
import { CARBS_QUESTION, ORDER_TOOLS, orderTools, type OrderToolDeps } from "./order-tools";
import { withOrder } from "./outcomes";
import { buildCallContext, buildStableSystem, greetingFor } from "./prompt";
import { MOCK_HIXON_ZONES } from "@/lib/delivery";
import { ADDRESSES, NAMED } from "@/lib/address-lookup.fixtures";
import { parseOpeningHours } from "@/lib/hours";
import { isStapleByDefault, type MenuEntry } from "@/lib/menu";
import type { PlaceOrderInput } from "@/lib/orders";

const item = (id: string, code: string | null, name: string, pricePence: number, available = true): MenuEntry => ({
  id,
  code,
  name,
  description: null,
  pricePence,
  available,
  aliases: [],
  category: "Test",
  staple: isStapleByDefault(name, "Test"),
});

const MENU = [
  item("cm", "147", "Chicken Chow Mein", 690),
  item("efr", "170", "Egg Fried Rice", 330),
  item("ss", "94", "Sweet & Sour Chicken Hong Kong Style", 700),
  item("dq", "22", "Crispy Aromatic Duck (Quarter)", 1000),
  item("dh", "22", "Crispy Aromatic Duck (Half)", 1850),
  item("out", "99", "King Prawn Balls with Sweet & Sour Sauce", 770, false),
  item("cb", "98", "Chicken Balls with Sweet & Sour Sauce", 700),
  item("soup", "25", "Chicken & Sweet Corn Soup", 460),
];

function setup(over: Partial<OrderToolDeps> = {}) {
  let turn = 1;
  const placed: PlaceOrderInput[] = [];
  const checked: PlaceOrderInput[] = [];
  const deps: OrderToolDeps = {
    menu: MENU,
    delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
    callerNumber: "+447700900123",
    turn: () => turn,
    orderingRefusal: async () => null,
    waitMinutes: async () => ({ collection: 20, delivery: 45 }),
    placeOrder: async (input) => {
      placed.push(input);
      return { ok: true, order: { id: "o1", number: 1042, totalPence: 0, deliveryFeePence: 150, promisedAt: new Date(), readyInMinutes: 45 } };
    },
    checkOrder: async (input) => {
      checked.push(input);
      return { ok: true, totalPence: 0, deliveryFeePence: 0, readyInMinutes: input.type === "delivery" ? 45 : 20 };
    },
    recentOrders: async () => [],
    saveMessage: vi.fn(async () => "m1"),
    findAddresses: async () => ({ ok: true, addresses: ADDRESSES }),
    ...over,
  };
  const tools = orderTools(deps);
  /** The caller speaks: a new turn. */
  const caller = () => turn++;
  /** "That's everything" ... "Yes": read back, and the caller agrees. */
  const confirmAndAgree = async () => {
    const asked = await tools.execute("confirm_order", {});
    caller();
    return { asked, agreed: await tools.execute("agree_order", {}) };
  };
  return { ...tools, placed, checked, caller, confirmAndAgree };
}

describe("taking an order", () => {
  it("takes a delivery: checks it with the caller, gives the price on 'yes', and sends it when the call ends", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "delivery" });
    const details = (await t.execute("set_customer_details", {
      name: "Sarah",
      addressLine1: "14 Smithy Lane",
      postcode: "st18 0pq",
    })) as Record<string, unknown>;
    expect(details).toMatchObject({ ok: true, deliveryArea: "Hixon", deliveryCharge: "one pound fifty" });

    const added = (await t.execute("add_items", {
      items: [
        { code: "147", name: "Chicken Chow Mein", quantity: 2 },
        { code: "170", quantity: 1 },
      ],
    })) as { results: Array<{ added: boolean }>; say: string; order: { total: string } };
    expect(added.results.every((r) => r.added)).toBe(true);
    // Just the quantity and the dish: no price.
    expect(added.say).toBe("Two Chicken Chow Mein and one Egg Fried Rice.");
    // 2 x 6.90 + 3.30 = 17.10, plus 1.50 delivery.
    expect(added.order.total).toBe("£18.60");

    // "That's everything": read back as a question, no price.
    const asked = (await t.execute("confirm_order", {})) as { ready: boolean; say: string };
    expect(asked.say).toBe("So that's two Chicken Chow Mein and one Egg Fried Rice, for delivery to 14 Smithy Lane, ST18 0PQ, is that correct?");

    // Taking the yes as given, in the same breath as the question, is refused.
    expect(await t.execute("agree_order", {})).toMatchObject({ agreed: false, error: expect.stringContaining("wait for the caller") });
    expect(t.draft.agreed).toBe(false);

    // "Yes": checked and priced, but nothing goes to the kitchen yet.
    t.caller();
    const agreed = (await t.execute("agree_order", {})) as { agreed: boolean; say: string; then: string };
    expect(agreed.agreed).toBe(true);
    expect(agreed.say).toBe("That's eighteen pounds sixty including one pound fifty delivery, cash on delivery. It'll be with you in about 45 minutes.");
    expect(agreed.say).not.toContain("See you soon");
    expect(agreed.then).toContain("See you soon!");
    expect(t.checked).toHaveLength(1);
    expect(t.placed).toHaveLength(0);

    // The call ends: now it goes, once.
    expect(await t.finish()).toEqual({ orderId: "o1", number: 1042 });
    expect(await t.finish()).toEqual({ orderId: "o1", number: 1042 });
    expect(t.placed).toHaveLength(1);
    expect(t.placed[0]).toMatchObject({
      type: "delivery",
      customer: { name: "Sarah", phone: "+447700900123", postcode: "ST18 0PQ" },
      lines: [
        { menuItemId: "cm", quantity: 2 },
        { menuItemId: "efr", quantity: 1 },
      ],
    });
  });

  it("sends nothing when the call ends before the caller agrees", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    await t.execute("confirm_order", {});
    expect(await t.finish()).toBeNull();
    expect(t.placed).toHaveLength(0);
  });

  it("needs the order read back again after it changes", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    await t.execute("confirm_order", {});
    t.caller(); // "Oh, and an egg fried rice."
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    expect(await t.execute("agree_order", {})).toMatchObject({ agreed: false, error: expect.stringContaining("hasn't been read back") });
    const again = (await t.confirmAndAgree()) as { asked: { say: string }; agreed: { agreed: boolean } };
    expect(again.asked.say).toContain("one Chicken Chow Mein and one Egg Fried Rice, for collection, is that correct?");
    expect(again.agreed.agreed).toBe(true);
  });

  it("confirms only what was just added when a dish is added again", async () => {
    const t = setup();
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    const again = (await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] })) as { say: string };
    expect(again.say).toBe("One Chicken Chow Mein.");
    expect(t.draft.lines[0].quantity).toBe(2);
  });

  it("takes a change after 'yes' as part of the order, once it's agreed again", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    await t.execute("confirm_order", {}); // "Would you like any rice or chips?" "No thanks."
    await t.confirmAndAgree();
    // "Actually, make that two."
    const changed = (await t.execute("change_item", { line: 1, quantity: 2 })) as { note?: string };
    expect(changed.note).toContain("confirm_order");
    expect(t.draft.agreed).toBe(false);
    const again = (await t.confirmAndAgree()) as { asked: { say: string }; agreed: { agreed: boolean } };
    expect(again.asked.say).toContain("two Sweet & Sour Chicken Hong Kong Style, for collection, is that correct?");
    expect(again.agreed.agreed).toBe(true);
    await t.finish();
    expect(t.placed).toHaveLength(1);
    expect(t.placed[0].lines).toEqual([{ menuItemId: "ss", quantity: 2, notes: null }]);
  });

  it("sends what was agreed, and tells the staff, if a change wasn't agreed before the call ended", async () => {
    const saveMessage = vi.fn(async () => "m1");
    const t = setup({ saveMessage });
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    await t.confirmAndAgree();
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] }); // ...and then they hang up
    await t.finish();
    expect(t.placed[0].lines).toEqual([{ menuItemId: "cm", quantity: 1, notes: null }]);
    expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Order #1042") }));
  });

  it("tells the staff to ring back if the order can't be sent once the call has ended", async () => {
    const saveMessage = vi.fn(async () => "m1");
    const t = setup({
      saveMessage,
      placeOrder: async () => ({ ok: false, code: "sold_out", message: "Chicken Chow Mein has just sold out." }),
    });
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    await t.confirmAndAgree();
    expect(await t.finish()).toBeNull();
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Dave", phone: "+447700900123", body: expect.stringContaining("Please ring Dave, 07700 900123 back") })
    );
  });

  it("tells the caller straight away if the order can't be made", async () => {
    const t = setup({ checkOrder: async () => ({ ok: false, code: "sold_out", message: "Chicken Chow Mein has just sold out." }) });
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    const { agreed } = (await t.confirmAndAgree()) as { agreed: { agreed: boolean; error: string } };
    expect(agreed).toMatchObject({ agreed: false, error: "Chicken Chow Mein has just sold out." });
    expect(t.draft.agreed).toBe(false);
  });

  it("offers rice or chips once, when the caller has finished and ordered none", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    // While ordering, nothing is offered: just the dish.
    const added = (await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] })) as Record<string, unknown>;
    expect(added).not.toHaveProperty("ask");
    expect(added.say).toBe("One Sweet & Sour Chicken Hong Kong Style.");

    // "That's everything": the rice question comes before the read-back.
    expect(await t.execute("confirm_order", {})).toMatchObject({ ready: false, ask: CARBS_QUESTION });

    // "Yes, an egg fried rice": added and read back, with no second question.
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    const done = (await t.confirmAndAgree()) as { asked: { say: string }; agreed: { agreed: boolean } };
    expect(done.asked.say).toContain("one Sweet & Sour Chicken Hong Kong Style and one Egg Fried Rice, for collection");
    expect(done.agreed.agreed).toBe(true);
    await t.finish();
    expect(t.placed[0].lines.map((l) => l.menuItemId)).toEqual(["ss", "efr"]);
  });

  it("reads the order back on 'no thanks' without asking again", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    expect(await t.execute("confirm_order", {})).toMatchObject({ ask: CARBS_QUESTION });
    expect(await t.execute("confirm_order", {})).toMatchObject({ ready: true, say: expect.stringContaining("is that correct?") });
  });

  it("does not offer rice or chips when the order already has some", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }, { code: "147", quantity: 1 }] });
    expect(await t.execute("confirm_order", {})).toMatchObject({ ready: true });
  });

  it("asks for missing details before the rice question", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    expect(await t.execute("confirm_order", {})).toMatchObject({ ready: false, askFor: ["the caller's name"] });
    await t.execute("set_customer_details", { name: "Dave" });
    expect(await t.execute("confirm_order", {})).toMatchObject({ ask: CARBS_QUESTION });
  });

  it("finds a new customer's address from their postcode and house number", async () => {
    const lookups: string[] = [];
    const t = setup({
      findAddresses: async (pc) => {
        lookups.push(pc);
        return { ok: true, addresses: ADDRESSES };
      },
    });
    await t.execute("set_order_type", { type: "delivery" });
    const found = (await t.execute("find_address", { postcode: "st18 0pq" })) as Record<string, unknown>;
    expect(lookups).toEqual(["ST18 0PQ"]);
    expect(found).toMatchObject({ found: true, addresses: 7, streets: ["Smithy Lane", "Church Road"], deliveryCharge: "one pound fifty" });
    expect(found.then).toContain("and the street");

    const chosen = (await t.execute("choose_address", { house: "12" })) as Record<string, unknown>;
    expect(chosen).toMatchObject({ ok: true, address: "12 Smithy Lane, Hixon" });
    expect(t.draft.customer).toMatchObject({ addressLine1: "12 Smithy Lane", addressLine2: "Hixon", town: "Stafford", postcode: "ST18 0PQ" });

    await t.execute("set_customer_details", { name: "Sam" });
    await t.execute("add_items", { items: [{ code: "147", quantity: 3 }] });
    const { asked } = (await t.confirmAndAgree()) as { asked: { say: string } };
    expect(asked.say).toContain("for delivery to 12 Smithy Lane, Hixon, ST18 0PQ");
    await t.finish();
    expect(t.placed[0].customer).toMatchObject({ addressLine1: "12 Smithy Lane", addressLine2: "Hixon", town: "Stafford", postcode: "ST18 0PQ" });
  });

  it("asks which one when the house number fits more than one address", async () => {
    const t = setup();
    await t.execute("find_address", { postcode: "ST18 0PQ" });
    expect(await t.execute("choose_address", { house: "16" })).toMatchObject({
      ok: false,
      options: ["Flat 1, 16 Smithy Lane, Hixon", "Flat 2, 16 Smithy Lane, Hixon"],
    });
    expect(await t.execute("choose_address", { house: "99" })).toMatchObject({ ok: false, problem: expect.stringContaining("no 99") });
    expect(t.draft.customer.addressLine1).toBeNull();
  });

  it("finds a house by name, and asks about the nearest name when it can't", async () => {
    const t = setup({ findAddresses: async () => ({ ok: true, addresses: NAMED }) });
    await t.execute("set_order_type", { type: "delivery" });
    await t.execute("find_address", { postcode: "ST18 0PR" });
    expect(await t.execute("choose_address", { house: "the hollows" })).toMatchObject({ ok: false, didTheyMean: ["The Hollies, Smithy Lane, Hixon"] });
    expect(await t.execute("choose_address", { house: "the hollies" })).toMatchObject({ ok: true, address: "The Hollies, Smithy Lane, Hixon" });
    expect(t.draft.customer).toMatchObject({ addressLine1: "The Hollies", addressLine2: "Smithy Lane, Hixon", postcode: "ST18 0PR" });
  });

  it("doesn't look up a postcode outside the delivery area", async () => {
    const findAddresses = vi.fn(async () => ({ ok: true as const, addresses: ADDRESSES }));
    const t = setup({ findAddresses });
    expect(await t.execute("find_address", { postcode: "B5 4BU" })).toMatchObject({ found: false, problem: expect.stringContaining("offer collection") });
    expect(findAddresses).not.toHaveBeenCalled();
  });

  it("falls back to asking for the street when the search isn't set up", async () => {
    const t = setup({ findAddresses: async () => ({ ok: false, reason: "not_configured" }) });
    expect(await t.execute("find_address", { postcode: "ST18 0PQ" })).toMatchObject({
      found: false,
      then: expect.stringContaining("house number and street"),
    });
    // The postcode is kept: only the first line is still needed.
    expect(t.draft.customer.postcode).toBe("ST18 0PQ");
  });

  it("offers the provider's suggestions for a postcode it can't find", async () => {
    const t = setup({ findAddresses: async () => ({ ok: false, reason: "not_found", suggestions: ["ST18 0PP"] }) });
    expect(await t.execute("find_address", { postcode: "ST18 0PX" })).toMatchObject({ found: false, didTheyMean: ["ST18 0PP"] });
  });

  it("takes the only address at a postcode without asking for a number", async () => {
    const t = setup({ findAddresses: async () => ({ ok: true, addresses: [ADDRESSES[4]] }) });
    expect(await t.execute("find_address", { postcode: "ST18 0PQ" })).toMatchObject({ found: true, address: "Rose Cottage, Smithy Lane, Hixon" });
    expect(t.draft.customer.addressLine1).toBe("Rose Cottage");
  });

  it("asks rather than guesses when a number covers a choice", async () => {
    const t = setup();
    const r = (await t.execute("add_items", { items: [{ code: "22", quantity: 1 }] })) as {
      results: Array<{ added: boolean; options?: string[] }>;
    };
    expect(r.results[0].added).toBe(false);
    expect(r.results[0].options).toEqual(["22 Crispy Aromatic Duck (Quarter)", "22 Crispy Aromatic Duck (Half)"]);
    const half = (await t.execute("add_items", { items: [{ code: "22", name: "half duck", quantity: 1 }] })) as {
      results: Array<{ added: boolean; price?: string }>;
    };
    expect(half.results[0]).toMatchObject({ added: true, price: "£18.50" });
  });

  it("will not sell a dish that has sold out", async () => {
    const t = setup();
    const r = (await t.execute("add_items", { items: [{ code: "99", quantity: 1 }] })) as { results: Array<{ added: boolean; problem?: string }> };
    expect(r.results[0]).toMatchObject({ added: false, problem: expect.stringContaining("sold out") });
  });

  it("joins repeats of the same dish into one line and can take one off", async () => {
    const t = setup();
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    expect(t.draft.lines).toHaveLength(1);
    expect(t.draft.lines[0].quantity).toBe(2);
    await t.execute("change_item", { line: 1, quantity: 0 });
    expect(t.draft.lines).toHaveLength(0);
  });

  it("holds back a delivery under the minimum", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "delivery" });
    await t.execute("set_customer_details", { name: "Sam", addressLine1: "1 High St", postcode: "ST18 0PP" });
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    const r = (await t.execute("confirm_order", {})) as { ready: boolean; problem: string };
    expect(r.ready).toBe(false);
    expect(r.problem).toContain("fifteen pounds");
    expect(t.placed).toHaveLength(0);
  });

  it("offers collection when the postcode is outside the area", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "delivery" });
    const r = (await t.execute("set_customer_details", { name: "Jo", addressLine1: "1 Bull Ring", postcode: "B5 4BU" })) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: false, problem: expect.stringContaining("offer collection") });
  });

  it("asks for what is missing instead of placing", async () => {
    const t = setup({ callerNumber: null });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    const r = (await t.execute("confirm_order", {})) as { ready: boolean; askFor: string[] };
    expect(r.ready).toBe(false);
    expect(t.placed).toHaveLength(0);
    expect(r.askFor).toEqual(["whether it is for collection or delivery", "the caller's name", "a contact phone number"]);
  });

  it("takes no order while the shop is closed", async () => {
    const t = setup({ orderingRefusal: async () => "The shop is closed and opens on Wednesday at 5pm." });
    expect(await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] })).toMatchObject({
      error: expect.stringContaining("closed"),
    });
  });

  it("adds to the same message when one is sent twice", async () => {
    const saveMessage = vi.fn(async () => "m1");
    const t = setup({ saveMessage });
    await t.execute("take_message", { name: "Pat", message: "Order 1001 was cold" });
    await t.execute("take_message", { message: "They'd like a call back" });
    expect(saveMessage).toHaveBeenLastCalledWith({
      id: "m1",
      name: "Pat",
      phone: "+447700900123",
      body: "Order 1001 was cold\nThey'd like a call back",
    });
  });
});

describe("the receptionist's instructions", () => {
  const hours = parseOpeningHours([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 1 || day === 2, open: "17:00", close: "21:30" })));

  it("greets as the shop and asks collection or delivery", () => {
    expect(greetingFor({ businessName: "Hixon Chinese Takeaway", custom: null, canOrder: true, closedReason: null })).toBe(
      "Hello, it's Hixon Chinese Takeaway. Is it for collection or delivery?"
    );
    expect(
      greetingFor({ businessName: "Hixon Chinese Takeaway", custom: null, canOrder: false, closedReason: "Sorry, we're closed at the moment; we open on Wednesday at 5pm." })
    ).toContain("we open on Wednesday at 5pm");
  });

  it("carries the menu with numbers and marks what has sold out", () => {
    const text = buildStableSystem({
      businessName: "Hixon Chinese Takeaway",
      notes: "Cash only.",
      hours,
      timeZone: "Europe/London",
      delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
      menu: [{ name: "Chow Mein", note: "Soft noodles", items: MENU }],
    });
    expect(text).toContain("- 147 Chicken Chow Mein: £6.90");
    expect(text).toContain("King Prawn Balls with Sweet & Sour Sauce: £7.70 SOLD OUT TONIGHT");
    expect(text).toContain("Monday and Tuesday: closed");
    expect(text).toContain("fifteen pounds");
  });

  it("tells it the shop is closed, and who is calling", () => {
    const ctx = buildCallContext({
      now: new Date("2026-10-12T18:00:00Z"), // a Monday
      timeZone: "Europe/London",
      hours,
      acceptingOrders: true,
      callerNumber: "+447700900123",
      returning: { name: "Sarah", address: "14 Smithy Lane, ST18 0PQ", lastOrder: null },
      waitMinutes: { collection: 20, delivery: 45 },
    });
    expect(ctx).toContain("closed right now and opens on Wednesday at 5pm");
    expect(ctx).toContain("Name on file: Sarah");
    expect(ctx).toContain("07700 900123");
  });
});

describe("a whole call through the engine", () => {
  /** A model that follows a script of tool calls and lines, one model turn per step. */
  function scripted(steps: Array<Anthropic.ContentBlock[]>): StreamingClient {
    let i = 0;
    return {
      messages: {
        stream() {
          const content = steps[i++] ?? [{ type: "text", text: "Anything else?", citations: null }];
          let onText: ((d: string) => void) | null = null;
          return {
            on(_e: "text", l: (d: string) => void) {
              onText = l;
              return this;
            },
            async finalMessage() {
              for (const b of content) if (b.type === "text") onText?.(b.text);
              return {
                id: `m${i}`,
                type: "message",
                role: "assistant",
                model: "scripted",
                content,
                stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              } as unknown as Anthropic.Message;
            },
          };
        },
      },
    };
  }
  const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;
  const say = (text: string) => ({ type: "text", text, citations: null }) as Anthropic.TextBlock;

  it("checks the order, agrees it on 'yes', says goodbye when the caller does, and sends it at the end", async () => {
    const placed: PlaceOrderInput[] = [];
    const tools = orderTools({
      menu: MENU,
      delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
      callerNumber: "+447700900123",
      turn: () => engine.turns,
      orderingRefusal: async () => null,
      waitMinutes: async () => ({ collection: 20, delivery: 45 }),
      placeOrder: async (input) => {
        placed.push(input);
        return { ok: true, order: { id: "o9", number: 1009, totalPence: 1160, deliveryFeePence: 0, promisedAt: new Date(), readyInMinutes: 20 } };
      },
      checkOrder: async () => ({ ok: true, totalPence: 1160, deliveryFeePence: 0, readyInMinutes: 20 }),
      recentOrders: async () => [],
      saveMessage: async () => "m",
      findAddresses: async () => ({ ok: false, reason: "not_configured" }),
    });
    const question = "So that's one Chicken Balls with Sweet & Sour Sauce and one Chicken & Sweet Corn Soup, for collection, is that correct?";
    const priceAndTime = "That's eleven pounds sixty, cash on collection. It'll be ready to collect in about 20 minutes.";
    const engine: ReceptionistEngine = new ReceptionistEngine({
      client: scripted([
        // 1 "Collection please, it's Dave."
        [use("a", "set_order_type", { type: "collection" }), use("b", "set_customer_details", { name: "Dave" })],
        [say("Thanks Dave. What would you like?")],
        // 2 "Chicken balls and a chicken and sweet corn soup."
        [use("c", "add_items", { items: [{ code: "98", quantity: 1 }, { code: "25", quantity: 1 }] })],
        [say("One Chicken Balls with Sweet & Sour Sauce and one Chicken & Sweet Corn Soup.")],
        // 3 "That's everything."
        [use("d", "confirm_order", {})],
        [say("Would you like any rice or chips with that?")],
        // 4 "No thanks." A model that jumps the gun takes the yes as given.
        [use("e", "confirm_order", {})],
        [use("f", "agree_order", {})],
        [say(question)],
        // 5 "Yes."
        [use("g", "agree_order", {})],
        [say(priceAndTime)],
        // 6 "Lovely, thanks, bye."
        [say("See you soon!"), use("h", "end_call", {})],
      ]),
      model: "scripted",
      system: [{ type: "text", text: "test" }],
      tools: [...ORDER_TOOLS, END_CALL_TOOL],
      execute: tools.execute,
      maxRoundTrips: 8,
    });

    await engine.respond("Collection please, it's Dave.");
    await engine.respond("Chicken balls and a chicken and sweet corn soup.");
    const t3 = await engine.respond("That's everything.");
    expect(t3.tools[0].result).toMatchObject({ ask: CARBS_QUESTION });

    const t4 = await engine.respond("No thanks.");
    expect(t4.tools.find((t) => t.name === "confirm_order")?.result).toMatchObject({ ready: true, say: question });
    expect(t4.tools.find((t) => t.name === "agree_order")?.result).toMatchObject({ agreed: false });
    expect(t4.text).toBe(question);

    const t5 = await engine.respond("Yes.");
    expect(t5.tools[0].result).toMatchObject({ agreed: true, say: priceAndTime });
    expect(t5.text).toBe(priceAndTime);
    expect(t5.endCall).toBe(false);

    const t6 = await engine.respond("Lovely, thanks, bye.");
    expect(t6.text).toBe("See you soon!");
    expect(t6.endCall).toBe(true);

    // Nothing has gone to the kitchen during the call: it goes as it ends.
    expect(placed).toHaveLength(0);
    expect(await tools.finish()).toEqual({ orderId: "o9", number: 1009 });
    expect(placed).toHaveLength(1);
    expect(placed[0].lines.map((l) => l.menuItemId)).toEqual(["cb", "soup"]);
  });
});

describe("the call log", () => {
  it("records an order sent at the end of the call in place of a bare goodbye", () => {
    expect(withOrder(["enquiry"], true)).toEqual(["ordered"]);
    expect(withOrder(["hung_up"], true)).toEqual(["ordered"]);
    expect(withOrder(["message"], true)).toEqual(["ordered", "message"]);
    expect(withOrder(["enquiry"], false)).toEqual(["enquiry"]);
  });
});
