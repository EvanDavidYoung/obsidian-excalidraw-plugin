// jsdom has no canvas. Excalidraw needs a 2D context both when it's imported
// and when it measures text, so give it a stand-in: drawing calls do nothing,
// and text measures as 0.5em per character, which keeps layout assertions
// predictable.
function fakeContext(canvas: HTMLCanvasElement) {
  const state: Record<string | symbol, unknown> = { font: "10px sans-serif", filter: "none", canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (prop === "measureText") {
        return (text: string) => {
          const size = parseFloat(String(target.font)) || 10;
          return {
            width: text.length * size * 0.5,
            actualBoundingBoxAscent: size * 0.8,
            actualBoundingBoxDescent: size * 0.2,
          };
        };
      }
      if (prop in target) return target[prop];
      return (): undefined => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has: () => true,
  });
}

HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return fakeContext(this);
} as unknown as HTMLCanvasElement["getContext"];

// jsdom has no PointerEvent, so Testing Library would fire plain Events with
// no coordinates. A MouseEvent subclass carries clientX/clientY and button.
if (typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEvent as unknown as typeof window.PointerEvent;
}

// Nor pointer capture, which the queue uses while dragging.
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;

// Excalidraw registers its fonts as FontFace objects on document.fonts.
// Neither exists in jsdom; these stand-ins report every font as loaded.
if (typeof globalThis.FontFace === "undefined") {
  class FakeFontFace {
    family: string;
    status = "loaded";
    constructor(family: string, _source: unknown, descriptors: Record<string, string> = {}) {
      this.family = family;
      Object.assign(this, descriptors);
    }
    load() { return Promise.resolve(this); }
  }
  globalThis.FontFace = FakeFontFace as unknown as typeof FontFace;
}
if (!document.fonts) {
  const faces = new Set<unknown>();
  Object.defineProperty(document, "fonts", {
    value: {
      add: (f: unknown) => faces.add(f),
      delete: (f: unknown) => faces.delete(f),
      has: (f: unknown) => faces.has(f),
      check: () => true,
      load: () => Promise.resolve([]),
      ready: Promise.resolve(),
      addEventListener: () => {},
      removeEventListener: () => {},
      [Symbol.iterator]: () => faces.values(),
      forEach: (cb: (f: unknown) => void) => faces.forEach(cb),
    },
  });
}
