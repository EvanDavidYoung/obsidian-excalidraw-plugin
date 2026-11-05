import { describe, expect, it } from "vitest";
import type { OrderedExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import { placedSiteIds, queuedSites } from "./queue";
import type { Site } from "./sites";

const el = (props: Partial<OrderedExcalidrawElement>) =>
  ({ isDeleted: false, customData: undefined, ...props }) as OrderedExcalidrawElement;

describe("placedSiteIds", () => {
  it("collects the site id of each box on the canvas once, with its newest placing", () => {
    const ids = placedSiteIds([
      el({ customData: { siteId: "a", placedAt: 100 } }),
      el({ customData: { siteId: "a", placedAt: 300 } }),
      el({ customData: { siteId: "b", placedAt: 200 } }),
    ]);
    expect([...ids].sort()).toEqual([["a", 300], ["b", 200]]);
  });

  it("dates a box from before boxes were dated by when it last changed", () => {
    expect(placedSiteIds([el({ customData: { siteId: "a" }, updated: 50 })]).get("a")).toBe(50);
  });

  it("ignores deleted elements, so deleting a box re-queues the site", () => {
    const ids = placedSiteIds([el({ customData: { siteId: "a" }, isDeleted: true })]);
    expect(ids.size).toBe(0);
  });

  it("ignores things the user drew themselves", () => {
    const ids = placedSiteIds([el({}), el({ customData: { note: "mine" } }), el({ customData: { siteId: 7 } })]);
    expect(ids.size).toBe(0);
  });
});

describe("queuedSites", () => {
  const sites = ["a", "b", "c"].map(id => ({ id, name: id, url: `https://${id}.test` }) as Site);

  it("keeps sites without a box, in list order", () => {
    expect(queuedSites(sites, new Map([["b", 1]])).map(s => s.id)).toEqual(["a", "c"]);
  });

  it("is empty once everything is on the canvas", () => {
    expect(queuedSites(sites, new Map([["a", 1], ["b", 1], ["c", 1]]))).toEqual([]);
  });

  it("brings a placed site back once it's sent again, for another copy", () => {
    const resent = { ...sites[0], sentAt: 500 };
    expect(queuedSites([resent], new Map([["a", 400]]))).toEqual([resent]);
    // Placing that copy takes it back out.
    expect(queuedSites([resent], new Map([["a", 600]]))).toEqual([]);
  });
});

describe("mergePlaced", () => {
  it("keeps every site placed anywhere, at its latest placing", async () => {
    const { mergePlaced } = await import("./queue");
    const ledger = new Map([["a", 5], ["b", 1]]);
    const drawing1 = new Map([["b", 9]]);
    const drawing2 = new Map([["c", 3], ["a", 2]]);
    expect(mergePlaced(ledger, drawing1, drawing2)).toEqual(new Map([["a", 5], ["b", 9], ["c", 3]]));
  });
});
