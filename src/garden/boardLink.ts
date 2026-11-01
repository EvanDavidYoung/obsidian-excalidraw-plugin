import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI } from "@zsviczian/excalidraw/types/excalidraw/types";
import { lib } from "./excalidraw";
import { McpBoard, mergeScenes, upsertElements, type BoardEvents, type BoardStatus, type ExportRequest, type ViewportRequest } from "./mcpBoard";

/**
 * Keeps one open drawing and the MCP board (mcp-excalidraw-server, the board
 * Claude's excalidraw tools draw on) in step: the board's changes are applied
 * live, and edits made in Obsidian are pushed back once they settle. The
 * drawing file stays the durable copy, as canvas.json was for the old garden
 * canvas, and seeds the board after the MCP server restarts empty.
 */

/** The parts of Excalidraw's imperative API this needs. */
export type SceneApi = Pick<
  ExcalidrawImperativeAPI,
  "getSceneElementsIncludingDeleted" | "getSceneElements" | "updateScene" | "addFiles" | "getAppState" | "getFiles" | "scrollToContent"
>;

type Board = Pick<McpBoard, "connect" | "close" | "push">;

type Options = {
  createBoard?: (url: string, events: BoardEvents) => Board;
  onStatus?: (status: BoardStatus) => void;
};

const PUSH_DELAY_MS = 1_500;

/** What makes two scenes the same as far as the board cares. */
const fingerprint = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(e => !e.isDeleted).map(e => `${e.id}:${e.version}`).sort().join(",");

/** Elements the MCP tools made from a sketch (no seed yet) are filled out first. */
function normalise(incoming: readonly ExcalidrawElement[], local: readonly ExcalidrawElement[]) {
  const { convertToExcalidrawElements, restoreElements } = lib();
  const skeletons = incoming.filter(e => !("seed" in e));
  const full = incoming.filter(e => "seed" in e);
  const built = skeletons.length
    ? convertToExcalidrawElements(skeletons as never, { regenerateIds: false })
    : [];
  return restoreElements([...full, ...built], local, { repairBindings: true });
}

export class BoardLink {
  private board: Board | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** The scene as the board last saw it, so its own changes aren't sent back. */
  private boardSees = "";

  constructor(private api: SceneApi, private url: string, private options: Options = {}) {}

  start() {
    const create = this.options.createBoard ?? ((url, events) => new McpBoard(url, events));
    this.board = create(this.url, this.events());
    this.board.connect();
  }

  stop() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.board?.close();
    this.board = null;
  }

  /** Called on every change to the drawing; pushes once edits settle. */
  localChange(elements: readonly ExcalidrawElement[]) {
    if (!this.board || fingerprint(elements) === this.boardSees) return;
    const live = elements.filter(e => !e.isDeleted);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.push(live);
    }, PUSH_DELAY_MS);
  }

  private push(elements: readonly ExcalidrawElement[]) {
    if (!this.board) return;
    this.boardSees = fingerprint(elements);
    this.board.push(elements).catch(err => console.warn("Could not update the MCP board:", err));
  }

  /** Shows a scene the board has too, without making it an undo step. */
  private show(elements: readonly ExcalidrawElement[]) {
    this.api.updateScene({ elements, storeAction: lib().StoreAction.UPDATE } as never);
    this.boardSees = fingerprint(elements);
  }

  private mergeIn(remote: readonly ExcalidrawElement[]) {
    const mine = this.api.getSceneElementsIncludingDeleted().filter(e => !e.isDeleted);
    const { elements, boardBehind } = mergeScenes(mine, normalise(remote, mine));
    this.show(elements);
    if (boardBehind) this.push(elements);
  }

  private events(): BoardEvents {
    const api = this.api;
    return {
      onInitial: (remote, files) => {
        if (files) api.addFiles(Object.values(files) as BinaryFileData[]);
        this.mergeIn(remote);
      },
      onUpsert: changes => {
        const base = api.getSceneElementsIncludingDeleted();
        this.show(upsertElements(base, normalise(changes, base)));
      },
      onDelete: id => {
        this.show(api.getSceneElementsIncludingDeleted().map(e =>
          (e.id === id ? ({ ...e, isDeleted: true, version: e.version + 1 } as ExcalidrawElement) : e)));
      },
      onReplace: remote => this.mergeIn(remote),
      onCleared: () => this.show([]),
      onFiles: files => api.addFiles(files as BinaryFileData[]),
      onViewport: async (req: ViewportRequest) => {
        const scene = api.getSceneElements();
        const ids = req.scrollToElementIds ?? (req.scrollToElementId ? [req.scrollToElementId] : null);
        if (ids) {
          const targets = scene.filter(e => ids.includes(e.id));
          if (!targets.length) throw new Error(`Element ${ids.join(", ")} not found`);
          api.scrollToContent(targets, { fitToViewport: ids.length > 1, viewportZoomFactor: req.viewportZoomFactor, animate: true });
        } else if (req.scrollToContent) {
          api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: req.viewportZoomFactor, animate: true });
        } else {
          const current = api.getAppState();
          api.updateScene({
            appState: {
              zoom: req.zoom !== undefined ? { value: req.zoom as AppState["zoom"]["value"] } : current.zoom,
              scrollX: req.offsetX ?? current.scrollX,
              scrollY: req.offsetY ?? current.scrollY,
            },
          } as never);
        }
      },
      onExport: async (req: ExportRequest) => {
        const { exportToSvg, exportToBlob } = lib();
        const opts = req.options ?? {};
        const wanted = opts.elementIds ? new Set(opts.elementIds) : null;
        const elements = api.getSceneElements().filter(e =>
          !wanted || wanted.has(e.id) || (e.type === "text" && e.containerId && wanted.has(e.containerId)));
        const appState = {
          ...api.getAppState(),
          exportBackground: req.background !== false,
          exportScale: opts.scale ?? 1,
          ...(opts.dark !== undefined && { exportWithDarkMode: opts.dark }),
        };
        const files = api.getFiles();
        if (req.format === "svg") {
          const svg = await exportToSvg({ elements, appState, files, exportPadding: opts.padding } as never);
          return { format: "svg", data: new XMLSerializer().serializeToString(svg) };
        }
        const blob = await exportToBlob({ elements, appState, files, mimeType: "image/png", exportPadding: opts.padding } as never);
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return { format: "png", data: url.split(",")[1] };
      },
      onStatus: status => this.options.onStatus?.(status),
    };
  }
}
