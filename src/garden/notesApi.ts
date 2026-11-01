import type { Site } from "./sites";

/**
 * The notes server is the pipeline's `pipeline categorize` (slackdump-pipeline).
 * Obsidian pages run at app://obsidian.md, and the notes server sends no CORS
 * headers, so every call goes through Obsidian's requestUrl, passed in here so
 * this stays testable without Obsidian.
 */
export type Request = (req: { url: string; method?: string; contentType?: string; body?: string; throw: false }) =>
  Promise<{ status: number; json: unknown; arrayBuffer: ArrayBuffer; headers: Record<string, string> }>;

const absolute = (base: string, path: string) => new URL(path, base.replace(/\/?$/, "/")).toString();

async function call(request: Request, url: string, init: { method?: string; body?: unknown } = {}) {
  const res = await request({
    url,
    throw: false,
    ...(init.method && { method: init.method }),
    ...(init.body !== undefined && { contentType: "application/json", body: JSON.stringify(init.body) }),
  });
  if (res.status >= 400) throw new Error(`${url}: ${res.status}`);
  return res;
}

/** Every queued card, newest first, with its picture and audio as full URLs. */
export async function fetchQueue(base: string, request: Request): Promise<Site[]> {
  const res = await call(request, absolute(base, "/api/canvas/queue"));
  const { cards } = res.json as { cards: Site[] };
  return cards.map(card => ({
    ...card,
    ...(card.image && { image: absolute(base, card.image) }),
    ...(card.audio && { audio: { ...card.audio, src: absolute(base, card.audio.src) } }),
  }));
}

/** A card that isn't a Slack note, straight into the queue. */
export async function addCard(base: string, request: Request, card: { name: string; url?: string; description?: string }) {
  await call(request, absolute(base, "/api/canvas/cards"), { method: "POST", body: card });
}

export async function removeCard(base: string, request: Request, id: string) {
  await call(request, absolute(base, `/api/canvas/cards/${encodeURIComponent(id)}`), { method: "DELETE" });
}

function base64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A picture as a data URL, which the card builder can read without CORS. */
export async function imageDataURL(url: string, request: Request): Promise<string> {
  const res = await call(request, url);
  const type = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "image/png").split(";")[0];
  return `data:${type};base64,${base64(res.arrayBuffer)}`;
}
