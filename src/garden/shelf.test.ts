import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import { cloneForPlacement, draggedElements, makeShelfItem, splitCards } from "./shelf";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false, groupIds: [], boundElements: null, ...extra }) as unknown as ExcalidrawElement;

describe("draggedElements", () => {
  it("takes the selection with its bound text and frame contents, nothing else", () => {
    const scene = [
      el("box", { boundElements: [{ id: "label", type: "text" }] }),
      el("label", { type: "text", containerId: "box" }),
      el("frame", { type: "frame" }),
      el("inside", { frameId: "frame" }),
      el("other"),
      el("gone", { isDeleted: true }),
    ];
    const ids = draggedElements(scene, { box: true, frame: true, gone: true }).map(e => e.id);
    expect(ids.sort()).toEqual(["box", "frame", "inside", "label"]);
  });
});

describe("splitCards", () => {
  it("separates garden cards (by site id) from everything else", () => {
    const { siteIds, rest } = splitCards([
      el("c1", { customData: { siteId: "s1" } }),
      el("c2", { customData: { siteId: "s1" } }),
      el("mine"),
    ]);
    expect(siteIds).toEqual(["s1"]);
    expect(rest.map(e => e.id)).toEqual(["mine"]);
  });
});

describe("makeShelfItem", () => {
  it("keeps only the pictures its image elements use", () => {
    const item = makeShelfItem([el("pic", { type: "image", fileId: "f1" })], {
      f1: { id: "f1", dataURL: "data:x", mimeType: "image/png", created: 1 },
      f2: { id: "f2", dataURL: "data:y", mimeType: "image/png", created: 1 },
    } as never, "Drawing", 42);
    expect(Object.keys(item.files)).toEqual(["f1"]);
    expect(item).toMatchObject({ from: "Drawing", createdAt: 42 });
    expect(item.id).toMatch(/\w{6,}/);
  });
});

describe("cloneForPlacement", () => {
  const source = [
    el("box", { x: 100, y: 100, width: 40, height: 20, groupIds: ["g"], boundElements: [{ id: "label", type: "text" }, { id: "arrow", type: "arrow" }] }),
    el("label", { type: "text", x: 105, y: 105, width: 30, height: 10, groupIds: ["g"], containerId: "box" }),
    el("arrow", { type: "arrow", x: 140, y: 110, width: 60, height: 0, startBinding: { elementId: "box", focus: 0, gap: 1 }, endBinding: { elementId: "elsewhere", focus: 0, gap: 1 } }),
  ];

  it("gives every element and group a fresh id, keeping the links between them", () => {
    const out = cloneForPlacement(source, 0, 0);
    const ids = out.map(e => e.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(["box", "label", "arrow"]).not.toContain(id);
    const [box, label, arrow] = out as any[];
    expect(label.containerId).toBe(box.id);
    expect(box.boundElements.map((b: any) => b.id)).toEqual([label.id, arrow.id]);
    expect(arrow.startBinding.elementId).toBe(box.id);
    expect(box.groupIds).toEqual(label.groupIds);
    expect(box.groupIds[0]).not.toBe("g");
  });

  it("drops a binding to something that didn't come along", () => {
    const arrow = cloneForPlacement(source, 0, 0)[2] as any;
    expect(arrow.endBinding).toBeNull();
  });

  it("centres the whole thing on the drop point", () => {
    const out = cloneForPlacement(source, 1000, 500);
    const minX = Math.min(...out.map(e => e.x)), maxX = Math.max(...out.map(e => e.x + e.width));
    const minY = Math.min(...out.map(e => e.y)), maxY = Math.max(...out.map(e => e.y + e.height));
    expect((minX + maxX) / 2).toBe(1000);
    expect((minY + maxY) / 2).toBe(500);
  });
});
