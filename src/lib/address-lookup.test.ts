import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupPostcode, matchAddress, nearestNames, titleCase } from "./address-lookup";
import { ADDRESSES, NAMED, RAW } from "./address-lookup.fixtures";


describe("reading addresses", () => {
  it("keeps the lines, title-cases the town and keeps the parts for matching", () => {
    expect(ADDRESSES[2]).toEqual({
      line1: "Flat 1",
      line2: "16 Smithy Lane, Hixon",
      town: "Stafford",
      postcode: "ST18 0PQ",
      number: "16",
      building: null,
      subBuilding: "Flat 1",
      street: "Smithy Lane",
    });
    expect(titleCase("NEWCASTLE-UNDER-LYME")).toBe("Newcastle-under-Lyme");
  });
});

describe("finding the caller's address", () => {
  const line = (m: ReturnType<typeof matchAddress>) => (m.kind === "found" ? `${m.address.line1}, ${m.address.line2}` : m.kind);

  it("by house number, on the street given when the postcode covers two", () => {
    expect(line(matchAddress(ADDRESSES, { house: "12" }))).toBe("12 Smithy Lane, Hixon");
    expect(matchAddress(ADDRESSES, { house: "14" }).kind).toBe("choose");
    expect(line(matchAddress(ADDRESSES, { house: "number 14", street: "Church Road" }))).toBe("14 Church Road, Hixon");
  });

  it("by a number with a letter, and by house name", () => {
    expect(line(matchAddress(ADDRESSES, { house: "2A" }))).toBe("2a Church Road, Hixon");
    expect(line(matchAddress(ADDRESSES, { house: "rose cottage" }))).toBe("Rose Cottage, Smithy Lane, Hixon");
  });

  it("asks which flat when only the building number is given", () => {
    const m = matchAddress(ADDRESSES, { house: "16" });
    expect(m.kind === "choose" && m.options.map((a) => a.line1)).toEqual(["Flat 1", "Flat 2"]);
    expect(line(matchAddress(ADDRESSES, { house: "flat 2, 16" }))).toBe("Flat 2, 16 Smithy Lane, Hixon");
  });

  it("finds nothing for a number that isn't there", () => {
    expect(matchAddress(ADDRESSES, { house: "99" }).kind).toBe("none");
    expect(matchAddress(ADDRESSES, { house: "" }).kind).toBe("none");
  });
});

describe("finding a house by its name", () => {
  const found = (house: string) => {
    const m = matchAddress(NAMED, { house });
    return m.kind === "found" ? m.address.line1 : m.kind === "choose" ? m.options.map((a) => a.line1) : "none";
  };

  it("with or without 'the', and with the street said too", () => {
    expect(found("The Old Forge")).toBe("The Old Forge");
    expect(found("old forge")).toBe("The Old Forge");
    expect(found("Rose Cottage, Smithy Lane, Hixon")).toBe("Rose Cottage");
  });

  it("when the recogniser gets a letter or an ending wrong", () => {
    expect(found("hollys")).toBe("The Hollies");
    expect(found("holly's")).toBe("The Hollies");
    expect(found("rose cotage")).toBe("Rose Cottage");
    expect(found("hollis")).toBe("The Hollies");
  });

  it("run together or split apart, or with a word too many", () => {
    expect(found("wood lands")).toBe("Woodlands");
    expect(found("the old forge house")).toBe("The Old Forge");
  });

  it("by the name or the number of a house that has both", () => {
    expect(found("meadow view")).toBe("Meadow View, 7 Smithy Lane");
    expect(found("7")).toBe("Meadow View, 7 Smithy Lane");
  });

  it("asks when part of a name fits two houses, and picks the one named in full", () => {
    expect(found("ivy")).toEqual(["Ivy House", "Ivy Cottage"]);
    expect(found("ivy house")).toBe("Ivy House");
    expect(found("rose villa")).toBe("Rose Villa");
  });

  it("doesn't stretch a name into a different house", () => {
    expect(found("the willows")).toBe("none");
    expect(found("forge cottage")).toBe("none");
  });

  it("takes a near name only when the exact one isn't there", () => {
    // No Ross Cottage here: almost certainly Rose Cottage misheard, and the
    // receptionist says the address back for the caller to correct.
    expect(found("ross cottage")).toBe("Rose Cottage");
    const both = [...NAMED, { ...NAMED[5], line1: "Ross Cottage", building: "Ross Cottage" }];
    const m = matchAddress(both, { house: "ross cottage" });
    expect(m.kind === "found" && m.address.line1).toBe("Ross Cottage");
  });

  it("offers the nearest names when nothing matches", () => {
    expect(nearestNames(NAMED, "the hollows").map((a) => a.line1)).toEqual(["The Hollies"]);
    expect(nearestNames(NAMED, "the willows").map((a) => a.line1)).not.toContain("Ivy House");
    expect(nearestNames(NAMED, "xy")).toEqual([]);
  });
});

describe("looking up a postcode", () => {
  // The URL is taken so the test can check what was asked for.
  const ok = (body: unknown, status = 200) =>
    vi.fn(async (url: RequestInfo | URL) => {
      void url;
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    });

  beforeEach(() => {
    (globalThis as { __postcodeCache?: Map<string, unknown> }).__postcodeCache?.clear();
  });

  it("says so when there is no key, without calling anyone", async () => {
    const fetch = ok({});
    expect(await lookupPostcode("ST18 0PQ", { apiKey: "", fetch })).toEqual({ ok: false, reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the addresses, and remembers them for a day", async () => {
    const fetch = ok({ result: RAW, code: 2000 });
    const first = await lookupPostcode("st180pq", { apiKey: "ak_test", fetch, now: 0 });
    expect(first.ok && first.addresses).toHaveLength(7);
    expect(fetch.mock.calls[0][0]).toBe("https://api.ideal-postcodes.co.uk/v1/postcodes/ST18%200PQ?api_key=ak_test");
    await lookupPostcode("ST18 0PQ", { apiKey: "ak_test", fetch, now: 3600_000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await lookupPostcode("ST18 0PQ", { apiKey: "ak_test", fetch, now: 25 * 3600_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes on the provider's suggestions for a postcode it doesn't know", async () => {
    const fetch = ok({ code: 4040, message: "Postcode not found", suggestions: ["ST18 0PP"] }, 404);
    expect(await lookupPostcode("ST18 0PX", { apiKey: "ak_test", fetch })).toEqual({ ok: false, reason: "not_found", suggestions: ["ST18 0PP"] });
  });

  it("carries on without when the provider fails or can't be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await lookupPostcode("ST18 0PQ", { apiKey: "ak_test", fetch: ok({ code: 4020 }, 402) })).toEqual({ ok: false, reason: "unavailable" });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await lookupPostcode("ST18 0PQ", { apiKey: "ak_test", fetch: down })).toEqual({ ok: false, reason: "unavailable" });
  });
});
