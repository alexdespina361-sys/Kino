import type { EngineDebug } from "../engine/engine";
import type { CatFrame } from "../types";
import type { Quality } from "./governor";
import type { PageRead } from "./page";

/**
 * What `?cat=debug` shows: a few lines of the cat's state, and a map of what the cat sees of the page (the places it can stand on in green, what it
 * keeps out of in red, the names it would rather not settle in front of in orange, the posters it can point to in blue, and where its feet are).
 * Only built when asked for.
 */

export interface DebugInfo {
  read: PageRead;
  frame: CatFrame;
  engine: EngineDebug;
  quality: Quality;
  cost: number;
  fps: number;
  panel: boolean;
  /** Which cat is painted. */
  art: string;
}

export interface DebugView {
  update(info: DebugInfo): void;
  dispose(): void;
}

const two = (value: number): string => value.toFixed(2);

export function createDebugView(): DebugView {
  const text = document.createElement("pre");
  text.className = "kino-cat-debug";
  text.setAttribute("aria-hidden", "true");
  text.setAttribute("data-testid", "cat-debug");
  const map = document.createElement("canvas");
  map.className = "kino-cat-debug-map";
  map.setAttribute("aria-hidden", "true");
  document.body.append(map, text);

  return {
    update({ read, frame, engine, quality, cost, fps, panel, art }) {
      const w = read.world;
      text.textContent = [
        `cat   ${engine.act}${engine.queue.length ? ` > ${engine.queue.join(", ")}` : ""}   mode ${engine.mode}   placed ${engine.placed}`,
        `at    x ${Math.round(frame.x)}  y ${Math.round(frame.y)}  ${frame.clip}  appear ${two(frame.appear)}  on ${engine.surfaceId ?? "-"}${engine.jumpTo ? `  leaping to ${engine.jumpTo}` : ""}`,
        `page  ${read.view}   ${read.why ? `away: ${read.why}` : "here"}   ${w.surfaces.length} places, ${w.keepOut.length} keep-outs, ${w.targets.length} posters`,
        `perf  ${quality}   ${two(cost)} ms   ${Math.round(fps)} fps   body ${w.bodyLength}px   art ${art}`,
        `mood  sleepy ${two(engine.mood.sleepiness)}  lively ${two(engine.mood.energy)}  fond ${two(engine.mood.affection)}  curious ${two(engine.mood.curiosity)}`,
        `panel ${panel ? "open" : "closed"}   player ${w.player}   quiet ${w.quiet}   reduced ${w.reducedMotion}`,
      ].join("\n");

      const dpr = 1;
      if (map.width !== Math.round(innerWidth * dpr) || map.height !== Math.round(innerHeight * dpr)) {
        map.width = Math.round(innerWidth * dpr);
        map.height = Math.round(innerHeight * dpr);
      }
      const ctx = map.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, map.width, map.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(60,255,120,0.9)";
      ctx.fillStyle = "rgba(60,255,120,0.9)";
      ctx.font = "10px monospace";
      for (const surface of w.surfaces) {
        ctx.beginPath();
        ctx.moveTo(surface.x0, surface.y);
        ctx.lineTo(surface.x1, surface.y);
        ctx.stroke();
        ctx.fillText(surface.id, surface.x0 + 2, surface.y - 3);
      }
      ctx.strokeStyle = "rgba(255,70,70,0.85)";
      for (const rect of w.keepOut) ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "rgba(255,170,40,0.85)";
      for (const word of w.soft ?? []) ctx.strokeRect(word.x, word.y, word.w, word.h);
      ctx.strokeStyle = "rgba(80,170,255,0.85)";
      for (const target of w.targets) ctx.strokeRect(target.rect.x, target.rect.y, target.rect.w, target.rect.h);
      ctx.strokeStyle = "rgba(255,230,0,1)";
      ctx.beginPath();
      ctx.moveTo(frame.x - 8, frame.y);
      ctx.lineTo(frame.x + 8, frame.y);
      ctx.moveTo(frame.x, frame.y - 8);
      ctx.lineTo(frame.x, frame.y + 8);
      ctx.stroke();
    },
    dispose() {
      text.remove();
      map.remove();
    },
  };
}
