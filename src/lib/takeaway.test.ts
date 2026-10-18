import { describe, expect, it } from "vitest";
import { normalisePostcode, quoteDelivery, tidyPrefix, zoneFor, MOCK_HIXON_ZONES, type DeliveryRules } from "./delivery";
import { describeHours, openStatus, parseOpeningHours, shopDayRange, spokenNextOpen, spokenTime } from "./hours";
import { findMenuItem, normaliseCode, type MenuEntry } from "./menu";
import { formatPence, parsePounds, spokenPrice } from "./money";
import { nextStatus } from "./orders";
import { HIXON_MENU } from "./menu-data/hixon";

const rules: DeliveryRules = { enabled: true, zones: MOCK_HIXON_ZONES, minOrderPence: 1500, freeOverPence: null };

describe("postcodes", () => {
  it("tidies however the postcode arrives", () => {
    expect(normalisePostcode("st180pp")).toEqual({ full: true, postcode: "ST18 0PP" });
    expect(normalisePostcode("ST 18 0PP")).toEqual({ full: true, postcode: "ST18 0PP" });
    expect(normalisePostcode("st16")).toEqual({ full: false, postcode: "ST16" });
    expect(normalisePostcode("hello")).toBeNull();
    expect(normalisePostcode("")).toBeNull();
  });

  it("takes the zone with the longest matching prefix", () => {
    expect(zoneFor(MOCK_HIXON_ZONES, "ST18 0PP")?.name).toBe("Hixon");
    expect(zoneFor(MOCK_HIXON_ZONES, "ST18 9AB")?.name).toBe("Nearby villages");
    expect(zoneFor(MOCK_HIXON_ZONES, "ST16 2AA")?.name).toBe("Stafford");
  });

  it("does not let a short outward code cover a longer one", () => {
    const zones = [{ name: "Stoke", prefixes: ["ST1"], feePence: 500 }];
    expect(zoneFor(zones, "ST18 0PP")).toBeNull();
    expect(zoneFor(zones, "ST1 4AB")?.name).toBe("Stoke");
  });

  it("tidies prefixes typed in settings", () => {
    expect(tidyPrefix("st18 0")).toBe("ST18 0");
    expect(tidyPrefix("st180")).toBe("ST18 0");
    expect(tidyPrefix("ST16")).toBe("ST16");
  });
});

describe("delivery quotes", () => {
  it("charges the zone fee and says how far short of the minimum an order is", () => {
    const q = quoteDelivery(rules, "ST18 0PP", 1200);
    expect(q).toMatchObject({ ok: true, zone: "Hixon", feePence: 150, shortByPence: 300 });
  });

  it("refuses postcodes outside every zone", () => {
    expect(quoteDelivery(rules, "B1 1AA", 3000)).toMatchObject({ ok: false, reason: "outside_area" });
  });

  it("delivers free over the threshold when there is one", () => {
    const q = quoteDelivery({ ...rules, freeOverPence: 3000 }, "ST16 1AA", 3000);
    expect(q).toMatchObject({ ok: true, feePence: 0, zoneFeePence: 350 });
  });

  it("refuses everything when delivery is switched off", () => {
    expect(quoteDelivery({ ...rules, enabled: false }, "ST18 0PP", 3000)).toMatchObject({ ok: false, reason: "disabled" });
  });
});

describe("opening hours", () => {
  // Hixon: Monday and Tuesday closed, Wednesday to Sunday 5pm to 9:30pm.
  const hours = parseOpeningHours(
    [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 1 || day === 2, open: "17:00", close: "21:30" }))
  );
  const tz = "Europe/London";

  it("is open on a Wednesday evening", () => {
    // Wednesday 15 October 2026, 18:00 BST = 17:00 UTC.
    expect(openStatus(hours, tz, new Date("2026-10-14T17:00:00Z"))).toMatchObject({ open: true, closes: "21:30" });
  });

  it("is closed at half past nine on the dot", () => {
    expect(openStatus(hours, tz, new Date("2026-10-14T20:30:00Z")).open).toBe(false);
  });

  it("says when it next opens from a closed Monday", () => {
    const s = openStatus(hours, tz, new Date("2026-10-12T18:00:00Z"));
    expect(s.open).toBe(false);
    expect(spokenNextOpen(s)).toBe("on Wednesday at 5pm");
  });

  it("says today when it opens later today", () => {
    expect(spokenNextOpen(openStatus(hours, tz, new Date("2026-10-14T11:00:00Z")))).toBe("today at 5pm");
  });

  it("follows the shop's wall clock across the clocks changing", () => {
    // Sunday 25 October 2026: the clocks go back. 17:30 GMT is 17:30 UTC.
    expect(openStatus(hours, tz, new Date("2026-10-25T17:30:00Z")).open).toBe(true);
    // Saturday 24 October, 16:30 UTC is 17:30 BST: open.
    expect(openStatus(hours, tz, new Date("2026-10-24T16:30:00Z")).open).toBe(true);
  });

  it("keeps a shop open past midnight on the next day", () => {
    const late = parseOpeningHours([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: false, open: "17:00", close: "01:00" })));
    // Sunday 18 October 2026, 00:30 BST = Saturday 23:30 UTC.
    expect(openStatus(late, tz, new Date("2026-10-17T23:30:00Z")).open).toBe(true);
  });

  it("says times and the week as a person would", () => {
    expect(spokenTime("17:00")).toBe("5pm");
    expect(spokenTime("21:30")).toBe("half past 9");
    expect(spokenTime("21:45")).toBe("quarter to 10");
    expect(describeHours(hours)).toBe("Monday and Tuesday: closed. Wednesday to Sunday: 5pm to half past 9");
  });

  it("starts the shop's day at its own midnight, summer and winter", () => {
    expect(shopDayRange("2026-10-18", tz)).toEqual({
      start: new Date("2026-10-17T23:00:00Z"),
      end: new Date("2026-10-18T23:00:00Z"),
    });
    // The clocks go back overnight on the 25th: a 25-hour day.
    expect(shopDayRange("2026-10-25", tz)).toEqual({
      start: new Date("2026-10-24T23:00:00Z"),
      end: new Date("2026-10-26T00:00:00Z"),
    });
    expect(shopDayRange("not a date", tz)).toBeNull();
  });

  it("treats a day with nothing usable as closed", () => {
    expect(parseOpeningHours([{ day: 3, open: "nonsense" }])[3].closed).toBe(false);
    expect(parseOpeningHours([])[3].closed).toBe(true);
  });
});

