import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { END_CALL_TOOL, ReceptionistEngine, type StreamingClient } from "./engine";
import { CARBS_QUESTION, ORDER_TOOLS, orderTools, type OrderToolDeps } from "./order-tools";
import { buildCallContext, buildStableSystem, greetingFor } from "./prompt";
import { MOCK_HIXON_ZONES } from "@/lib/delivery";
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
];

function setup(over: Partial<OrderToolDeps> = {}) {
  const placed: PlaceOrderInput[] = [];
  const amended: Array<{ orderId: string; input: PlaceOrderInput }> = [];
  const deps: OrderToolDeps = {
    menu: MENU,
    delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
    callerNumber: "+447700900123",
    orderingRefusal: async () => null,
    waitMinutes: async () => ({ collection: 20, delivery: 45 }),
    placeOrder: async (input) => {
      placed.push(input);
      return { ok: true, order: { id: "o1", number: 1042, totalPence: 0, deliveryFeePence: 150, promisedAt: new Date(), readyInMinutes: 45 } };
    },
    amendOrder: async (orderId, input) => {
      amended.push({ orderId, input });
      return { ok: true, order: { id: orderId, number: 1042, totalPence: 0, deliveryFeePence: 150, promisedAt: new Date(), readyInMinutes: 40 } };
    },
    recentOrders: async () => [],
    saveMessage: vi.fn(async () => "m1"),
    ...over,
  };
  const tools = orderTools(deps);
  return { ...tools, placed, amended };
}

