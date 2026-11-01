import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { ShelfItem } from "./shelf";
import { colourIndex, fillOf, hostOf } from "./siteCard";
import type { Site } from "./sites";

export const VIEW_TYPE_GARDEN_QUEUE = "garden-queue";

const DRAG_THRESHOLD = 4;

/** What the queue needs from the garden. */
export interface QueueHost {
  /** Cards not yet placed on any drawing, and what's on the shelf. `offline`
   *  when the notes server couldn't be reached (the shelf still shows). */
  queued(): Promise<{ cards: Site[]; shelf: ShelfItem[]; target: string | null; offline?: boolean }>;
  /** Clicked: into the middle of the current drawing. */
  pick(site: Site): Promise<void>;
  /** Dragged and let go at this point on screen; false if it wasn't over a drawing. */
  drop(site: Site, clientX: number, clientY: number): Promise<boolean>;
  pickShelf(item: ShelfItem): Promise<void>;
  dropShelf(item: ShelfItem, clientX: number, clientY: number): Promise<boolean>;
  /** A shelf item drawn the way Excalidraw draws it. */
  preview(item: ShelfItem): Promise<SVGSVGElement | null>;
}

type Entry = { key: string; pick: () => Promise<void>; drop: (x: number, y: number) => Promise<boolean> };

/**
 * The card queue in Obsidian's sidebar. On top, the shelf: bits of drawings
 * dragged in here, kept as Excalidraw elements. Below, every queued Slack note
 * and card from the notes server not yet placed on any drawing. Click an item
 * to put it in the middle of the drawing, or drag it to where it should go.
 */
export class QueueView extends ItemView {
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private placing = new Set<string>();
  private audio: HTMLAudioElement | null = null;
  private refreshing: Promise<void> | null = null;
  /** An item is being held, so the list mustn't be redrawn under it. */
  private holding = false;
  /** The newest queue, kept back while an item is held. */
  private stale: { cards: Site[]; shelf: ShelfItem[] } | null = null;

