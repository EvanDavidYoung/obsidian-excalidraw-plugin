import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
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
    getSceneElements: () => scene.filter(e => !e.isDeleted),
    updateScene: vi.fn(({ elements }) => { if (elements) scene = elements; }),
    addFiles: vi.fn(),
    getAppState: () => ({ zoom: { value: 1 }, scrollX: 0, scrollY: 0 }) as never,
    getFiles: () => ({}),
    scrollToContent: vi.fn(),
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
});
