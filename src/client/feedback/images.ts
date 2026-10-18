import type { FeedbackAttachmentInput, FeedbackImageType, FeedbackRole } from "../../shared";
import { FEEDBACK_LIMITS } from "../../shared";
import { paintShapes, type Shape } from "./shapes";

/**
 * Pictures and files for a report. A picture is made smaller before it leaves the page (a phone's photo is several megabytes; the screen of a bug is
 * a few hundred kilobytes) and is drawn again from its pixels, which also takes off what a photo carries about where it was taken.
 */

/** The longest side of a picture that is sent. */
export const MAX_SIDE = 2000;
/** A picture is made to fit under this (the server takes up to FEEDBACK_LIMITS.imageBytes each). */
export const TARGET_BYTES = Math.floor(FEEDBACK_LIMITS.imageBytes * 0.9);
/** What one report may carry in all: a little under what the server takes, so the text and the encoding of it fit in a request. */
export const BUDGET_BYTES = Math.floor(FEEDBACK_LIMITS.totalBytes * 0.93);
/** A screen is a picture of flat colours and text: kept as PNG (sharp) while it is no bigger than this. */
const PNG_PIXELS = 2_600_000;

export interface Fitted {
  blob: Blob;
  mime: FeedbackImageType;
  width: number;
  height: number;
}

/** The size a picture is drawn at: the same shape, its longer side no longer than `max`. */
export function scaleToFit(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const ratio = longest > max ? max / longest : 1;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** A name a report knows a picture by: lowercase letters and numbers, 4 to 24 of them. */
export function newPictureId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return id;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      try {
        // (A browser without toBlob: the picture as an address, read back.)
        const url = canvas.toDataURL(type, quality);
        const comma = url.indexOf(",");
        const binary = atob(url.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: url.slice(5, url.indexOf(";")) }));
      } catch {
        resolve(null);
      }
    }
  });
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Smaller or equal to the target in bytes, as PNG when that is sharp and small enough, else as JPEG at the best quality that fits. */
export async function encodeCanvas(canvas: HTMLCanvasElement, preferPng: boolean): Promise<Fitted | null> {
  let work = canvas;
  for (let round = 0; round < 7; round++) {
    const { width, height } = work;
    if (preferPng && width * height <= PNG_PIXELS) {
      const png = await toBlob(work, "image/png");
      if (png && png.size <= TARGET_BYTES) return { blob: png, mime: "image/png", width, height };
    }
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const jpeg = await toBlob(work, "image/jpeg", quality);
      if (jpeg && jpeg.size <= TARGET_BYTES) return { blob: jpeg, mime: "image/jpeg", width, height };
    }
    // Still too big: a smaller picture, and again.
    const smaller = scaleToFit(width, height, Math.max(Math.round(Math.max(width, height) * 0.8), 64));
    const next = canvasOf(smaller.width, smaller.height);
    const context = next.getContext("2d");
    if (!context) return null;
    context.drawImage(work, 0, 0, smaller.width, smaller.height);
    work = next;
  }
  return null;
}

/** A picture drawn at the size that is sent (on white: a JPEG has no see-through, and what was see-through in a picture is white in a report). */
export async function fitSource(source: CanvasImageSource, naturalWidth: number, naturalHeight: number, preferPng: boolean): Promise<Fitted | null> {
  const { width, height } = scaleToFit(naturalWidth, naturalHeight);
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  const fitted = await encodeCanvas(canvas, preferPng);
  canvas.width = canvas.height = 0; // (let go of the memory at once: a phone has little)
  return fitted;
}

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Reads a picture file into something that can be drawn; rejects when the browser cannot make a picture of it. */
export async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // (A photo is turned the way it was held: that is written in the file, and older browsers leave it to be asked for.)
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
      // (a type it cannot make a bitmap of: the picture element is tried)
    }
  }
  return new Promise<Decoded>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    image.src = url;
  });
}

/** A picture file (or a photo from the camera) as it is sent. `photo`s are kept as JPEG: as PNG they would be many times the size. */
export async function fitFile(file: Blob, role: FeedbackRole): Promise<Fitted | null> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    return null;
  }
  try {
    if (decoded.width < 1 || decoded.height < 1) return null;
    return await fitSource(decoded.source, decoded.width, decoded.height, role !== "photo");
  } finally {
    decoded.close();
  }
}

