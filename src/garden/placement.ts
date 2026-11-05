import type { ExcalidrawImperativeAPI } from "@zsviczian/excalidraw/types/excalidraw/types";
import { CaptureUpdate, lib } from "./excalidraw";
import { imageDataURL, type Request } from "./notesApi";
import { buildSiteElements, CARD_WIDTH, colourIndex, loadCardFonts, loadSiteImage } from "./siteCard";
import type { Site } from "./sites";
import { cloneForPlacement, type ShelfItem } from "./shelf";

/**
 * Puts a queued card on a drawing, centred at a point on screen. Its picture is
 * read through requestUrl first (the notes server has no CORS headers), then
 * added to the scene as a file, which the plugin saves into the vault like a
 * pasted image.
 */
export async function placeSite(
  api: ExcalidrawImperativeAPI,
  site: Site,
  clientX: number,
  clientY: number,
  request: Request,
) {
  const readable = site.image && !site.image.startsWith("data:")
    ? { ...site, image: await imageDataURL(site.image, request).catch((): undefined => undefined) }
    : site;
  const [image] = await Promise.all([loadSiteImage(readable), loadCardFonts(site)]);
  const { x, y } = lib().viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
  if (image) api.addFiles([image.file]);
  const elements = buildSiteElements(site, colourIndex(site.id), x - CARD_WIDTH / 2, y - 24, image);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    captureUpdate: CaptureUpdate.IMMEDIATELY,
  } as never);
}

/** The middle of the drawing's view, stepped so repeated picks don't stack exactly. */
export function middleOf(api: ExcalidrawImperativeAPI, step: number) {
  const s = api.getAppState();
  const offset = (step % 6) * 24;
  return { clientX: s.offsetLeft + s.width / 2 + offset, clientY: s.offsetTop + s.height / 2 + offset };
}

/** A shelf item's elements, drawn again centred at a point on screen. */
export function placeShelfItem(api: ExcalidrawImperativeAPI, item: ShelfItem, clientX: number, clientY: number) {
  const { x, y } = lib().viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
  const files = Object.values(item.files);
  if (files.length) api.addFiles(files);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...cloneForPlacement(item.elements, x, y)],
    captureUpdate: CaptureUpdate.IMMEDIATELY,
  } as never);
}
