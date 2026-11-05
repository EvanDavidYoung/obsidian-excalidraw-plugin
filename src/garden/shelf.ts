import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import type { BinaryFileData, BinaryFiles } from "@zsviczian/excalidraw/types/excalidraw/types";

/**
 * The shelf: bits of drawings dragged into the queue sidebar, kept as the
 * Excalidraw elements themselves (and the pictures they use) so they can be
 * placed on any drawing later, exactly as they were.
 */
export type ShelfItem = {
  id: string;
  createdAt: number;
  /** The drawing they came from. */
  from: string;
  elements: ExcalidrawElement[];
  files: Record<string, BinaryFileData>;
};

type Loose = Record<string, any>;

function newId(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

/** What a drag of the selection carries: the selected elements, the text bound
 *  inside them, and everything in a selected frame. */
export function draggedElements(scene: readonly ExcalidrawElement[], selected: Readonly<Record<string, boolean>>) {
  const ids = new Set(Object.keys(selected).filter(id => selected[id]));
  return scene.filter(e => {
    if (e.isDeleted) return false;
    const loose = e as Loose;
    return ids.has(e.id) || ids.has(loose.containerId) || ids.has(loose.frameId);
  });
}

/** Garden cards go back to the queue as cards; anything else is shelved. */
export function splitCards(elements: readonly ExcalidrawElement[]) {
  const siteIds = new Set<string>();
  const rest: ExcalidrawElement[] = [];
  for (const e of elements) {
    const siteId = e.customData?.siteId;
    if (typeof siteId === "string") siteIds.add(siteId);
    else rest.push(e);
  }
  return { siteIds: [...siteIds], rest };
}

export function makeShelfItem(elements: readonly ExcalidrawElement[], files: BinaryFiles, from: string, now = Date.now()): ShelfItem {
  const used: Record<string, BinaryFileData> = {};
  for (const e of elements) {
    const fileId = (e as Loose).fileId;
    if (fileId && files[fileId]) used[fileId] = files[fileId];
  }
  return { id: newId(), createdAt: now, from, elements: elements.map(e => ({ ...e })), files: used };
}

/**
 * The elements again, ready to add to a drawing: fresh ids for every element
 * and group (so the same item can't clash with what's there), links between
 * them kept, links to anything left behind dropped, centred on (x, y).
 */
export function cloneForPlacement(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement[] {
  const ids = new Map(elements.map(e => [e.id, newId()]));
  const groups = new Map<string, string>();
  const group = (g: string) => groups.get(g) ?? (groups.set(g, newId()), groups.get(g)!);
  const binding = (b: Loose | null | undefined) =>
    b && ids.has(b.elementId) ? { ...b, elementId: ids.get(b.elementId) } : null;

  const minX = Math.min(...elements.map(e => e.x));
  const maxX = Math.max(...elements.map(e => e.x + e.width));
  const minY = Math.min(...elements.map(e => e.y));
  const maxY = Math.max(...elements.map(e => e.y + e.height));
  const dx = x - (minX + maxX) / 2;
  const dy = y - (minY + maxY) / 2;

  return elements.map(e => {
    const loose = e as Loose;
    const copy: Loose = {
      ...e,
      id: ids.get(e.id),
      x: e.x + dx,
      y: e.y + dy,
      groupIds: e.groupIds.map(group),
      boundElements: e.boundElements?.filter(b => ids.has(b.id)).map(b => ({ ...b, id: ids.get(b.id) })) ?? null,
      updated: Date.now(),
    };
    if ("containerId" in loose) copy.containerId = loose.containerId && ids.has(loose.containerId) ? ids.get(loose.containerId) : null;
    if ("frameId" in loose) copy.frameId = loose.frameId && ids.has(loose.frameId) ? ids.get(loose.frameId) : null;
    if ("startBinding" in loose) copy.startBinding = binding(loose.startBinding);
    if ("endBinding" in loose) copy.endBinding = binding(loose.endBinding);
    return copy as ExcalidrawElement;
  });
}