  constructor(leaf: WorkspaceLeaf, private host: QueueHost) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_GARDEN_QUEUE; }
  getDisplayText() { return "Card queue"; }
  getIcon() { return "layers"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("garden-queue");
    const header = root.createDiv({ cls: "garden-queue-header" });
    this.statusEl = header.createSpan({ cls: "garden-queue-status", text: "Loading…" });
    const refresh = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh" } });
    setIcon(refresh, "refresh-cw");
    refresh.onclick = () => this.refresh();
    this.listEl = root.createEl("ul", { cls: "garden-queue-list" });
    root.createDiv({ cls: "garden-queue-drop-hint", text: "Drop here to shelve" });
    this.registerInterval(window.setInterval(() => this.refresh(), 30_000));
    await this.refresh();
  }

  async onClose() {
    this.audio?.pause();
  }

  /** Shown while elements are being dragged over from a drawing. */
  setDropTarget(on: boolean) {
    this.contentEl.toggleClass("is-drop-target", on);
  }

  /** Whether a point on screen is over this sidebar. */
  isOver(clientX: number, clientY: number) {
    const hit = this.contentEl.doc.elementFromPoint(clientX, clientY);
    return !!hit && this.containerEl.contains(hit);
  }

  /** Reload the queue; calls made while one is running share it. */
  refresh(): Promise<void> {
    this.refreshing ??= this.loadQueue().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async loadQueue() {
    try {
      const { cards, shelf, target, offline } = await this.host.queued();
      this.render({ cards, shelf });
      const parts = [`${cards.length} card${cards.length === 1 ? "" : "s"}`];
      if (shelf.length) parts.push(`${shelf.length} shelved`);
      parts.push(target ? `click places on ${target}` : "open a drawing to place them");
      this.statusEl.setText(offline ? "Notes server offline — is `pipeline categorize` running?" : parts.join(" · "));
    } catch (err) {
      console.warn("Garden queue:", err);
      this.statusEl.setText("Couldn't load the queue — see the console.");
    }
  }

  private render(state: { cards: Site[]; shelf: ShelfItem[] }) {
    if (this.holding) {
      this.stale = state;
      return;
    }
    this.stale = null;
    this.listEl.empty();
    for (const item of state.shelf) this.renderShelfItem(item);
    for (const site of state.cards) this.renderCard(site);
  }

  private renderShelfItem(item: ShelfItem) {
    const li = this.listEl.createEl("li", { cls: "garden-shelf-item", attr: { tabindex: "0", "aria-label": `Shelved from ${item.from}` } });
    if (this.placing.has(item.id)) li.addClass("is-placing");
    const picture = li.createDiv({ cls: "garden-shelf-preview" });
    li.createDiv({ cls: "garden-queue-meta", text: `from ${item.from}` });
    this.host.preview(item).then(svg => { if (svg) picture.appendChild(svg); })
      .catch(err => console.warn("Garden: shelf preview failed", err));
    this.wire(li, {
      key: item.id,
      pick: () => this.host.pickShelf(item),
      drop: (x, y) => this.host.dropShelf(item, x, y),
    });
  }

  private renderCard(site: Site) {
    const li = this.listEl.createEl("li", { cls: "garden-queue-card", attr: { tabindex: "0" } });
    li.style.setProperty("--card-fill", fillOf(colourIndex(site.id)));
    if (this.placing.has(site.id)) li.addClass("is-placing");
    if (site.image) li.createEl("img", { attr: { src: site.image, alt: "", draggable: "false" } });
    const body = li.createDiv({ cls: "garden-queue-body" });
    body.createDiv({ cls: "garden-queue-name", text: site.name });
    if (site.meta) body.createDiv({ cls: "garden-queue-meta", text: site.meta });
    if (site.url) body.createDiv({ cls: "garden-queue-host", text: hostOf(site.url) });
    if (site.audio) {
      const play = body.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Play" } });
      setIcon(play, "play");
      play.addEventListener("pointerdown", e => e.stopPropagation());
      play.onclick = e => { e.stopPropagation(); this.toggleAudio(site, play); };
    }
    this.wire(li, {
      key: site.id,
      pick: () => this.host.pick(site),
      drop: (x, y) => this.host.drop(site, x, y),
    });
  }

  private toggleAudio(site: Site, button: HTMLElement) {
    const same = this.audio?.dataset.site === site.id && !this.audio.paused;
    this.audio?.pause();
    this.listEl.querySelectorAll(".garden-queue-card button").forEach(b => setIcon(b as HTMLElement, "play"));
    if (same || !site.audio) return;
    this.audio = new Audio(site.audio.src);
    this.audio.dataset.site = site.id;
    this.audio.onended = () => setIcon(button, "play");
    setIcon(button, "pause");
    this.audio.play().catch(() => setIcon(button, "play"));
  }

  /**
   * Click to pick; press and move to drag a ghost of the item onto a drawing.
   * Moves and the release are followed on the whole document, not the item,
   * and the list isn't redrawn while an item is held: either one losing the
   * item from under the pointer used to strand its ghost on screen.
   */
  private wire(li: HTMLElement, entry: Entry) {
    let dragged = false;

    li.addEventListener("pointerdown", e => {
      if (e.button !== 0 || this.placing.has(entry.key)) return;
      const doc = li.doc;
      const r = li.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top };
      let ghost: HTMLElement | null = null;
      dragged = false;
      this.holding = true;

      const move = (ev: PointerEvent) => {
        if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        if (!ghost) {
          ghost = li.cloneNode(true) as HTMLElement;
          ghost.addClass("garden-queue-ghost");
          ghost.style.width = `${r.width}px`;
          doc.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX - start.offX}px`;
        ghost.style.top = `${ev.clientY - start.offY}px`;
      };
      const finish = (ev: PointerEvent, cancelled: boolean) => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", cancel);
        dragged = !!ghost;
        ghost?.remove();
        ghost = null;
        this.holding = false;
        if (dragged && !cancelled) this.place(entry.key, () => entry.drop(ev.clientX, ev.clientY));
        else if (this.stale) this.render(this.stale);
      };
      const up = (ev: PointerEvent) => finish(ev, false);
      const cancel = (ev: PointerEvent) => finish(ev, true);
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", cancel);
    });
    // The next item slides up under the pointer once this one leaves, so a
    // double-click's second click (detail 2) mustn't place that one too.
    li.onclick = e => {
      if (dragged || e.detail > 1 || this.placing.has(entry.key)) return;
      this.place(entry.key, async () => { await entry.pick(); return true; });
    };
    li.onkeydown = e => {
      if ((e.key === "Enter" || e.key === " ") && !this.placing.has(entry.key)) {
        e.preventDefault();
        this.place(entry.key, async () => { await entry.pick(); return true; });
      }
    };
  }

  private async place(key: string, how: () => Promise<boolean>) {
    this.placing.add(key);
    try {
      await how();
    } catch (err) {
      console.warn("Garden: could not place an item:", err);
    } finally {
      this.placing.delete(key);
      await this.refresh();
    }
  }
}
