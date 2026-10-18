import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ReceptionistEngine, type StreamingClient } from "./engine";
import { ORDER_TOOLS, orderTools, type OrderToolDeps } from "./order-tools";
import { buildCallContext, buildStableSystem, greetingFor } from "./prompt";
import { MOCK_HIXON_ZONES } from "@/lib/delivery";
import { parseOpeningHours } from "@/lib/hours";
import type { MenuEntry } from "@/lib/menu";
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
  let turn = 1;
  const placed: PlaceOrderInput[] = [];
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
    recentOrders: async () => [],
    saveMessage: vi.fn(async () => "m1"),
    ...over,
  };
  const tools = orderTools(deps);
  return { ...tools, placed, nextTurn: () => turn++ };
}

describe("taking an order", () => {
  it("takes a delivery from start to finish, with the read-back confirmed before placing", async () => {
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
    })) as { results: Array<{ added: boolean }>; order: { total: string } };
    expect(added.results.every((r) => r.added)).toBe(true);
    // 2 x 6.90 + 3.30 = 17.10, plus 1.50 delivery.
    expect(added.order.total).toBe("£18.60");

    const review = (await t.execute("review_order", {})) as { ready: boolean; readBack: string };
    expect(review.ready).toBe(true);
    expect(review.readBack).toContain("2 Chicken Chow Mein");
    expect(review.readBack).toContain("14 Smithy Lane, ST18 0PQ");
    expect(review.readBack).toContain("eighteen pounds sixty altogether, paid in cash");
    expect(review.readBack).toContain("about 45 minutes");

    // Same breath as the read-back: refused.
    expect(await t.execute("place_order", {})).toMatchObject({ error: expect.stringContaining("wait for the caller") });
    t.nextTurn(); // "Yes, that's right."
    expect(await t.execute("place_order", {})).toMatchObject({ success: true, orderNumber: 1042 });
    expect(t.placed[0]).toMatchObject({
      type: "delivery",
      customer: { name: "Sarah", phone: "+447700900123", postcode: "ST18 0PQ" },
      lines: [
        { menuItemId: "cm", quantity: 2 },
        { menuItemId: "efr", quantity: 1 },
      ],
    });
    // And never twice.
    t.nextTurn();
    expect(await t.execute("place_order", {})).toMatchObject({ error: expect.stringContaining("already been placed") });
  });

  it("needs a fresh read-back after the order changes", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "collection" });
    await t.execute("set_customer_details", { name: "Dave" });
    await t.execute("add_items", { items: [{ code: "94", quantity: 1 }] });
    await t.execute("review_order", {});
    t.nextTurn(); // "Oh, and an egg fried rice."
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    expect(await t.execute("place_order", {})).toMatchObject({ error: expect.stringContaining("not been read back") });
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

  it("holds a delivery under the minimum back at the read-back", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "delivery" });
    await t.execute("set_customer_details", { name: "Sam", addressLine1: "1 High St", postcode: "ST18 0PP" });
    await t.execute("add_items", { items: [{ code: "170", quantity: 1 }] });
    const r = (await t.execute("review_order", {})) as { ready: boolean; problem: string };
    expect(r.ready).toBe(false);
    expect(r.problem).toContain("fifteen pounds");
  });

  it("offers collection when the postcode is outside the area", async () => {
    const t = setup();
    await t.execute("set_order_type", { type: "delivery" });
    const r = (await t.execute("set_customer_details", { name: "Jo", addressLine1: "1 Bull Ring", postcode: "B5 4BU" })) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: false, problem: expect.stringContaining("offer collection") });
  });

  it("asks for what is missing instead of reading back", async () => {
    const t = setup({ callerNumber: null });
    await t.execute("add_items", { items: [{ code: "147", quantity: 1 }] });
    const r = (await t.execute("review_order", {})) as { ready: boolean; askFor: string[] };
    expect(r.ready).toBe(false);
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

  it("only places the order on the caller's own turn after the read-back", async () => {
    const placed: PlaceOrderInput[] = [];
    let engine: ReceptionistEngine;
    const tools = orderTools({
      menu: MENU,
      delivery: { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null },
      callerNumber: "+447700900123",
      turn: () => engine.turns,
      orderingRefusal: async () => null,
      waitMinutes: async () => ({ collection: 20, delivery: 45 }),
      placeOrder: async (input) => {
        placed.push(input);
        return { ok: true, order: { id: "o9", number: 1009, totalPence: 1020, deliveryFeePence: 0, promisedAt: new Date(), readyInMinutes: 20 } };
      },
      recentOrders: async () => [],
      saveMessage: async () => "m",
    });
    engine = new ReceptionistEngine({
      client: scripted([
        // Turn 1: "Collection please, it's Dave."
        [use("t1", "set_order_type", { type: "collection" }), use("t2", "set_customer_details", { name: "Dave" })],
        [say("Thanks Dave. What would you like?")],
        // Turn 2: "Sweet and sour chicken and egg fried rice, that's all."
        [use("t3", "add_items", { items: [{ code: "94", quantity: 1 }, { code: "170", quantity: 1 }] })],
        [use("t4", "review_order", {})],
        // A model that jumps the gun: tries to place in the same turn.
        [use("t5", "place_order", {})],
        [say("So that's a sweet and sour chicken and an egg fried rice for collection, ten pounds thirty. Is that right?")],
        // Turn 3: "Yes."
        [use("t6", "place_order", {})],
        [say("Lovely, that's in. Order 1009, ready in about twenty minutes, cash on collection.")],
      ]),
      model: "scripted",
      system: [{ type: "text", text: "test" }],
      tools: ORDER_TOOLS,
      execute: tools.execute,
      maxRoundTrips: 8,
    });

    await engine.respond("Collection please, it's Dave.");
    const t2 = await engine.respond("Sweet and sour chicken and egg fried rice, that's all.");
    expect(t2.tools.find((t) => t.name === "place_order")?.result).toMatchObject({ error: expect.any(String) });
    expect(placed).toHaveLength(0);

    const t3 = await engine.respond("Yes.");
    expect(t3.tools.find((t) => t.name === "place_order")?.result).toMatchObject({ success: true, orderNumber: 1009 });
    expect(placed).toHaveLength(1);
    expect(placed[0].lines.map((l) => l.menuItemId)).toEqual(["ss", "efr"]);
  });
});
