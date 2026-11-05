import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import { buildSiteElements, CARD_WIDTH, loadSiteImage, type LoadedImage } from "./siteCard";
import type { Site } from "./sites";

const site: Site = {
  id: "example",
  name: "Example Site",
  url: "https://www.example.com/some/page",
  description: "A short description that is long enough to wrap onto more than one line.",
};

const image = (width: number, height: number, id = "site-example"): LoadedImage => ({
  file: { id, mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 } as LoadedImage["file"],
  width,
  height,
});

const texts = (els: readonly ExcalidrawElement[]) =>
  els.filter(e => e.type === "text").map(e => (e as ExcalidrawElement & { text: string }).text);

describe("buildSiteElements", () => {
  it("puts the box first, at the drop point, linking to the site", () => {
    const [box] = buildSiteElements(site, 0, 100, 200, null);
    expect(box).toMatchObject({
      type: "rectangle",
      x: 100,
      y: 200,
      width: CARD_WIDTH,
      link: site.url,
      fillStyle: "solid",
    });
  });

  it("groups every element and tags it with the site id", () => {
    const els = buildSiteElements(site, 0, 0, 0, image(400, 200));
    const groups = new Set(els.map(e => e.groupIds.join(",")));
    expect(groups.size).toBe(1);
    expect(els[0].groupIds).toHaveLength(1);
    for (const el of els) expect(el.customData).toEqual({ siteId: "example", placedAt: expect.any(Number) });
  });

  it("shows the name, the bare host and the wrapped description", () => {
    const [name, host, description] = texts(buildSiteElements(site, 0, 0, 0, null));
    expect(name).toBe("Example Site");
    expect(host).toBe("example.com");
    expect(description.split("\n").length).toBeGreaterThan(1);
    expect(description.replace(/\n/g, " ")).toBe(site.description);
  });

  it("wraps a long name instead of letting it run past the box", () => {
    const [name] = texts(buildSiteElements({ ...site, name: "A Rather Long Website Name Indeed" }, 0, 0, 0, null));
    expect(name.split("\n").length).toBeGreaterThan(1);
  });

  it("leaves out the description and shrinks the box when there is none", () => {
    const withDesc = buildSiteElements(site, 0, 0, 0, null);
    const without = buildSiteElements({ ...site, description: undefined }, 0, 0, 0, null);
    expect(texts(without)).toEqual(["Example Site", "example.com"]);
    expect(without[0].height).toBeLessThan(withDesc[0].height);
  });

  it("falls back to the raw url when it can't be parsed", () => {
    const [, host] = texts(buildSiteElements({ ...site, url: "not a url" }, 0, 0, 0, null));
    expect(host).toBe("not a url");
  });

  it("links to the site's Obsidian note from a line of its own", () => {
    const url = "obsidian://open?vault=V&file=Garden%2FExample.md";
    const els = buildSiteElements({ ...site, obsidian: url }, 0, 0, 0, null);
    const line = els.find(e => e.link === url)!;
    expect(line).toMatchObject({ type: "text", text: "↗ Open in Obsidian" });
    expect(line.groupIds).toEqual(els[0].groupIds);
    expect(line.y + line.height).toBeLessThanOrEqual(els[0].y + els[0].height);
    expect(els[0].link).toBe(site.url);
  });

  it("has no Obsidian line when there's no note there", () => {
    expect(texts(buildSiteElements(site, 0, 0, 0, null))).not.toContain("↗ Open in Obsidian");
  });

  it("has no image element when the site has no picture", () => {
    expect(buildSiteElements(site, 0, 0, 0, null).some(e => e.type === "image")).toBe(false);
  });

  it("fits a wide picture to the box width, above the text", () => {
    const els = buildSiteElements(site, 0, 0, 0, image(400, 200));
    const img = els.find(e => e.type === "image")!;
    const name = els.find(e => e.type === "text")!;
    expect(img).toMatchObject({ fileId: "site-example", width: CARD_WIDTH - 32, height: (CARD_WIDTH - 32) / 2 });
    expect(img.y + img.height).toBeLessThan(name.y);
  });

  it("caps a tall picture's height and centres it", () => {
    const els = buildSiteElements(site, 0, 0, 0, image(100, 400));
    const img = els.find(e => e.type === "image")!;
    expect(img.height).toBe(150);
    expect(img.width).toBeCloseTo(37.5);
    expect(img.x + img.width / 2).toBeCloseTo(CARD_WIDTH / 2);
  });

  it("keeps every child inside the box", () => {
    const [box, ...children] = buildSiteElements(site, 0, 40, 60, image(400, 300));
    for (const el of children) {
      expect(el.x).toBeGreaterThanOrEqual(box.x);
      expect(el.y).toBeGreaterThanOrEqual(box.y);
      expect(el.x + el.width).toBeLessThanOrEqual(box.x + box.width);
      expect(el.y + el.height).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it("cycles the fill colour by position in the list", () => {
    const fill = (i: number) => buildSiteElements(site, i, 0, 0, null)[0].backgroundColor;
    expect(fill(0)).not.toBe(fill(1));
    expect(fill(0)).toBe(fill(5));
  });
});

describe("loadSiteImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Each test uses its own site id because loaded images are cached by id.
  const withImage = (id: string): Site => ({ id, name: id, url: "https://example.com", image: `/sites/${id}.png` });

  const pngResponse = () => {
    const response = new Response(new Blob(["png"]), { headers: { "content-type": "image/png" } });
    // Node's Response gives a Node Blob, which jsdom's FileReader won't read.
    response.blob = async () => new Blob(["png"], { type: "image/png" });
    return response;
  };

  function stubImageDecoding(width: number, height: number) {
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode() { return Promise.resolve(); }
    });
  }

  it("resolves to null for a site without a picture", async () => {
    expect(await loadSiteImage(site)).toBeNull();
  });

  it("reads the picture as a data URL with its size", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pngResponse());
    vi.stubGlobal("fetch", fetchMock);
    stubImageDecoding(640, 480);

    const loaded = await loadSiteImage(withImage("ok"));

    expect(fetchMock).toHaveBeenCalledWith("/sites/ok.png");
    expect(loaded).toMatchObject({ width: 640, height: 480 });
    expect(loaded!.file).toMatchObject({ id: "site-ok", mimeType: "image/png" });
    expect(loaded!.file.dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it("fetches each picture only once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pngResponse());
    vi.stubGlobal("fetch", fetchMock);
    stubImageDecoding(10, 10);

    const s = withImage("cached");
    await loadSiteImage(s);
    await loadSiteImage(s);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves to null when the picture can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadSiteImage(withImage("missing"))).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
