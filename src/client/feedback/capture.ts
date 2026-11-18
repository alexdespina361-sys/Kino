import { fitSource, MAX_SIDE, type Fitted } from "./images";

export type CaptureFailure = "failed" | "timeout";
export type Captured = { ok: true; fitted: Fitted } | { ok: false; reason: CaptureFailure };

export const SKIP = "[data-feedback-skip]";
const TIMEOUT_MS = 30_000;
const NOTHING = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const LEAVE_OUT = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "LINK", "IFRAME"]);

export interface View {
  width: number;
  height: number;
}

export function viewOfPage(): View {
  const root = document.documentElement;
  return { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
}

export function onScreen(root: Element, view: View, margin = 24): WeakSet<Element> {
  const keep = new WeakSet<Element>();
  const walk = (element: Element): boolean => {
    let inside = false;
    for (const child of Array.from(element.children)) if (walk(child)) inside = true;
    if (!inside) {
      const box = element.getBoundingClientRect();
      inside = box.right >= -margin && box.bottom >= -margin && box.left <= view.width + margin && box.top <= view.height + margin;
    }
    if (inside) keep.add(element);
    return inside;
  };
  walk(root);
  return keep;
}

function scrolledInside(root: Element): Element[] {
  const found: Element[] = [];
  root.querySelectorAll("*").forEach((element) => {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) found.push(element);
  });
  return found;
}

function shiftChildren(scrolled: Element[]): () => void {
  const undo: Array<() => void> = [];
  for (const element of scrolled) {
    const dx = element.scrollLeft;
    const dy = element.scrollTop;
    for (const child of Array.from(element.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const before = child.style.transform;
      const now = getComputedStyle(child).transform;
      child.style.transform = `translate(${-dx}px, ${-dy}px) ${now === "none" ? "" : now}`.trim();
      undo.push(() => {
        child.style.transform = before;
      });
    }
  }
  return () => undo.forEach((back) => back());
}

function backgroundOfPage(): string {
  for (const element of [document.body, document.documentElement]) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return "#0b0b0c";
}

const late = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

function scrollbarStyle(): string {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:-999px;width:100px;height:100px;overflow:scroll";
  document.body.appendChild(probe);
  const room = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return room === 0 ? "*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}" : "";
}

async function copyOfPage(withoutVideo: boolean): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import("html-to-image");
  const view = viewOfPage();
  const keep = onScreen(document.body, view);
  const ratio = Math.max(0.25, Math.min(window.devicePixelRatio || 1, 2, MAX_SIDE / Math.max(view.width, view.height)));
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const restore = shiftChildren(scrolledInside(document.body));
  try {
    return await Promise.race([
      toCanvas(document.body, {
        width: view.width,
        height: view.height,
        pixelRatio: ratio,
        backgroundColor: backgroundOfPage(),
        style: { position: "relative", top: `${-scrollY}px`, left: `${-scrollX}px`, margin: "0" },
        skipFonts: true,
        fontEmbedCSS: scrollbarStyle(),
        imagePlaceholder: NOTHING,
        onImageErrorHandler: () => undefined,
        filter: (node) => {
          if (node.nodeType !== 1) return true;
          if (LEAVE_OUT.has(node.tagName) || node.matches(SKIP) || !keep.has(node)) return false;
          if (node instanceof HTMLVideoElement && (withoutVideo || node.clientWidth === 0 || node.clientHeight === 0)) return false;
          return true;
        },
      }),
      late(TIMEOUT_MS),
    ]);
  } finally {
    restore();
  }
}

export function looksBlank(canvas: HTMLCanvasElement): boolean {
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 24;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(canvas, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);
    for (let i = 4; i < data.length; i += 4) {
      if (Math.abs(data[i]! - data[0]!) + Math.abs(data[i + 1]! - data[1]!) + Math.abs(data[i + 2]! - data[2]!) > 12) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function captureScreen(): Promise<Captured> {
  let canvas: HTMLCanvasElement | undefined;
  let reason: CaptureFailure = "failed";
  for (const withoutVideo of [false, true]) {
    try {
      canvas = await copyOfPage(withoutVideo);
      break;
    } catch (error) {
      reason = error instanceof Error && error.message === "timeout" ? "timeout" : "failed";
      if (reason === "timeout") break;
    }
  }
  if (!canvas) return { ok: false, reason };
  if (looksBlank(canvas)) {
    try {
      const again = await copyOfPage(false);
      if (!looksBlank(again)) canvas = again;
    } catch {
    }
  }
  const fitted = await fitSource(canvas, canvas.width, canvas.height, true);
  canvas.width = canvas.height = 0;
  return fitted ? { ok: true, fitted } : { ok: false, reason: "failed" };
}
