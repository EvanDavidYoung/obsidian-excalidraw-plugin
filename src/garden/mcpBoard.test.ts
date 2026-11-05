import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import { McpBoard, mergeScenes, upsertElements, wsUrlOf, type BoardEvents } from "./mcpBoard";

const el = (id: string, props: Record<string, unknown> = {}) =>
  ({ id, type: "rectangle", x: 0, y: 0, version: 3, updated: 100, isDeleted: false, ...props }) as unknown as ExcalidrawElement;

describe("mergeScenes", () => {
  it("keeps everything from both sides", () => {
    const { elements } = mergeScenes([el("a"), el("b")], [el("b"), el("c")]);
    expect(elements.map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("takes the side changed most recently for an element both have", () => {
    const { elements } = mergeScenes([el("a", { x: 1, updated: 200 })], [el("a", { x: 2, updated: 100 })]);
    expect(elements[0].x).toBe(1);
    const other = mergeScenes([el("a", { x: 1, updated: 100 })], [el("a", { x: 2, updated: 200 })]);
    expect(other.elements[0].x).toBe(2);
  });

  it("says whether the board is missing anything the saved scene has", () => {
    expect(mergeScenes([el("a")], [el("a")]).boardBehind).toBe(false);
    expect(mergeScenes([el("a"), el("b")], [el("a")]).boardBehind).toBe(true);
    expect(mergeScenes([el("a", { updated: 200 })], [el("a")]).boardBehind).toBe(true);
  });

  it("seeds an empty board from the saved scene", () => {
    const { elements, boardBehind } = mergeScenes([el("a"), el("b")], []);
    expect(elements.map(e => e.id)).toEqual(["a", "b"]);
    expect(boardBehind).toBe(true);
  });
});

describe("upsertElements", () => {
  it("lays changes over the element it has, and bumps its version so it redraws", () => {
    const [a] = upsertElements([el("a", { x: 1, y: 5, version: 7 })], [{ id: "a", x: 9 } as ExcalidrawElement]);
    expect(a).toMatchObject({ id: "a", x: 9, y: 5 });
    expect(a.version).toBeGreaterThan(7);
  });

  it("adds new elements at the end", () => {
    expect(upsertElements([el("a")], [el("b")]).map(e => e.id)).toEqual(["a", "b"]);
  });

  it("drops the server's bookkeeping fields", () => {
    const [a] = upsertElements([], [el("a", { syncedAt: "x", source: "frontend_sync", syncTimestamp: "y", createdAt: "z", updatedAt: "w" })]);
    expect(Object.keys(a)).not.toEqual(expect.arrayContaining(["syncedAt"]));
    expect(a).not.toHaveProperty("source");
    expect(a).not.toHaveProperty("createdAt");
  });
});

describe("wsUrlOf", () => {
  it("swaps http for ws", () => {
    expect(wsUrlOf("http://127.0.0.1:3000")).toBe("ws://127.0.0.1:3000/");
    expect(wsUrlOf("https://board.example/")).toBe("wss://board.example/");
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) { this.url = url; FakeSocket.all.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  send(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

describe("McpBoard", () => {
  let events: { [K in keyof BoardEvents]: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;
  let now: number;
  const make = () => new McpBoard("http://board.test", events as unknown as BoardEvents, {
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
  });
  const ok = (body: unknown = { success: true }) => Promise.resolve(new Response(JSON.stringify(body)));
  const socket = () => FakeSocket.all.at(-1)!;
  const posted = (path: string) =>
    fetchMock.mock.calls.filter(([url]) => url === `http://board.test${path}`).map(([, init]) => JSON.parse(init.body));

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    now = 1_000_000;
    fetchMock = vi.fn(() => ok());
    events = {
      onInitial: vi.fn(), onUpsert: vi.fn(), onDelete: vi.fn(), onReplace: vi.fn(), onCleared: vi.fn(), onFiles: vi.fn(),
      onViewport: vi.fn(() => Promise.resolve()), onExport: vi.fn(() => Promise.resolve({ format: "png", data: "abc" })),
      onStatus: vi.fn(),
    };
  });
  afterEach(() => vi.useRealTimers());

  it("hands over the board's elements and pictures when it connects", () => {
    make().connect();
    expect(socket().url).toBe("ws://board.test/");
    socket().onopen?.();
    expect(events.onStatus).toHaveBeenLastCalledWith("live");
    socket().send({ type: "initial_elements", elements: [el("a")], files: { f: { id: "f" } } });
    expect(events.onInitial).toHaveBeenCalledWith([el("a")], { f: { id: "f" } });
  });

  it("passes on single and batched changes and deletions", () => {
    make().connect();
    socket().send({ type: "element_created", element: el("a") });
    socket().send({ type: "element_updated", element: el("b") });
    socket().send({ type: "elements_batch_created", elements: [el("c"), el("d")] });
    socket().send({ type: "element_deleted", elementId: "e" });
    expect(events.onUpsert.mock.calls).toEqual([[[el("a")]], [[el("b")]], [[el("c"), el("d")]]]);
    expect(events.onDelete).toHaveBeenCalledWith("e");
  });

  it("empties the canvas only when the board is cleared on purpose", () => {
    make().connect();
    socket().send({ type: "canvas_cleared" });
    expect(events.onCleared).toHaveBeenCalled();
    expect(events.onReplace).not.toHaveBeenCalled();
  });

  it("pushes the whole scene to the board's sync endpoint", async () => {
    await make().push([el("a")]);
    expect(posted("/api/elements/sync")[0].elements).toEqual([el("a")]);
  });

  it("ignores the board confirming our own push, but refetches after someone else's", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/api/elements") ? ok({ success: true, elements: [el("z")] }) : ok());
    const board = make();
    board.connect();
    await board.push([el("a")]);
    socket().send({ type: "elements_synced", count: 1 });
    await vi.runAllTimersAsync();
    expect(events.onReplace).not.toHaveBeenCalled();

    now += 5_000;
    socket().send({ type: "elements_synced", count: 1 });
    await vi.runAllTimersAsync();
    expect(events.onReplace).toHaveBeenCalledWith([el("z")]);
  });

  it("answers viewport requests so the MCP tool doesn't time out", async () => {
    make().connect();
    socket().send({ type: "set_viewport", requestId: "r1", scrollToElementId: "a" });
    await vi.runAllTimersAsync();
    expect(events.onViewport).toHaveBeenCalledWith(expect.objectContaining({ scrollToElementId: "a" }));
    expect(posted("/api/viewport/result")).toEqual([{ requestId: "r1", success: true }]);
  });

  it("reports a viewport request it couldn't carry out", async () => {
    events.onViewport.mockImplementation(() => Promise.reject(new Error("no such element")));
    make().connect();
    socket().send({ type: "set_viewport", requestId: "r1" });
    await vi.runAllTimersAsync();
    expect(posted("/api/viewport/result")).toEqual([{ requestId: "r1", success: false, error: "no such element" }]);
  });

  it("answers screenshot requests with the exported image", async () => {
    make().connect();
    socket().send({ type: "export_image_request", requestId: "r2", format: "png" });
    await vi.runAllTimersAsync();
    expect(posted("/api/export/image/result")).toEqual([{ requestId: "r2", format: "png", data: "abc" }]);
  });

  it("reconnects after the board goes away, backing off", () => {
    make().connect();
    socket().onclose?.();
    expect(events.onStatus).toHaveBeenLastCalledWith("offline");
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    socket().onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("stays closed once closed", () => {
    const board = make();
    board.connect();
    board.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("ignores messages it can't read", () => {
    make().connect();
    expect(() => socket().onmessage?.({ data: "not json" })).not.toThrow();
  });
});
