import { Notice, requestUrl, TFile, type WorkspaceLeaf } from "obsidian";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@zsviczian/excalidraw/types/excalidraw/types";
import type ExcalidrawPlugin from "../core/main";
import type ExcalidrawView from "../view/ExcalidrawView";
import { BoardLink } from "./boardLink";
import { fetchQueue, type Request } from "./notesApi";
import { middleOf, placeShelfItem, placeSite } from "./placement";
import { mergePlaced, placedSiteIds, queuedSites } from "./queue";
import { QueueView, VIEW_TYPE_GARDEN_QUEUE } from "./queueView";
import { draggedElements, makeShelfItem, splitCards, type ShelfItem } from "./shelf";
import { lib } from "./excalidraw";
import { GardenSettingsModal, withDefaults, type GardenSettings } from "./settings";
import { GARDEN_CSS } from "./styles";
import type { Site } from "./sites";

/**
 * The digital garden inside Obsidian Excalidraw: a sidebar queue of cards from
 * the notes server (`pipeline categorize`) to place on any drawing, and one
 * drawing that follows the MCP board Claude draws on. Upstream code only calls
 * the three on…() hooks below; everything else lives in this folder.
 */
export class Garden {
  settings: GardenSettings = withDefaults(null);
  private link: { view: ExcalidrawView; board: BoardLink } | null = null;
  /** The drawing last worked on, which the queue places cards into. */
  private target: ExcalidrawView | null = null;
  private picks = 0;
  private queueRefresh: number | null = null;
  private waiting = new Map<string, (view: ExcalidrawView) => void>();
  private styleEl: HTMLStyleElement | null = null;
  /** Every card ever placed, on any drawing: site id → when, in ms. Keeps the
   *  queue global, since most drawings aren't open to look in. */
  private placed = new Map<string, number>();
  /** Bits of drawings dragged into the sidebar, newest first; kept in garden-shelf.json. */
  private shelf: ShelfItem[] = [];
  /** A press that started on a drawing, followed to see if it ends over the sidebar. */
  private canvasPress: { view: ExcalidrawView; dragging: boolean } | null = null;

  constructor(private plugin: ExcalidrawPlugin) {}

  private request: Request = req => requestUrl(req) as unknown as ReturnType<Request>;

  private get settingsPath() {
    return `${this.plugin.manifest.dir}/garden.json`;
  }

  private get placedPath() {
    return `${this.plugin.manifest.dir}/garden-placed.json`;
  }

  private get shelfPath() {
    return `${this.plugin.manifest.dir}/garden-shelf.json`;
  }

  private async saveShelf() {
    await this.plugin.app.vault.adapter.write(this.shelfPath, JSON.stringify({ items: this.shelf }));
  }

  private async savePlaced() {
    await this.plugin.app.vault.adapter.write(this.placedPath, JSON.stringify(Object.fromEntries(this.placed)));
  }

  async load() {
    const { app } = this.plugin;
    try {
      if (await app.vault.adapter.exists(this.settingsPath)) {
        this.settings = withDefaults(JSON.parse(await app.vault.adapter.read(this.settingsPath)));
      }
    } catch (err) {
      console.warn("Garden: could not read garden.json, using defaults", err);
    }

    try {
      if (await app.vault.adapter.exists(this.placedPath)) {
        this.placed = new Map(Object.entries(JSON.parse(await app.vault.adapter.read(this.placedPath))));
      }
    } catch (err) {
      console.warn("Garden: could not read garden-placed.json", err);
    }

    try {
      if (await app.vault.adapter.exists(this.shelfPath)) {
        this.shelf = JSON.parse(await app.vault.adapter.read(this.shelfPath)).items ?? [];
      }
    } catch (err) {
      console.warn("Garden: could not read garden-shelf.json", err);
    }

    this.styleEl = document.head.createEl("style", { text: GARDEN_CSS });
    this.plugin.registerView(VIEW_TYPE_GARDEN_QUEUE, leaf => new QueueView(leaf, this));
    this.plugin.addRibbonIcon("layers", "Garden: open card queue", () => this.openQueue());
    this.plugin.addCommand({ id: "garden-open-queue", name: "Garden: open card queue", callback: () => this.openQueue() });
    this.plugin.addCommand({ id: "garden-settings", name: "Garden: settings", callback: () => this.openSettings() });
    this.plugin.addCommand({ id: "garden-import-canvas", name: "Garden: import the garden canvas into the board drawing", callback: () => this.importCanvas() });
    this.plugin.registerEvent(app.workspace.on("active-leaf-change", leaf => this.onActiveLeaf(leaf)));
    // Dragging elements off a drawing into the sidebar. Capture phase, so this
    // sees the pointer before Excalidraw handles it.
    this.plugin.registerDomEvent(document, "pointerdown", e => this.onPressStart(e), { capture: true });
    this.plugin.registerDomEvent(document, "pointermove", e => this.onPressMove(e), { capture: true });
    this.plugin.registerDomEvent(document, "pointerup", e => this.onPressEnd(e), { capture: true });
  }

