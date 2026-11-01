import { describe, expect, it, vi } from "vitest";
import { fetchQueue, imageDataURL, type Request } from "./notesApi";

const reply = (body: unknown, status = 200, contentType = "application/json") =>
  vi.fn<Request>(async () => ({
    status,
    json: body,
    arrayBuffer: new TextEncoder().encode(String(body)).buffer,
    headers: { "content-type": contentType },
  }));

describe("fetchQueue", () => {
  it("asks the notes server for the queue and makes its paths absolute", async () => {
    const request = reply({ cards: [
      { id: "1", name: "a", url: "https://x", image: "/files/a.png", audio: { src: "/files/a.m4a", segments: [] } },
      { id: "2", name: "b", url: "https://y", image: "https://cdn/b.png" },
    ] });
    const cards = await fetchQueue("http://127.0.0.1:8642/", request);
    expect(request).toHaveBeenCalledWith({ url: "http://127.0.0.1:8642/api/canvas/queue", throw: false });
    expect(cards[0].image).toBe("http://127.0.0.1:8642/files/a.png");
    expect(cards[0].audio?.src).toBe("http://127.0.0.1:8642/files/a.m4a");
    expect(cards[1].image).toBe("https://cdn/b.png");
  });

  it("says what went wrong when the server refuses", async () => {
    await expect(fetchQueue("http://h", reply({}, 500))).rejects.toThrow("500");
  });
});

describe("imageDataURL", () => {
  it("reads a picture into a data URL, without needing CORS", async () => {
    const url = await imageDataURL("http://h/files/a.png", reply("hi", 200, "image/png"));
    expect(url).toBe("data:image/png;base64,aGk=");
  });
});
