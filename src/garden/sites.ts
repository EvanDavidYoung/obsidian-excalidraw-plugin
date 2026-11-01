export type Segment = { start: number; text: string };

/** A highlighter stroke from the sorter: points and width as fractions of the
 *  picture's width and height, so it fits the picture at any size. */
export type Stroke = { color: string; width: number; points: [number, number][] };

export type Site = {
  id: string;
  name: string;
  url: string;
  /** Optional picture. Same-origin paths (e.g. /sites/foo.svg) always work;
   *  remote URLs only work if the host sends CORS headers. */
  image?: string;
  /** Optional short description, a sentence or two. */
  description?: string;
  /** What the note is: "link", "audio", "video", "image" or "thought". */
  kind?: string;
  /** Who posted it, when and where, e.g. "evan · 26 Sep · #media". */
  meta?: string;
  /** When it was last sent from the sorter, in ms; a box placed before then
   *  doesn't hide it from the queue. */
  sentAt?: number;
  /** What's been marked on the picture in the sorter, drawn into it on the canvas. */
  highlights?: Stroke[];
  /** An obsidian:// link to the note written from this one in the sorter (O). */
  obsidian?: string;
  /** A voice memo the queue can play, with its timed transcript. */
  audio?: { src: string; segments: Segment[] };
};
