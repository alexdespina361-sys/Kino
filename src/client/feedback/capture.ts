import { fitSource, MAX_SIDE, type Fitted } from "./images";

/**
 * A picture of the screen as it is, made by the page itself (a browser has no way to ask for a screenshot of a page without asking the person to
 * share their screen): the page is copied, with the styles every part of it has, into an SVG that the browser draws like any picture. It is not
 * a photograph of the screen, and some things do not come out (a blurred glass behind a menu, a frame from a stream that comes from another host); the
 * form says so, and a screenshot of the phone's own can be added instead.
 */

export type CaptureFailure = "failed" | "timeout";
export type Captured = { ok: true; fitted: Fitted } | { ok: false; reason: CaptureFailure };

/** What the capture leaves out: the feedback's own screens, and anything that says it is not part of the page. */
export const SKIP = "[data-feedback-skip]";
const TIMEOUT_MS = 30_000;
/** A picture the size of a pixel, for one that could not be fetched (a poster from a host that does not allow it): its place stays empty. */
const NOTHING = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** Not drawn at all. */
const LEAVE_OUT = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "LINK", "IFRAME"]);

export interface View {
  width: number;
  height: number;
}

export function viewOfPage(): View {
  const root = document.documentElement;
  return { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
}

/**
 * The elements worth copying: those that are on the screen, or that have something on it inside. A page of a hundred rows would otherwise be copied
 * whole, for a picture of the ten that can be seen. (Measured before anything is moved: where an element is now is where it is seen.)
 */
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

/** The parts of the page that are scrolled inside (a page of the account, a sheet, a row of posters). The copy of a page does not scroll, so these are shifted by hand. */
function scrolledInside(root: Element): Element[] {
  const found: Element[] = [];
  root.querySelectorAll("*").forEach((element) => {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) found.push(element);
  });
  return found;
}

/** Puts the children of each scrolled part where its scrolling has them; the copy then shows the same. Gives the way back. */
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

/**
 * What the copy is told about scrollbars. A copy is drawn as an image, which has the classic bars (with arrows) wherever something scrolls; on a phone, or with a
 * trackpad, the page itself has the thin ones that take no room. Then the copy has none either, so that it is the page as it was seen, with the same width.
 */
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
        // (The copy's page is not scrolled: it is moved the other way instead, and what is fixed to the screen stays where it is.)
        style: { position: "relative", top: `${-scrollY}px`, left: `${-scrollX}px`, margin: "0" },
        skipFonts: true,
        fontEmbedCSS: scrollbarStyle(), // (no fonts are copied, but this is where a style of the copy's own goes)
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

/** A picture that is all one colour came out wrong (or is a screen with nothing on it, which a second try shows to be). */
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

/** A picture of the page as it is now, or the reason there is none. */
export async function captureScreen(): Promise<Captured> {
  let canvas: HTMLCanvasElement | undefined;
  let reason: CaptureFailure = "failed";
  for (const withoutVideo of [false, true]) {
    try {
      canvas = await copyOfPage(withoutVideo);
      break;
    } catch (error) {
      // (A frame of a stream from another host cannot be copied: the second try is without videos.)
      reason = error instanceof Error && error.message === "timeout" ? "timeout" : "failed";
      if (reason === "timeout") break;
    }
  }
  if (!canvas) return { ok: false, reason };
  if (looksBlank(canvas)) {
    // (Some browsers draw such a picture empty the first time, before the pictures in it have been read.)
    try {
      const again = await copyOfPage(false);
      if (!looksBlank(again)) canvas = again;
    } catch {
      // (the first one stays)
    }
  }
  const fitted = await fitSource(canvas, canvas.width, canvas.height, true);
  canvas.width = canvas.height = 0;
  return fitted ? { ok: true, fitted } : { ok: false, reason: "failed" };
}