  unload() {
    this.link?.board.stop();
    this.link = null;
    this.styleEl?.remove();
  }

  // ── Hooks called from upstream code ────────────────────────────────────

  /** A drawing's scene has (re)loaded. */
  onViewReady(view: ExcalidrawView) {
    const path = view.file?.path;
    if (!path) return;
    this.waiting.get(path)?.(view);
    this.waiting.delete(path);
    if (!this.target) this.target = view;
    if (path === this.settings.boardDrawing) this.startBoard(view);
  }

  onSceneChange(view: ExcalidrawView, elements: readonly ExcalidrawElement[]) {
    if (this.link?.view === view) this.link.board.localChange(elements);
    this.refreshQueueSoon();
  }

  onViewUnload(view: ExcalidrawView) {
    if (this.link?.view === view) {
      this.link.board.stop();
      this.link = null;
    }
    if (this.target === view) this.target = null;
  }

  // ── The board drawing ─────────────────────────────────────────────────

  private startBoard(view: ExcalidrawView) {
    this.link?.board.stop();
    this.link = null;
    const api = view.excalidrawAPI as ExcalidrawImperativeAPI | null;
    if (!this.settings.boardUrl || !api) return;
    const board = new BoardLink(api, this.settings.boardUrl, {
      onStatus: status => { if (status === "offline") console.info("Garden: MCP board offline, retrying"); },
    });
    this.link = { view, board };
    board.start();
  }

  // ── The queue ─────────────────────────────────────────────────────────

  private onActiveLeaf(leaf: WorkspaceLeaf | null) {
    const view = leaf?.view as ExcalidrawView | undefined;
    if (view?.getViewType() !== "excalidraw" || view === this.target) return;
    this.target = view;
    this.refreshQueueSoon(0);
  }

