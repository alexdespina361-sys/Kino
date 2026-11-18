import type { FeedbackAttachmentInput, FeedbackImageType, FeedbackRole } from "../../shared";
import { FEEDBACK_LIMITS } from "../../shared";
import { paintShapes, type Shape } from "./shapes";

export const MAX_SIDE = 2000;
export const TARGET_BYTES = Math.floor(FEEDBACK_LIMITS.imageBytes * 0.9);
export const BUDGET_BYTES = Math.floor(FEEDBACK_LIMITS.totalBytes * 0.93);
const PNG_PIXELS = 2_600_000;

export interface Fitted {
  blob: Blob;
  mime: FeedbackImageType;
  width: number;
  height: number;
}

export function scaleToFit(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const ratio = longest > max ? max / longest : 1;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

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
    const smaller = scaleToFit(width, height, Math.max(Math.round(Math.max(width, height) * 0.8), 64));
    const next = canvasOf(smaller.width, smaller.height);
    const context = next.getContext("2d");
    if (!context) return null;
    context.drawImage(work, 0, 0, smaller.width, smaller.height);
    work = next;
  }
  return null;
}

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
  canvas.width = canvas.height = 0;
  return fitted;
}

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
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

export interface Piece {
  id: string;
  name: string;
  role: "screenshot" | "photo" | "file";
  mime: FeedbackAttachmentInput["mime"];
  blob: Blob;
  width?: number | undefined;
  height?: number | undefined;
  marked?: Fitted | undefined;
  markedUrl?: string | undefined;
  shapes: Shape[];
  note: string;
  url: string;
}

const isPicture = (piece: Piece) => piece.role !== "file";
const covers = (piece: Piece) => piece.shapes.some((shape) => shape.kind === "hide");

export interface Plan {
  items: Array<{ piece: Piece; blob: Blob; mime: FeedbackAttachmentInput["mime"]; role: FeedbackRole; name: string; width?: number | undefined; height?: number | undefined }>;
  bytes: number;
  dropped: number;
}

export function plan(pieces: Piece[], maxFiles: number = FEEDBACK_LIMITS.attachments, maxBytes: number = BUDGET_BYTES): Plan {
  const items: Plan["items"] = [];
  let bytes = 0;
  const behind: Piece[] = [];
  for (const piece of pieces) {
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

export function room(pieces: Piece[], extraBytes: number): boolean {
  const base = pieces.reduce((sum, piece) => sum + (isPicture(piece) && piece.marked && piece.shapes.length > 0 ? piece.marked.blob.size : piece.blob.size), 0);
  return pieces.length < FEEDBACK_LIMITS.attachments && base + extraBytes <= BUDGET_BYTES;
}

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

const TEXT_EXTENSIONS = /\.(txt|log|md|csv|tsv|har|srt|vtt|ass|ssa|xml|yml|yaml|ini|conf|cfg)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i;

export function kindOfFile(name: string, type: string): "image" | "text" | "json" | "other" {
  if (/^image\//i.test(type) || (!type && IMAGE_EXTENSIONS.test(name))) return "image";
  if (type === "application/json" || /\.json$/i.test(name)) return "json";
  if (/^text\//i.test(type) || TEXT_EXTENSIONS.test(name)) return "text";
  return "other";
}

export type Added = { ok: true; piece: Piece } | { ok: false; reason: "type" | "big" | "unreadable" | "full" };

const NAME_OK = /[^\w.\- ]+/g;
const cleanName = (name: string, fallback: string) => name.replace(NAME_OK, "_").replace(/\s+/g, " ").trim().slice(0, 60) || fallback;

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

export function release(piece: Piece): void {
  if (piece.url) URL.revokeObjectURL(piece.url);
  if (piece.markedUrl) URL.revokeObjectURL(piece.markedUrl);
}

export async function withMarks(piece: Piece, shapes: Shape[]): Promise<Piece> {
  if (piece.markedUrl) URL.revokeObjectURL(piece.markedUrl);
  const next: Piece = { ...piece, shapes, marked: undefined, markedUrl: undefined };
  if (shapes.length === 0) return next;
  const marked = await renderMarked(piece.blob, shapes);
  if (!marked) return next;
  return { ...next, marked, markedUrl: URL.createObjectURL(marked.blob) };
}
