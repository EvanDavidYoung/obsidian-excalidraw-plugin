// Just enough of Obsidian for the garden's views to run under jsdom: the
// HTMLElement helpers Obsidian adds, and bare ItemView / setIcon.
type Opts = { cls?: string; text?: string; attr?: Record<string, string> };

const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o: Opts = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.text) el.textContent = o.text;
  for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
  this.appendChild(el);
  return el;
};
proto.createDiv = function (o?: Opts) { return this.createEl("div", o); };
proto.createSpan = function (o?: Opts) { return this.createEl("span", o); };
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (c: string) { this.classList.add(c); };
proto.removeClass = function (c: string) { this.classList.remove(c); };
proto.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on); };
proto.setText = function (t: string) { this.textContent = t; };
Object.defineProperty(proto, "doc", { get() { return this.ownerDocument; } });

export class ItemView {
  containerEl = document.createElement("div");
  contentEl = this.containerEl.appendChild(document.createElement("div"));
  constructor(public leaf: unknown) { document.body.appendChild(this.containerEl); }
  registerInterval(id: number) { return id; }
}
export class WorkspaceLeaf {}
export const setIcon = () => {};
