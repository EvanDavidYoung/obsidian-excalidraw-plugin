import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueView, type QueueHost } from "./queueView";
import type { ShelfItem } from "./shelf";
import type { Site } from "./sites";

const site = (id: string): Site => ({ id, name: `Card ${id}`, url: "https://example.com" });

// jsdom has no PointerEvent; a MouseEvent with the pointer fields stands in.
function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.assign(e, { pointerId: 1 });
  return e;
}

async function openQueue(host: Partial<QueueHost> = {}) {
  const full: QueueHost = {
    queued: vi.fn(async () => ({ cards: [site("a"), site("b")], shelf: [], target: "Drawing" })),
    pick: vi.fn(async () => {}),
    drop: vi.fn(async () => true),
    pickShelf: vi.fn(async () => {}),
    dropShelf: vi.fn(async () => true),
    preview: vi.fn(async () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("data-preview", "1"); return s; }),
    ...host,
  };
  const view = new QueueView({} as never, full);
  HTMLElement.prototype.setPointerCapture ??= () => {};
  await view.onOpen();
  return { view, host: full, cards: () => [...view.contentEl.querySelectorAll<HTMLElement>(".garden-queue-card")] };
}

const ghosts = () => document.querySelectorAll(".garden-queue-ghost").length;

describe("QueueView drag", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("drops the card and clears its ghost even if the queue refreshes mid-drag", async () => {
    const { view, host, cards } = await openQueue();
    cards()[0].dispatchEvent(pointer("pointerdown", 10, 10));
    document.dispatchEvent(pointer("pointermove", 60, 60));
    expect(ghosts()).toBe(1);
    await view.refresh(); // the 30 s timer or a scene change, while the card is held
    document.dispatchEvent(pointer("pointerup", 300, 200));
    await vi.waitFor(() => expect(host.drop).toHaveBeenCalledWith(site("a"), 300, 200));
    expect(ghosts()).toBe(0);
  });

  it("doesn't redraw the list under a held card, but catches up after", async () => {
    const queued = vi.fn(async () => ({ cards: [site("a"), site("b")], shelf: [] as never[], target: "Drawing" }));
    const { view, cards } = await openQueue({ queued, drop: vi.fn(async () => false) });
    const held = cards()[0];
    held.dispatchEvent(pointer("pointerdown", 10, 10));
    document.dispatchEvent(pointer("pointermove", 60, 60));
    queued.mockResolvedValue({ cards: [site("b")], shelf: [], target: "Drawing" });
    await view.refresh();
    expect(held.isConnected).toBe(true);
    document.dispatchEvent(pointer("pointerup", 300, 200));
    await vi.waitFor(() => expect(cards().map(c => c.textContent)).toEqual([expect.stringContaining("Card b")]));
  });
});

describe("QueueView shelf", () => {
  afterEach(() => { document.body.replaceChildren(); });

  const item: ShelfItem = { id: "i1", createdAt: 1, from: "Sketches", elements: [], files: {} };

  it("lists shelf items above the cards, previewed as Excalidraw draws them", async () => {
    const { view, host } = await openQueue({
      queued: vi.fn(async () => ({ cards: [site("a")], shelf: [item], target: "Drawing" })),
    });
    const rows = [...view.contentEl.querySelectorAll<HTMLElement>("li")];
    expect(rows[0].classList.contains("garden-shelf-item")).toBe(true);
    expect(rows[1].classList.contains("garden-queue-card")).toBe(true);
    await vi.waitFor(() => expect(rows[0].querySelector("svg[data-preview]")).not.toBeNull());
    expect(host.preview).toHaveBeenCalledWith(item);
  });

  it("places a shelf item on click", async () => {
    const { view, host } = await openQueue({
      queued: vi.fn(async () => ({ cards: [], shelf: [item], target: "Drawing" })),
    });
    view.contentEl.querySelector<HTMLElement>(".garden-shelf-item")!.click();
    await vi.waitFor(() => expect(host.pickShelf).toHaveBeenCalledWith(item));
  });

  it("lights up as a drop target", async () => {
    const { view } = await openQueue();
    view.setDropTarget(true);
    expect(view.contentEl.classList.contains("is-drop-target")).toBe(true);
    view.setDropTarget(false);
    expect(view.contentEl.classList.contains("is-drop-target")).toBe(false);
  });
});