describe("money", () => {
  it("says prices the way people do", () => {
    expect(spokenPrice(760)).toBe("seven pounds sixty");
    expect(spokenPrice(2850)).toBe("twenty-eight pounds fifty");
    expect(spokenPrice(1000)).toBe("ten pounds");
    expect(spokenPrice(80)).toBe("eighty pence");
    expect(spokenPrice(105)).toBe("one pound five");
    expect(formatPence(690)).toBe("£6.90");
  });

  it("reads prices typed in the CRM", () => {
    expect(parsePounds("7.6")).toBe(760);
    expect(parsePounds("£11")).toBe(1100);
    expect(parsePounds("7.605")).toBeNull();
  });
});

describe("the menu", () => {
  const menu: MenuEntry[] = HIXON_MENU.flatMap((c, ci) =>
    c.items.map(([code, name, pounds], ii) => ({
      id: `${ci}-${ii}`,
      code,
      name,
      description: null,
      pricePence: Math.round(pounds * 100),
      available: true,
      aliases: [],
      category: c.name,
    }))
  );

  it("transcribes every price as whole pence", () => {
    for (const m of menu) expect(Number.isInteger(m.pricePence) && m.pricePence > 0).toBe(true);
  });

  it("finds a dish by its number, however it is said", () => {
    expect(normaliseCode("number 65a")).toBe("65a");
    expect(normaliseCode("No. 65A")).toBe("65a");
    const m = findMenuItem(menu, { code: "65a" });
    expect(m.kind === "found" && m.item.name).toBe("Roast Pork with Mushroom in Black Bean Sauce");
  });

  it("asks which one when a number covers a choice", () => {
    const m = findMenuItem(menu, { code: "22" });
    expect(m.kind).toBe("choose");
    const half = findMenuItem(menu, { code: "22", name: "half crispy aromatic duck" });
    expect(half.kind === "found" && half.item.pricePence).toBe(1850);
  });

  it("matches a dish by name without mistaking it for the house special", () => {
    const m = findMenuItem(menu, { name: "chicken chow mein" });
    expect(m.kind === "found" && m.item.code).toBe("147");
  });

  it("lists the options when a name is too vague", () => {
    const m = findMenuItem(menu, { name: "chicken curry" });
    expect(m.kind === "found" && m.item.code).toBe("108");
    const vague = findMenuItem(menu, { name: "spare ribs" });
    expect(vague.kind).toBe("choose");
  });

  it("asks when the number and the name point at different dishes", () => {
    const m = findMenuItem(menu, { code: "146", name: "Chicken Chow Mein" });
    expect(m.kind).toBe("choose");
    expect(m.kind === "choose" && m.options.map((o) => o.code)).toEqual(["146", "147"]);
    // A loose name that still fits the number is fine.
    const ok = findMenuItem(menu, { code: "147", name: "chow mein" });
    expect(ok.kind === "found" && ok.item.code).toBe("147");
  });

  it("finds set meals by letter and says nothing for dishes we don't do", () => {
    const a = findMenuItem(menu, { code: "A" });
    expect(a.kind === "found" && a.item.pricePence).toBe(2850);
    expect(findMenuItem(menu, { name: "pizza" }).kind).toBe("none");
  });
});

describe("order status", () => {
  it("moves collections and deliveries along their own paths", () => {
    expect(nextStatus("collection", "ready")).toBe("completed");
    expect(nextStatus("delivery", "ready")).toBe("out_for_delivery");
    expect(nextStatus("delivery", "out_for_delivery")).toBe("completed");
    expect(nextStatus("collection", "completed")).toBeNull();
  });
});
