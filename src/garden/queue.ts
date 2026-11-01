import type { OrderedExcalidrawElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import type { Site } from "./sites";

/** When each site's newest (non-deleted) box was placed, by site id, in ms.
 *  A box from before boxes were dated goes by when it last changed. */
export function placedSiteIds(elements: readonly OrderedExcalidrawElement[]) {
  const placed = new Map<string, number>();
  for (const el of elements) {
    const siteId = el.customData?.siteId;
    if (el.isDeleted || typeof siteId !== "string") continue;
    const at = typeof el.customData?.placedAt === "number" ? el.customData.placedAt : el.updated ?? 0;
    placed.set(siteId, Math.max(placed.get(siteId) ?? 0, at));
  }
  return placed;
}

/** The queue, in list order: every site with no box placed since it was last
 *  sent. Sending a placed site again brings it back for another copy. */
export function queuedSites(sites: readonly Site[], placed: ReadonlyMap<string, number>) {
  return sites.filter(s => {
    const at = placed.get(s.id);
    return at === undefined || at < (s.sentAt ?? 0);
  });
}

/** Placements from several places (the saved record, each open drawing) as one:
 *  every site placed anywhere, at the latest time it was placed. */
export function mergePlaced(...sources: ReadonlyMap<string, number>[]) {
  const all = new Map<string, number>();
  for (const source of sources) {
    for (const [id, at] of source) all.set(id, Math.max(all.get(id) ?? 0, at));
  }
  return all;
}
