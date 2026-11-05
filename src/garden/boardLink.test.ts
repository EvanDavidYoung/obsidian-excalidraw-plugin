import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import type { BoardEvents } from "./mcpBoard";
import { BoardLink, type SceneApi } from "./boardLink";

const rect = (id: string, updated: number, version = 1) =>
  ({
    id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, angle: 0, seed: 1, version,
    versionNonce: 1, isDeleted: false, updated, groupIds: [], boundElements: null,
    strokeColor: "#000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1,
    strokeStyle: "solid", roughness: 1, opacity: 100, frameId: null, roundness: null,
    link: null, locked: false,
  }) as unknown as ExcalidrawElement;

function fakeApi(initial: ExcalidrawElement[]) {
  let scene = initial;
  const api: SceneApi = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene.filter(e => !e.isDeleted) as never,
    updateScene: vi.fn(({ elements }) => { if (elements) scene = elements; }),
    addFiles: vi.fn(),
    getAppState: () => ({ zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 1000, height: 800 }) as never,
    getFiles: () => ({}),
    setViewport: vi.fn(),
  };
  return { api, scene: () => scene };
}

function fakeBoard() {
  const made: { events: BoardEvents; push: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  const create = (_url: string, events: BoardEvents) => {
    const board = { events, push: vi.fn(async () => {}), close: vi.fn(), connect: vi.fn() };
    made.push(board);
    return board;
  };
  return { create, made };
}

describe("BoardLink", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges the board into the drawing and pushes back what the board lacks", () => {
    const { api, scene } = fakeApi([rect("mine", 5)]);
    const boards = fakeBoard();
    new BoardLink(api, "http://board", { createBoard: boards.create }).start();
    boards.made[0].events.onInitial([rect("theirs", 1)], undefined);
    expect(scene().map(e => e.id).sort()).toEqual(["mine", "theirs"]);
    expect(boards.made[0].push).toHaveBeenCalledTimes(1);
  });

  it("doesn't echo the board's own changes back to it", () => {
    const { api, scene } = fakeApi([]);
    const boards = fakeBoard();
    const link = new BoardLink(api, "http://board", { createBoard: boards.create });
    link.start();
    boards.made[0].events.onUpsert([rect("theirs", 1)]);
    link.localChange(scene());
    vi.advanceTimersByTime(5_000);
    expect(boards.made[0].push).not.toHaveBeenCalled();
  });

  it("pushes local edits once, after they settle", () => {
    const { api } = fakeApi([rect("a", 1)]);
    const boards = fakeBoard();
    const link = new BoardLink(api, "http://board", { createBoard: boards.create });
    link.start();
    link.localChange([rect("a", 2, 2)]);
    vi.advanceTimersByTime(500);
    link.localChange([rect("a", 3, 3)]);
    vi.advanceTimersByTime(1_499);
    expect(boards.made[0].push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(boards.made[0].push).toHaveBeenCalledTimes(1);
    expect(boards.made[0].push.mock.calls[0][0][0].version).toBe(3);
  });

  it("marks an element the board deleted as deleted", () => {
    const { api, scene } = fakeApi([rect("a", 1)]);
    const boards = fakeBoard();
    new BoardLink(api, "http://board", { createBoard: boards.create }).start();
    boards.made[0].events.onDelete("a");
    expect(scene()[0].isDeleted).toBe(true);
  });

  it("stops: closes the board and drops a pending push", () => {
    const { api } = fakeApi([rect("a", 1)]);
    const boards = fakeBoard();
    const link = new BoardLink(api, "http://board", { createBoard: boards.create });
    link.start();
    link.localChange([rect("a", 2, 2)]);
    link.stop();
    vi.advanceTimersByTime(5_000);
    expect(boards.made[0].close).toHaveBeenCalled();
    expect(boards.made[0].push).not.toHaveBeenCalled();
  });

  it("applies the board's changes without making them an undo step", () => {
    const { api } = fakeApi([]);
    const boards = fakeBoard();
    new BoardLink(api, "http://board", { createBoard: boards.create }).start();
    boards.made[0].events.onUpsert([rect("theirs", 1)]);
    expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: "NEVER" }));
  });

  describe("following the board's viewport requests", () => {
    const start = (scene: ExcalidrawElement[]) => {
      const { api } = fakeApi(scene);
      const boards = fakeBoard();
      new BoardLink(api, "http://board", { createBoard: boards.create }).start();
      return { api, events: boards.made[0].events };
    };

    it("centres on one element at the current zoom", async () => {
      const a = rect("a", 1);
      const { api, events } = start([a, rect("b", 1)]);
      await events.onViewport({ scrollToElementId: "a" } as never);
      expect(api.setViewport).toHaveBeenCalledWith({ target: [a], fit: "none", animation: true });
    });

    it("fits several elements", async () => {
      const [a, b] = [rect("a", 1), rect("b", 1)];
      const { api, events } = start([a, b, rect("c", 1)]);
      await events.onViewport({ scrollToElementIds: ["a", "b"] } as never);
      expect(api.setViewport).toHaveBeenCalledWith({ target: [a, b], fit: "contain", animation: true });
    });

    it("fits the whole scene", async () => {
      const a = rect("a", 1);
      const { api, events } = start([a]);
      await events.onViewport({ scrollToContent: true } as never);
      expect(api.setViewport).toHaveBeenCalledWith({ target: [a], fit: "contain", animation: true });
    });

    it("keeps a zoom factor below 1 as a margin around the content", async () => {
      const a = rect("a", 1);
      const { api, events } = start([a]);
      await events.onViewport({ scrollToContent: true, viewportZoomFactor: 0.5 } as never);
      expect(api.setViewport).toHaveBeenCalledWith({
        target: [a], fit: "contain", animation: true,
        offsets: { top: 200, bottom: 200, left: 250, right: 250 },
      });
    });

    it("rejects elements that aren't on the drawing", async () => {
      const { api, events } = start([rect("a", 1)]);
      await expect(events.onViewport({ scrollToElementId: "nope" } as never)).rejects.toThrow("nope");
      expect(api.setViewport).not.toHaveBeenCalled();
    });
  });
});
