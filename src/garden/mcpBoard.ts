import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";

/**
 * A live link to mcp-excalidraw-server (the board Claude's excalidraw MCP
 * tools draw on). The server keeps the scene in memory and pushes every change
 * over a WebSocket; we push ours back by replacing its whole scene. The notes
 * server's canvas.json stays the durable copy, and seeds the board after the
 * MCP server restarts empty.
 */

export type BoardStatus = "connecting" | "live" | "offline";

export type ViewportRequest = {
  requestId: string;
  scrollToContent?: boolean;
  scrollToElementId?: string;
  scrollToElementIds?: string[];
  viewportZoomFactor?: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

export type ExportRequest = {
  requestId: string;
  format: "png" | "svg";
  background?: boolean;
  options?: { elementIds?: string[]; padding?: number; scale?: number; dark?: boolean };
};

export type BoardEvents = {
  /** The board's scene when we connect, to merge with the saved one. */
  onInitial(elements: ExcalidrawElement[], files: Record<string, unknown> | undefined): void;
  /** Elements added or changed on the board (often partial). */
  onUpsert(elements: ExcalidrawElement[]): void;
  onDelete(id: string): void;
  /**
   * Someone else replaced the board's whole scene, perhaps from a page that
   * never had some of our elements; merge it in rather than lose them.
   */
  onReplace(elements: ExcalidrawElement[]): void;
  /** The board was cleared on purpose (Claude's clear_canvas). */
  onCleared(): void;
  onFiles(files: unknown[]): void;
  onViewport(request: ViewportRequest): Promise<void>;
  onExport(request: ExportRequest): Promise<{ format: string; data: string }>;
  onStatus(status: BoardStatus): void;
};

type Deps = { WebSocket: typeof WebSocket; fetch: typeof fetch; now: () => number };

/** How long after our own push the board's "synced" echo is ignored. */
const ECHO_MS = 2_000;
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 15_000];
/** Fields the server adds to each element for its own records. */
const SERVER_FIELDS = ["syncedAt", "source", "syncTimestamp", "createdAt", "updatedAt"];

const clean = (el: ExcalidrawElement) => {
  const copy = { ...el } as Record<string, unknown>;
  for (const field of SERVER_FIELDS) delete copy[field];
  return copy as unknown as ExcalidrawElement;
};

export const wsUrlOf = (base: string) => {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * The saved scene and the board's, as one: every element from either side,
 * and for one both have, the side that changed it last. The board resets
 * versions when it syncs, so `updated` is the only fair comparison.
 * `boardBehind` says the board needs the merged scene pushed to it.
 */
export function mergeScenes(saved: readonly ExcalidrawElement[], board: readonly ExcalidrawElement[]) {
  const onBoard = new Map(board.map(e => [e.id, clean(e)]));
  let boardBehind = false;
  const elements = saved.map(mine => {
    const theirs = onBoard.get(mine.id);
    onBoard.delete(mine.id);
    if (!theirs || (mine.updated ?? 0) > (theirs.updated ?? 0)) {
      boardBehind = true;
      return mine;
    }
    return theirs;
  });
  return { elements: [...elements, ...onBoard.values()], boardBehind };
}

/** Changes from the board laid over what we have, the way its own page does it. */
export function upsertElements(current: readonly ExcalidrawElement[], incoming: readonly ExcalidrawElement[]) {
  const changes = new Map(incoming.map(e => [e.id, clean(e)]));
  const merged = current.map(el => {
    const change = changes.get(el.id);
    if (!change) return el;
    changes.delete(el.id);
    return { ...el, ...change, version: Math.max(el.version ?? 0, change.version ?? 0) + 1 } as ExcalidrawElement;
  });
  return [...merged, ...changes.values()];
}

export class McpBoard {
  private socket: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private lastPush = -Infinity;
  private deps: Deps;
  private base: string;
  private events: BoardEvents;

  constructor(base: string, events: BoardEvents, deps: Partial<Deps> = {}) {
    this.base = base.replace(/\/$/, "");
    this.events = events;
    this.deps = {
      WebSocket: deps.WebSocket ?? WebSocket,
      fetch: deps.fetch ?? ((...args) => fetch(...args)),
      now: deps.now ?? Date.now,
    };
  }

  connect() {
    this.closed = false;
    this.events.onStatus("connecting");
    const socket = new this.deps.WebSocket(wsUrlOf(this.base));
    this.socket = socket;
    socket.onopen = () => { this.retry = 0; this.events.onStatus("live"); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closed) return;
      this.events.onStatus("offline");
      const wait = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
      this.retryTimer = setTimeout(() => this.connect(), wait);
    };
    socket.onmessage = e => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      this.receive(msg).catch(err => console.warn("MCP board message failed:", msg.type, err));
    };
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }

  /** Make the board's scene this one. */
  async push(elements: readonly ExcalidrawElement[]) {
    this.lastPush = this.deps.now();
    await this.post("/api/elements/sync", { elements, timestamp: new Date(this.lastPush).toISOString() });
  }

  async fetchElements(): Promise<ExcalidrawElement[]> {
    const res = await this.deps.fetch(`${this.base}/api/elements`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as { elements?: ExcalidrawElement[] };
    return body.elements ?? [];
  }

  private async post(path: string, body: unknown) {
    const res = await this.deps.fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  }

  private async receive(msg: Record<string, unknown>) {
    const ev = this.events;
    switch (msg.type) {
      case "initial_elements":
        ev.onInitial((msg.elements as ExcalidrawElement[]) ?? [], msg.files as Record<string, unknown> | undefined);
        break;
      case "element_created":
      case "element_updated":
        if (msg.element) ev.onUpsert([msg.element as ExcalidrawElement]);
        break;
      case "elements_batch_created":
        if (Array.isArray(msg.elements)) ev.onUpsert(msg.elements);
        break;
      case "element_deleted":
        if (typeof msg.elementId === "string") ev.onDelete(msg.elementId);
        break;
      case "canvas_cleared":
        ev.onCleared();
        break;
      case "elements_synced":
        // Our own push coming back; anyone else's means the scene was replaced.
        if (this.deps.now() - this.lastPush < ECHO_MS) break;
        ev.onReplace(await this.fetchElements());
        break;
      case "files_added":
        if (Array.isArray(msg.files)) ev.onFiles(msg.files);
        break;
      case "set_viewport": {
        const request = msg as unknown as ViewportRequest;
        try {
          await ev.onViewport(request);
          await this.post("/api/viewport/result", { requestId: request.requestId, success: true });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await this.post("/api/viewport/result", { requestId: request.requestId, success: false, error });
        }
        break;
      }
      case "export_image_request": {
        const request = msg as unknown as ExportRequest;
        try {
          const { format, data } = await ev.onExport(request);
          await this.post("/api/export/image/result", { requestId: request.requestId, format, data });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await this.post("/api/export/image/result", { requestId: request.requestId, error });
        }
        break;
      }
    }
  }
}