describe("taking an order", () => {
  it("takes a delivery from start to finish: places on 'that's everything', then reads back", async () => {
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

    // "That's everything": straight to the kitchen, no "is that right?".
    const placed = (await t.execute("place_order", {})) as { success: boolean; orderNumber: number; readBack: string; then: string };
    expect(placed).toMatchObject({ success: true, orderNumber: 1042 });
    expect(placed.readBack).toBe(
      "So that's two Chicken Chow Mein and one Egg Fried Rice, for delivery to 14 Smithy Lane, ST18 0PQ. " +
        "That's eighteen pounds sixty including one pound fifty delivery, cash on delivery. " +
        "It'll be with you in about 45 minutes. See you soon!"
    );
    expect(placed.then).toContain("end_call");
    expect(t.placed[0]).toMatchObject({
      type: "delivery",
      customer: { name: "Sarah", phone: "+447700900123", postcode: "ST18 0PQ" },
      lines: [
        { menuItemId: "cm", quantity: 2 },
        { menuItemId: "efr", quantity: 1 },
      ],
    });
    // Asked again with nothing changed: the same order, not a second one.
    expect(await t.execute("place_order", {})).toMatchObject({ success: true, orderNumber: 1042 });
    expect(t.placed).toHaveLength(1);
    expect(t.amended).toHaveLength(0);
  });

  it("confirms only what was just added when a dish is added again", async () => {
    const t = setup();
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    const again = (await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] })) as { say: string };
    expect(again.say).toBe("One Chicken Chow Mein.");
    expect(t.draft.lines[0].quantity).toBe(2);
  });

  it("corrects the order already sent when the caller hears a mistake in the read-back", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    await t.execute("place_order", {}); // "Would you like any rice or chips?" "No thanks."
    await t.execute("place_order", {});
    // "No, I said two."
    const changed = (await t.execute("change_item", { line: 1, quantity: 2 })) as { note?: string };
    expect(changed.note).toContain("place_order again");
    const again = (await t.execute("place_order", {})) as { success: boolean; readBack: string };
    expect(again.success).toBe(true);
    expect(again.readBack).toContain("two Sweet & Sour Chicken Hong Kong Style, for collection");
    expect(t.placed).toHaveLength(1);
    expect(t.amended).toEqual([{ orderId: "o1", input: expect.objectContaining({ lines: [{ menuItemId: "ss", quantity: 2, notes: null }] }) }]);
  });

  it("says so when a correction comes too late", async () => {
    const t = setup({
      amendOrder: async () => ({ ok: false, code: "started", message: "The kitchen has already started that order." }),
    });
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    await t.execute("place_order", {}); // the rice question
    await t.execute("place_order", {});
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    expect(await t.execute("place_order", {})).toMatchObject({ success: false, then: expect.stringContaining("take a message") });
  });

  it("offers rice or chips once, when the caller has finished and ordered none", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    // While ordering, nothing is offered: just the dish.
    const added = (await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] })) as Record<string, unknown>;
    expect(added).not.toHaveProperty("ask");
    expect(added.say).toBe("One Sweet & Sour Chicken Hong Kong Style.");

    // "That's everything": asked instead of placed.
    expect(await t.execute("place_order", {})).toMatchObject({ success: false, ask: CARBS_QUESTION });
    expect(t.placed).toHaveLength(0);

    // "Yes, an egg fried rice": added and placed, with no second question.
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    const placed = (await t.execute("place_order", {})) as { success: boolean; readBack: string };
    expect(placed.success).toBe(true);
    expect(placed.readBack).toContain("one Sweet & Sour Chicken Hong Kong Style and one Egg Fried Rice");
    expect(t.placed[0].lines.map((l) => l.menuItemId)).toEqual(["ss", "efr"]);
  });

  it("places on 'no thanks' without asking again", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    expect(await t.execute("place_order", {})).toMatchObject({ ask: CARBS_QUESTION });
    expect(await t.execute("place_order", {})).toMatchObject({ success: true });
    expect(t.placed).toHaveLength(1);
  });

  it("does not offer rice or chips when the order already has some", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }, { code: "147", quantity: 1 }] });
    expect(await t.execute("place_order", {})).toMatchObject({ success: true });
  });

  it("asks for missing details before the rice question", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    expect(await t.execute("place_order", {})).toMatchObject({ success: false, askFor: ["the caller's name"] });
    await t.execute("set_customer_details", { name: "Dave" });
    expect(await t.execute("place_order", {})).toMatchObject({ ask: CARBS_QUESTION });
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
    const r = (await t.execute("place_order", {})) as { success: boolean; problem: string };
    expect(r.success).toBe(false);
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
    const r = (await t.execute("place_order", {})) as { success: boolean; askFor: string[] };
    expect(r.success).toBe(false);
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

  it("confirms each dish, then places, reads back and hangs up on 'that's everything'", async () => {
    const placed: PlaceOrderInput[] = [];
    const tools = orderTools({
      menu: MENU,
      delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
      callerNumber: "+447700900123",
      orderingRefusal: async () => null,
      waitMinutes: async () => ({ collection: 20, delivery: 45 }),
      placeOrder: async (input) => {
        placed.push(input);
        return { ok: true, order: { id: "o9", number: 1009, totalPence: 1030, deliveryFeePence: 0, promisedAt: new Date(), readyInMinutes: 20 } };
      },
      amendOrder: async () => {
        throw new Error("nothing to amend");
      },
      recentOrders: async () => [],
      saveMessage: async () => "m",
    });
    const readBack =
      "So that's one Sweet & Sour Chicken Hong Kong Style and one Egg Fried Rice, for collection. " +
      "That's ten pounds thirty, cash on collection. It'll be ready to collect in about 20 minutes. See you soon!";
    const engine: ReceptionistEngine = new ReceptionistEngine({
      client: scripted([
        // Turn 1: "Collection please, it's Dave."
        [use("t1", "set_order_type", { type: "collection" }), use("t2", "set_customer_details", { name: "Dave" })],
        [say("Thanks Dave. What would you like?")],
        // Turn 2: "Sweet and sour chicken please."
        [use("t3", "add_items", { items: [{ code: "94", quantity: 1 }] })],
        [say("One Sweet & Sour Chicken Hong Kong Style.")],
        // Turn 3: "And an egg fried rice, that's everything."
        [use("t4", "add_items", { items: [{ code: "170", quantity: 1 }] }), use("t5", "place_order", {})],
        [say(readBack), use("t6", "end_call", {})],
      ]),
      model: "scripted",
      system: [{ type: "text", text: "test" }],
      tools: [...ORDER_TOOLS, END_CALL_TOOL],
      execute: tools.execute,
      maxRoundTrips: 8,
    });

    await engine.respond("Collection please, it's Dave.");
    const t2 = await engine.respond("Sweet and sour chicken please.");
    expect(t2.tools[0].result).toMatchObject({ say: "One Sweet & Sour Chicken Hong Kong Style." });
    expect(placed).toHaveLength(0);

    const t3 = await engine.respond("And an egg fried rice, that's everything.");
    const place = t3.tools.find((t) => t.name === "place_order")?.result;
    expect(place).toMatchObject({ success: true, orderNumber: 1009, readBack });
    expect(placed).toHaveLength(1);
    expect(placed[0].lines.map((l) => l.menuItemId)).toEqual(["ss", "efr"]);
    expect(t3.text).toBe(readBack);
    expect(t3.endCall).toBe(true);
  });
});
