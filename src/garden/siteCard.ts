import { lib } from "./excalidraw";
import type { BinaryFileData, DataURL } from "@zsviczian/excalidraw/types/excalidraw/types";
import type { FileId } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import type { Site, Stroke } from "./sites";

export const CARD_WIDTH = 260;
const PAD = 16;
const INNER = CARD_WIDTH - PAD * 2;
const MAX_IMAGE_HEIGHT = 150;

// Excalidraw's pastel fills, cycled per site so neighbours read apart.
const FILLS = ["#fff3bf", "#d3f9d8", "#d0ebff", "#f3d9fa", "#ffe8cc"];

/** A stable fill per card, so a box keeps its colour however the queue reorders. */
export function colourIndex(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** The fill a site's box gets, for the queue to preview it in. */
export const fillOf = (index: number) => FILLS[index % FILLS.length];

export type LoadedImage = {
  file: BinaryFileData;
  width: number;
  height: number;
};

// The sorter's highlighter pens.
const PENS: Record<string, string> = {
  yellow: "#facc15", green: "#4ade80", blue: "#60a5fa", pink: "#f472b6", orange: "#fb923c",
};

// By site, with the marks it was drawn with, so new marks fetch it afresh.
const imageCache = new Map<string, { marks: string; image: Promise<LoadedImage | null> }>();

/** Fetch a site's picture as a data URL Excalidraw can store, with its
 *  highlights drawn in. Null if it has none or it can't be read (e.g. a
 *  remote host without CORS). */
export function loadSiteImage(site: Site): Promise<LoadedImage | null> {
  if (!site.image) return Promise.resolve(null);
  const marks = JSON.stringify(site.highlights ?? []);
  let cached = imageCache.get(site.id);
  if (!cached || cached.marks !== marks) {
    const image = readImage(site).catch((err): null => {
      console.warn(`Could not load image for ${site.name}:`, err);
      return null;
    });
    cached = { marks, image };
    imageCache.set(site.id, cached);
  }
  return cached.image;
}

/** Draws strokes the way the sorter does: translucent ink, multiplied into the picture. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.45;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = PENS[s.color] ?? PENS.yellow;
    ctx.lineWidth = Math.max(2, s.width * w);
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    // A single click still leaves a dot.
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.5, s.points[0][1] * h);
    ctx.stroke();
  }
}

/** The picture with its highlights drawn in, as a PNG; the original is never changed. */
async function withHighlights(dataURL: string, strokes: Stroke[]): Promise<string> {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  drawStrokes(ctx, strokes, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function readImage(site: Site): Promise<LoadedImage> {
  const res = await fetch(site.image!);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  let dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const marked = !!site.highlights?.length;
  if (marked) dataURL = await withHighlights(dataURL, site.highlights!);
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  return {
    file: {
      id: `site-${site.id}` as FileId,
      mimeType: (marked ? "image/png" : blob.type) as BinaryFileData["mimeType"],
      dataURL: dataURL as DataURL,
      created: Date.now(),
    },
    width: img.naturalWidth || 400,
    height: img.naturalHeight || 300,
  };
}

/**
 * Excalidraw sizes a text element when it's created, but only loads a font
 * face once something on the canvas uses it, so the first box would be
 * measured against the fallback font and its text would clip. Load the
 * faces this box's text needs first. (Passing the text matters: the fonts
 * are split by unicode range.)
 */
export function loadCardFonts(site: Site) {
  const body = [site.url, site.description ?? ""].join(" ");
  return Promise.all([
    document.fonts.load("20px Excalifont", site.name),
    document.fonts.load("15px Nunito", body),
  ]).catch(err => console.warn("Card fonts failed to load:", err));
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const hostOf = (url: string) => {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
};

/**
 * One site as a grouped Excalidraw box: a rounded rectangle holding the
 * optional picture, the name, the host and the optional description.
 * (x, y) is the box's top-left corner in scene coordinates.
 */
export function buildSiteElements(site: Site, index: number, x: number, y: number, image: LoadedImage | null) {
  const groupId = `site-group-${site.id}-${Date.now()}`;
  // `placedAt` tells this box from one placed before the site was last sent (see queue.ts).
  const common = { groupIds: [groupId], customData: { siteId: site.id, placedAt: Date.now() } };
  const { convertToExcalidrawElements, FONT_FAMILY, ROUNDNESS } = lib();
  const children: Parameters<typeof convertToExcalidrawElements>[0] = [];

  let cursor = y + PAD;

  if (image) {
    let w = INNER;
    let h = (image.height / image.width) * w;
    if (h > MAX_IMAGE_HEIGHT) {
      h = MAX_IMAGE_HEIGHT;
      w = (image.width / image.height) * h;
    }
    children.push({
      ...common,
      type: "image",
      fileId: image.file.id,
      status: "saved",
      x: x + PAD + (INNER - w) / 2,
      y: cursor,
      width: w,
      height: h,
    });
    cursor += h + 12;
  }

  const nameLines = wrap(site.name, 20);
  children.push({
    ...common,
    type: "text",
    text: nameLines.join("\n"),
    x: x + PAD,
    y: cursor,
    fontSize: 20,
    fontFamily: FONT_FAMILY.Excalifont,
  });
  cursor += nameLines.length * 25 + 4;

  children.push({
    ...common,
    type: "text",
    text: hostOf(site.url),
    x: x + PAD,
    y: cursor,
    fontSize: 14,
    fontFamily: FONT_FAMILY.Nunito,
    strokeColor: "#1971c2",
  });
  cursor += 20;

  if (site.description) {
    const lines = wrap(site.description, 30);
    cursor += 8;
    children.push({
      ...common,
      type: "text",
      text: lines.join("\n"),
      x: x + PAD,
      y: cursor,
      fontSize: 15,
      fontFamily: FONT_FAMILY.Nunito,
      strokeColor: "#495057",
    });
    cursor += lines.length * 15 * 1.35;
  }

  // The box links to the source; the note written from it gets a line of its own.
  if (site.obsidian) {
    cursor += 8;
    children.push({
      ...common,
      type: "text",
      text: "↗ Open in Obsidian",
      x: x + PAD,
      y: cursor,
      fontSize: 14,
      fontFamily: FONT_FAMILY.Nunito,
      strokeColor: "#7c3aed",
      link: site.obsidian,
    });
    cursor += 20;
  }

  const box = {
    ...common,
    type: "rectangle" as const,
    x,
    y,
    width: CARD_WIDTH,
    height: cursor + PAD - y,
    backgroundColor: fillOf(index),
    fillStyle: "solid" as const,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    link: site.url,
  };

  // Box first so it sits underneath its contents.
  return convertToExcalidrawElements([box, ...children]);
}