  private refreshQueueSoon(delay = 1_000) {
    if (this.queueRefresh) window.clearTimeout(this.queueRefresh);
    this.queueRefresh = window.setTimeout(() => {
      this.queueRefresh = null;
      for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_GARDEN_QUEUE)) {
        (leaf.view as QueueView).refresh();
      }
    }, delay);
  }

  private targetApi(): ExcalidrawImperativeAPI | null {
    return (this.target?.excalidrawAPI as ExcalidrawImperativeAPI | null) ?? null;
  }

  /** The queue is global: a card placed on any drawing is gone from it. */
  async queued(): Promise<{ cards: Site[]; shelf: ShelfItem[]; target: string | null; offline?: boolean }> {
    const target = this.target?.file?.basename ?? null;
    let all: Site[];
    try {
      all = await fetchQueue(this.settings.notesServer, this.request);
    } catch (err) {
      console.warn("Garden: notes server unreachable", err);
      return { cards: [], shelf: this.shelf, target, offline: true };
    }
    const onOpenDrawings = this.plugin.app.workspace.getLeavesOfType("excalidraw").map(leaf => {
      const api = (leaf.view as ExcalidrawView).excalidrawAPI as ExcalidrawImperativeAPI | null;
      return placedSiteIds(api ? (api.getSceneElementsIncludingDeleted() as never) : []);
    });
    const merged = mergePlaced(this.placed, ...onOpenDrawings);
    // Remember what the open drawings hold, so closing them doesn't re-queue it.
    if ([...merged].some(([id, at]) => this.placed.get(id) !== at)) {
      this.placed = merged;
      this.savePlaced().catch(err => console.warn("Garden: could not save garden-placed.json", err));
    }
    return { cards: queuedSites(all, merged), shelf: this.shelf, target };
  }

  async pick(site: Site) {
    const api = this.targetApi();
    if (!api) {
      new Notice("Open a drawing first, then pick a card.");
      return;
    }
    const { clientX, clientY } = middleOf(api, this.picks++);
    await placeSite(api, site, clientX, clientY, this.request);
  }

  /** The drawing whose canvas is at this point on screen, if any. */
  private viewAt(clientX: number, clientY: number): ExcalidrawView | null {
    const hit = document.elementFromPoint(clientX, clientY);
    return hit ? this.viewOf(hit) : null;
  }

  private viewOf(el: Element): ExcalidrawView | null {
    if (!(el instanceof HTMLCanvasElement) || !el.closest(".excalidraw")) return null;
    return this.plugin.app.workspace.getLeavesOfType("excalidraw")
      .map(leaf => leaf.view as ExcalidrawView)
      .find(v => v.containerEl.contains(el) && v.excalidrawAPI) ?? null;
  }

  async drop(site: Site, clientX: number, clientY: number) {
    const view = this.viewAt(clientX, clientY);
    if (!view) return false;
    this.target = view;
    await placeSite(view.excalidrawAPI, site, clientX, clientY, this.request);
    return true;
  }

  // ── The shelf ─────────────────────────────────────────────────────────

  async pickShelf(item: ShelfItem) {
    const api = this.targetApi();
    if (!api) {
      new Notice("Open a drawing first, then pick an item.");
      return;
    }
    const { clientX, clientY } = middleOf(api, this.picks++);
    await this.unshelve(item, api, clientX, clientY);
  }

  async dropShelf(item: ShelfItem, clientX: number, clientY: number) {
    const view = this.viewAt(clientX, clientY);
    if (!view) return false;
    this.target = view;
    await this.unshelve(item, view.excalidrawAPI, clientX, clientY);
    return true;
  }

  /** Placing a shelf item moves it onto the drawing, off the shelf. */
  private async unshelve(item: ShelfItem, api: ExcalidrawImperativeAPI, clientX: number, clientY: number) {
    placeShelfItem(api, item, clientX, clientY);
    this.shelf = this.shelf.filter(i => i.id !== item.id);
    await this.saveShelf();
  }

  async preview(item: ShelfItem): Promise<SVGSVGElement | null> {
    if (!item.elements.length) return null;
    const dark = document.body.hasClass("theme-dark");
    const svg = await lib().exportToSvg({
      elements: item.elements,
      files: item.files,
      appState: { exportBackground: false, exportWithDarkMode: dark, viewBackgroundColor: "transparent" },
      exportPadding: 8,
    } as never);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    return svg;
  }

  private queueViews() {
    return this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_GARDEN_QUEUE).map(l => l.view as QueueView);
  }

  private onPressStart(e: PointerEvent) {
    const view = e.button === 0 && e.target instanceof Element ? this.viewOf(e.target) : null;
    this.canvasPress = view ? { view, dragging: false } : null;
  }

  private onPressMove(e: PointerEvent) {
    const press = this.canvasPress;
    if (!press) return;
    // Only a drag of selected elements counts, not a selection box or panning.
    if (!press.dragging && press.view.excalidrawAPI?.getAppState().selectedElementsAreBeingDragged) press.dragging = true;
    if (press.dragging) for (const q of this.queueViews()) q.setDropTarget(q.isOver(e.clientX, e.clientY));
  }

  private onPressEnd(e: PointerEvent) {
    const press = this.canvasPress;
    this.canvasPress = null;
    if (!press?.dragging) return;
    const queues = this.queueViews();
    for (const q of queues) q.setDropTarget(false);
    if (!queues.some(q => q.isOver(e.clientX, e.clientY))) return;
    const selected = { ...press.view.excalidrawAPI.getAppState().selectedElementIds };
    // After Excalidraw has finished the drag, or it would put the elements back.
    window.setTimeout(() => this.shelve(press.view, selected).catch(err => {
      console.error("Garden: could not shelve", err);
      new Notice("Couldn't move that to the queue — see the console.");
    }), 0);
  }

  /** Dragged into the sidebar: garden cards go back to the queue, anything else
   *  onto the shelf, and all of it leaves the drawing (Cmd+Z brings it back). */
  private async shelve(view: ExcalidrawView, selected: Record<string, boolean>) {
    const api = view.excalidrawAPI as ExcalidrawImperativeAPI;
    const scene = api.getSceneElementsIncludingDeleted();
    const dragged = draggedElements(scene, selected);
    if (!dragged.length) return;
    const { siteIds, rest } = splitCards(dragged);

    const gone = new Set(dragged.map(e => e.id));
    api.updateScene({
      elements: scene.map(e => (gone.has(e.id)
        ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
        : e)),
      appState: { selectedElementIds: {} },
      storeAction: lib().StoreAction.CAPTURE,
    } as never);

    if (siteIds.length) {
      for (const id of siteIds) this.placed.delete(id);
      await this.savePlaced();
    }
    if (rest.length) {
      this.shelf = [makeShelfItem(rest, api.getFiles(), view.file?.basename ?? "a drawing"), ...this.shelf];
      await this.saveShelf();
    }
    this.refreshQueueSoon(0);
  }

  async openQueue() {
    const { workspace } = this.plugin.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_GARDEN_QUEUE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_GARDEN_QUEUE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  openSettings() {
    new GardenSettingsModal(this.plugin.app, this.settings, async next => {
      this.settings = next;
      await this.plugin.app.vault.adapter.write(this.settingsPath, JSON.stringify(next, null, 2));
      // Follow (or stop following) the board under the new settings.
      if (this.link) this.startBoard(this.link.view);
      else {
        const open = this.plugin.app.workspace.getLeavesOfType("excalidraw")
          .map(l => l.view as ExcalidrawView).find(v => v.file?.path === next.boardDrawing);
        if (open) this.startBoard(open);
      }
      this.refreshQueueSoon(0);
    }).open();
  }

  // ── Retiring the old garden canvas ────────────────────────────────────

  /** Brings canvas.json (the old garden canvas) into the board drawing. */
  async importCanvas() {
    const { app } = this.plugin;
    let scene: { elements?: ExcalidrawElement[] };
    try {
      const res = await this.request({ url: new URL("/api/canvas/scene", this.settings.notesServer).toString(), throw: false });
      if (res.status >= 400) throw new Error(String(res.status));
      scene = res.json as typeof scene;
    } catch (err) {
      new Notice(`Couldn't read the garden canvas from the notes server: ${err}`);
      return;
    }
    const incoming = (scene.elements ?? []).filter(e => !e.isDeleted);
    const path = this.settings.boardDrawing;
    const existing = app.vault.getAbstractFileByPath(path);

    if (!(existing instanceof TFile)) {
      const ea = this.plugin.ea.getAPI();
      ea.reset();
      for (const el of incoming) ea.elementsDict[el.id] = { ...el };
      const slash = path.lastIndexOf("/");
      await ea.create({
        foldername: slash > 0 ? path.slice(0, slash) : "",
        filename: path.slice(slash + 1).replace(/\.md$/, ""),
        onNewPane: false,
        frontmatterKeys: { "excalidraw-plugin": "parsed" },
      });
      new Notice(`Imported ${incoming.length} elements into ${path}.`);
      return;
    }

    const ready = new Promise<ExcalidrawView>(resolve => this.waiting.set(path, resolve));
    const open = app.workspace.getLeavesOfType("excalidraw")
      .map(l => l.view as ExcalidrawView).find(v => v.file?.path === path);
    if (!open) await app.workspace.getLeaf(true).openFile(existing);
    const view = open ?? await ready;
    this.waiting.delete(path);
    const api = view.excalidrawAPI as ExcalidrawImperativeAPI;
    const have = new Set(api.getSceneElementsIncludingDeleted().map(e => e.id));
    const added = incoming.filter(e => !have.has(e.id));
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...added] } as never);
    new Notice(`Imported ${added.length} new elements into ${path}.`);
  }
}