/** What a picture shows after its marks are drawn over it, at the size it is sent. */
export async function renderMarked(original: Blob, shapes: Shape[]): Promise<Fitted | null> {
  let decoded: Decoded;
  try {
    decoded = await decode(original);
  } catch {
    return null;
  }
  try {
    const canvas = canvasOf(decoded.width, decoded.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(decoded.source, 0, 0);
    paintShapes(context, shapes, decoded.width, decoded.height);
    const fitted = await encodeCanvas(canvas, true);
    canvas.width = canvas.height = 0;
    return fitted;
  } finally {
    decoded.close();
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------ what a report carries ------------------------------ */

/** One thing a person added, kept as the page has it (the pictures as the blobs that are sent, shown from an address made of them). */
export interface Piece {
  id: string;
  name: string;
  /** A picture of a screen, a photo, or a file (text or JSON, which is shown as its name and not as a picture). */
  role: "screenshot" | "photo" | "file";
  mime: FeedbackAttachmentInput["mime"];
  blob: Blob;
  width?: number | undefined;
  height?: number | undefined;
  /** For a picture: what the marks drawn on it look like (when it has any), and the marks themselves (to be opened and changed again). */
  marked?: Fitted | undefined;
  /** ...and where that can be shown from. */
  markedUrl?: string | undefined;
  shapes: Shape[];
  note: string;
  /** Where it can be shown from (an address that stands for the blob). */
  url: string;
}

const isPicture = (piece: Piece) => piece.role !== "file";
/** Something covered with a block is not sent as it was: the block is there so that what is under it is not seen. */
const covers = (piece: Piece) => piece.shapes.some((shape) => shape.kind === "hide");

/** What would be sent for these, in order of how much each is worth: the picture as it was marked (or as it is), then the plain one behind a mark. */
export interface Plan {
  /** The pieces that go, each as the blob and the role it has in the report. */
  items: Array<{ piece: Piece; blob: Blob; mime: FeedbackAttachmentInput["mime"]; role: FeedbackRole; name: string; width?: number | undefined; height?: number | undefined }>;
  bytes: number;
  /** The plain pictures behind marks that were left out for want of room. */
  dropped: number;
}

export function plan(pieces: Piece[], maxFiles: number = FEEDBACK_LIMITS.attachments, maxBytes: number = BUDGET_BYTES): Plan {
  const items: Plan["items"] = [];
  let bytes = 0;
  const behind: Piece[] = [];
  for (const piece of pieces) {
    // A picture with something covered on it that could not be drawn again with the cover is not sent as it was: it is the cover that is to keep it private.
    if (isPicture(piece) && covers(piece) && !piece.marked) continue;
    const marked = isPicture(piece) && piece.marked && piece.shapes.length > 0 ? piece.marked : undefined;
    const blob = marked?.blob ?? piece.blob;
    items.push({
      piece,
      blob,
      mime: marked?.mime ?? piece.mime,
      role: marked ? "annotated" : piece.role,
      name: piece.name,
      ...(marked ? { width: marked.width, height: marked.height } : { width: piece.width, height: piece.height }),
    });
    bytes += blob.size;
    if (marked && !covers(piece)) behind.push(piece);
  }
  let dropped = 0;
  for (const piece of behind) {
    if (items.length < maxFiles && bytes + piece.blob.size <= maxBytes) {
      items.push({ piece, blob: piece.blob, mime: piece.mime, role: piece.role, name: `original-${piece.name}`, width: piece.width, height: piece.height });
      bytes += piece.blob.size;
    } else dropped += 1;
  }
  return { items, bytes, dropped };
}

/** Whether one more piece of this size fits: in the number of files and the bytes a report may carry (the plain pictures behind marks go first, so they do not count). */
export function room(pieces: Piece[], extraBytes: number): boolean {
  const base = pieces.reduce((sum, piece) => sum + (isPicture(piece) && piece.marked && piece.shapes.length > 0 ? piece.marked.blob.size : piece.blob.size), 0);
  return pieces.length < FEEDBACK_LIMITS.attachments && base + extraBytes <= BUDGET_BYTES;
}

/** The report's attachments, in the shape the server takes. */
export async function toAttachments(pieces: Piece[]): Promise<{ attachments: FeedbackAttachmentInput[]; dropped: number }> {
  const { items, dropped } = plan(pieces);
  const attachments: FeedbackAttachmentInput[] = [];
  for (const item of items) {
    attachments.push({
      id: item.name.startsWith("original-") ? `${item.piece.id.slice(0, 20)}o` : item.piece.id,
      name: item.name.slice(0, 80),
      mime: item.mime,
      role: item.role,
      ...(item.piece.note.trim() ? { note: item.piece.note.trim().slice(0, FEEDBACK_LIMITS.note) } : {}),
      ...(item.width ? { width: item.width } : {}),
      ...(item.height ? { height: item.height } : {}),
      data: await blobToBase64(item.blob),
    });
  }
  return { attachments, dropped };
}

/* ------------------------------ files ------------------------------ */

const TEXT_EXTENSIONS = /\.(txt|log|md|csv|tsv|har|srt|vtt|ass|ssa|xml|yml|yaml|ini|conf|cfg)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i;

/** What kind of thing a file is, for a report: a picture to show, a text to read, a JSON, or nothing the report can carry. */
export function kindOfFile(name: string, type: string): "image" | "text" | "json" | "other" {
  if (/^image\//i.test(type) || (!type && IMAGE_EXTENSIONS.test(name))) return "image";
  if (type === "application/json" || /\.json$/i.test(name)) return "json";
  if (/^text\//i.test(type) || TEXT_EXTENSIONS.test(name)) return "text";
  return "other";
}

export type Added = { ok: true; piece: Piece } | { ok: false; reason: "type" | "big" | "unreadable" | "full" };

const NAME_OK = /[^\w.\- ]+/g;
const cleanName = (name: string, fallback: string) => name.replace(NAME_OK, "_").replace(/\s+/g, " ").trim().slice(0, 60) || fallback;

/** Makes a piece of a file a person added, or says why not. Pictures are fitted, texts and JSON are kept as they are when small. */
export async function pieceFromFile(file: File, role: "screenshot" | "photo" | "file", existing: Piece[]): Promise<Added> {
  const kind = kindOfFile(file.name, file.type);
  if (kind === "other") return { ok: false, reason: "type" };
  if (kind === "image") {
    const fitted = await fitFile(file, role === "photo" ? "photo" : "screenshot");
    if (!fitted) return { ok: false, reason: "unreadable" };
    if (!room(existing, fitted.blob.size)) return { ok: false, reason: "full" };
    const extension = fitted.mime === "image/png" ? "png" : "jpg";
    return {
      ok: true,
      piece: {
        id: newPictureId(),
        name: `${cleanName(file.name.replace(/\.[^.]+$/, ""), role === "photo" ? "photo" : "picture")}.${extension}`,
        role: role === "file" ? "screenshot" : role,
        mime: fitted.mime,
        blob: fitted.blob,
        width: fitted.width,
        height: fitted.height,
        shapes: [],
        note: "",
        url: URL.createObjectURL(fitted.blob),
      },
    };
  }
  if (file.size > FEEDBACK_LIMITS.fileBytes) return { ok: false, reason: "big" };
  if (!room(existing, file.size)) return { ok: false, reason: "full" };
  const mime = kind === "json" ? "application/json" : "text/plain";
  return {
    ok: true,
    piece: {
      id: newPictureId(),
      name: cleanName(file.name, kind === "json" ? "file.json" : "file.txt"),
      role: "file",
      mime,
      blob: new Blob([file], { type: mime }),
      shapes: [],
      note: "",
      url: "",
    },
  };
}

/** A picture that was made on the page (a capture), as a piece. */
export function pieceFromFitted(fitted: Fitted, name: string, existing: Piece[]): Added {
  if (!room(existing, fitted.blob.size)) return { ok: false, reason: "full" };
  return {
    ok: true,
    piece: {
      id: newPictureId(),
      name,
      role: "screenshot",
      mime: fitted.mime,
      blob: fitted.blob,
      width: fitted.width,
      height: fitted.height,
      shapes: [],
      note: "",
      url: URL.createObjectURL(fitted.blob),
    },
  };
}

/** The addresses that stand for the blobs are let go when a piece is. */
export function release(piece: Piece): void {
  if (piece.url) URL.revokeObjectURL(piece.url);
  if (piece.markedUrl) URL.revokeObjectURL(piece.markedUrl);
}

/** The piece with its marks as they are now (the picture drawn again with them, or the plain one when there are none). */
export async function withMarks(piece: Piece, shapes: Shape[]): Promise<Piece> {
  if (piece.markedUrl) URL.revokeObjectURL(piece.markedUrl);
  const next: Piece = { ...piece, shapes, marked: undefined, markedUrl: undefined };
  if (shapes.length === 0) return next;
  const marked = await renderMarked(piece.blob, shapes);
  if (!marked) return next; // (the marks could not be drawn: the plain picture goes, and the person is not told of a thing they cannot fix)
  return { ...next, marked, markedUrl: URL.createObjectURL(marked.blob) };
}
