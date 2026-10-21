import { drawCat, MARMALADE, RAGDOLL, type Palette } from "../render/draw";
import meshUrl from "../render/gl/cat.mesh?url";
import { GlCat } from "../render/gl/renderer";
import type { Solved } from "../render/rig";
import type { CatCoat } from "../settings";
import type { Quality } from "./governor";

/**
 * How the cat is painted on its canvas. There are two ways, and the host picks one per screen:
 *
 *  - the solid cat (render/gl): a mesh, skinned and covered in fur on the graphics card, lit like a cat in a room;
 *  - the simple cat (render/draw.ts): flat shapes drawn with Canvas 2D, the same cat that a screen without WebGL, or too slow for it, gets.
 *
 * Both are given the same numbers (the rig's) and neither knows anything of the page. A canvas can have only one kind of context, so each brush
 * has a canvas of its own, and changing brush is changing the canvas.
 */

export type Art = "solid" | "classic";

/** Where the cat's feet are on its canvas (CSS pixels from the top left) and how long its body is. */
export interface Place {
  ox: number;
  oy: number;
  px: number;
}

export interface Brush {
  readonly art: Art;
  readonly canvas: HTMLCanvasElement;
  /** The card took the picture away: this brush is no good any more. */
  readonly lost: boolean;
  /** The most the canvas is made finer than the screen's own pixels (a finer canvas costs a card more than a TV can spare). */
  readonly maxDpr: number;
  /** The coat the cat wears from the next picture on (the simple cat has two: the ragdoll's colours, and the ginger's for any other coat). */
  setCoat(coat: CatCoat): void;
  resize(side: number, dpr: number): void;
  /**
   * What the card took for the last picture that was timed, in milliseconds: the picture's own work, with the time the card and the browser take to
   * answer at all taken away (that is the same for any picture, and on a fast card it is most of what a read-back takes). 0 for the simple cat.
   */
  readonly gpuMs: number;
  /**
   * Paints one frame. With `probe`, waits until the card has finished it and says how long the host spent waiting (a card is asked for a picture and
   * answers later, so how long the host spent asking says little of what the picture costs; `gpuMs` is what it does); without, returns 0.
   */
  paint(solved: Solved, place: Place, quality: Quality, probe: boolean): number;
  dispose(): void;
}

function newCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "kino-cat-canvas";
  return canvas;
}

const sized = (canvas: HTMLCanvasElement, side: number): void => {
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
};

/** The simple cat. Null where a canvas cannot draw. */
export function classicBrush(): Brush | null {
  const canvas = newCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let side = 0;
  let scale = 1;
  let palette: Palette = MARMALADE;
  return {
    art: "classic",
    canvas,
    lost: false,
    maxDpr: 2,
    gpuMs: 0,
    setCoat(coat) {
      palette = coat === "ragdoll" ? RAGDOLL : MARMALADE;
    },
    resize(next, dpr) {
      side = next;
      scale = dpr;
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
      sized(canvas, side);
    },
    paint(solved, place) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, side, side);
      drawCat(ctx, palette, solved, place);
      return 0;
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** The solid cat from a mesh that was fetched; null where this browser cannot do WebGL, or the mesh is not one this cat can wear. */
export function solidBrush(mesh: ArrayBuffer): Brush | null {
  const canvas = newCanvas();
  const cat = GlCat.create(canvas, mesh);
  if (!cat) return null;
  let gpuMs = 0;
  return {
    art: "solid",
    canvas,
    get lost() {
      return cat.lost;
    },
    maxDpr: 1.5,
    get gpuMs() {
      return gpuMs;
    },
    setCoat(coat) {
      cat.setCoat(coat);
    },
    resize(side, dpr) {
      cat.resize(side, side, dpr);
      sized(canvas, side);
    },
    paint(solved, place, _quality, probe) {
      // (a screen that has to take the picture down a step is given a smaller one, and fewer of them: see the host; the solid cat has no more to give up)
      cat.draw(solved, place);
      if (!probe) return 0;
      // (the card is asked twice: for what it has been given, and again with nothing left to do. The second answer takes what the card and the browser take
      // to answer at all, which is not the cat's: on a fast card it is nearly all of the first, and on a slow one the first is that and the cat's work)
      const first = performance.now();
      cat.finish();
      const second = performance.now();
      cat.finish();
      const end = performance.now();
      gpuMs = Math.max(0, second - first - (end - second));
      return end - first;
    },
    dispose() {
      cat.dispose();
    },
  };
}

/** The solid cat's mesh, or null if it could not be had in time (a screen on a bad line gets the simple cat rather than waiting for it). */
export async function fetchMesh(timeoutMs = 8000): Promise<ArrayBuffer | null> {
  const control = new AbortController();
  const timer = window.setTimeout(() => control.abort(), timeoutMs);
  try {
    const answer = await fetch(meshUrl, { signal: control.signal });
    return answer.ok ? await answer.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
