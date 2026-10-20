import { isTvAgent } from "../../role";
import { onCat } from "../bus";
import { BODY_EMS } from "../math";
import { CatEngine, type EngineDebug } from "../engine/engine";
import { CatRig } from "../render/rig";
import { createRng } from "../rng";
import { catAsk, catLook, readCatSettings, subscribeCatSettings } from "../settings";
import type { CatEvent, CatFrame, PlayerMode, Rect, Vec, World } from "../types";
import "./cat.css";
import { createDebugView, type DebugView } from "./debug";
import { inflate, rectOf, takesRoom } from "./dom";
import { clearPointed, dip } from "./effects";
import { Governor, type Quality } from "./governor";
import { Hand } from "./hand";
import { tileOf } from "./assistant";
import { TvPage, type PageRead } from "./page";
import { mountPanel, type PanelHandle } from "./panel";
import { classicBrush, fetchMesh, solidBrush, type Brush } from "./render";

/**
 * The cat on a screen: the loop that reads the page, lets the cat's brain decide, and paints it. This is the only file that touches both the page
 * and the cat; everything it knows of the page comes from `TvPage` as numbers, and everything it asks of the cat is an event (see ../types.ts).
 *
 * The cat is one canvas, a few body lengths wide, that follows the cat about the screen (not a canvas the size of the screen to clear at every
 * frame), over a box of the same size as its body that takes a hand. It lives inside the screen it is on (the library's, or the film's, right
 * behind the controls and the subtitles) and goes where that screen goes. It is not in the tab order and not in the reading order: the button in the
 * library's corner and its panel are how the remote, a screen reader and a keyboard reach it.
 */

/** The canvas is this many body lengths wide and tall, with the cat's feet this far down it. */
const CANVAS_BODIES = 4;
const GROUND_AT = 0.8;
/** The box that takes a hand: this many body lengths wide and tall, with its foot at the cat's feet. */
const HIT_W = 1.25;
const HIT_H = 0.95;

export interface CatHandle {
  /** Tells the cat something, as the page would. */
  send(event: CatEvent): void;
  /** What the cat is doing and what it sees, for a test or a person who looks (see ?cat=debug). */
  snapshot(): CatSnapshot;
  /** Opens or closes the panel. */
  panel(open?: boolean): void;
}

export interface CatSnapshot {
  frame: CatFrame;
  engine: EngineDebug;
  view: string;
  why: string;
  /** Which cat is painted: the solid one, the simple one, or none yet (the solid one is still being fetched). */
  art: "solid" | "classic" | "none";
  quality: Quality;
  cost: number;
  fps: number;
  panel: boolean;
  visible: boolean;
  places: number;
  keepOut: number;
  posters: number;
}

declare global {
  interface Window {
    __kinoCat?: CatHandle;
  }
}

const seedOf = (search: string): number => {
  const asked = Number(new URLSearchParams(search).get("catseed"));
  return Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : Math.floor(Math.random() * 2 ** 31) + 1;
};

export function mountCat(): { stop: () => void } {
  const debugging = catAsk() === "debug";
  const seed = seedOf(location.search);
  const params = new URLSearchParams(location.search);
  const engine = new CatEngine(seed);
  const rig = new CatRig(seed);
  const rng = createRng(seed).fork("assistant");
  const hand = new Hand();
  // (`?catbudget=N`: how many milliseconds a frame may cost before the cat is made cheaper; a large number keeps a slow screen's cat as it is, for looking at it)
  // (`?catslow=N`: the detailed cat is taken to cost N milliseconds more a frame than it does, for seeing what a screen that cannot afford it is given)
  const asked = Number(params.get("catbudget"));
  const budget = Number.isFinite(asked) && asked > 0 ? asked : isTvAgent(navigator.userAgent) ? 4 : 2;
  const pretend = Math.max(0, Number(params.get("catslow")) || 0);
  let governor = new Governor({ budget });
  let settings = readCatSettings();
  let panel: PanelHandle | null = null;
  let panelHost: HTMLElement | null = null;
  let opener: Element | null = null;
  let emLast = 12;
  const page = new TvPage({
    films: () => settings.films,
    quiet: () => settings.quiet,
    extra: () => {
      const box = panel?.element();
      return box && takesRoom(box) ? [inflate(rectOf(box), 0.3 * emLast)] : [];
    },
  });

  /* ------------------------------ the layer ------------------------------ */

  const wrap = document.createElement("div");
  wrap.className = "kino-cat";
  wrap.setAttribute("aria-hidden", "true");
  wrap.setAttribute("data-testid", "cat");
  wrap.hidden = true;
  // (the library puts a rule on everything it holds that makes it a block in the flow: this is a layer over it)
  wrap.style.setProperty("position", "absolute", "important");
  const hit = document.createElement("div");
  hit.className = "kino-cat-hit";
  hit.setAttribute("data-off", "");
  hit.setAttribute("data-testid", "cat-hit");
  wrap.append(hit);
  // (the cat's canvas goes in front of the box that takes a hand once there is a brush to paint it; which brush it is, is decided below)
  let brush: Brush | null = null;

  const debug: DebugView | null = debugging ? createDebugView() : null;

  let origin: Vec = { x: 0, y: 0 };
  let side = 0;
  let ox = 0;
  let oy = 0;
  let dpr = 1;
  let layoutKey = "";
  let quality: Quality = "full";
  let frames = 0;
  /** What the card was last seen to take for a frame, in milliseconds (a smoothed number; 0 until it has been timed). */
  let gpu = 0;
  let shown = false;
  let raf = 0;
  let stopped = false;
  let last = 0;
  let cost = 0;
  let fps = 60;
  let lastDebug = 0;
  let read: PageRead | null = null;
  let frame: CatFrame = engine.frame;
  let airborne = false;
  let pointing = false;
  let pointed: string | null = null;
  let pointRetry = 0;
  let pointer: Vec | null = null;
  let pointerAt = -1e9;
  let over = false;
  let prevMode: World["mode"] = "away";
  let prevPlayer: PlayerMode = "none";
  let prevFocus: string | undefined;

  const attach = (home: NonNullable<PageRead["home"]>): void => {
    const { parent, after } = home;
    if (wrap.parentNode !== parent || (after && wrap.previousSibling !== after)) parent.insertBefore(wrap, after ? after.nextSibling : null);
    origin = rectOf(parent);
  };

  const layout = (L: number, wanted: number): void => {
    dpr = wanted;
    side = Math.ceil(CANVAS_BODIES * L);
    ox = side / 2;
    oy = side * GROUND_AT;
    brush?.resize(side, dpr);
    hit.style.width = `${HIT_W * L}px`;
    hit.style.height = `${HIT_H * L}px`;
  };

  /* ------------------------------ which cat is painted ------------------------------ */

  // The detailed (solid) cat is wanted where the device and the address do not say otherwise. Its mesh is fetched, and the cat is not shown until it
  // is there (a cat that changed its look in front of the viewer would be a bad moment); a screen that cannot do it, cannot get it, loses its picture
  // of it or cannot afford it gets the simple one, once, and is not asked again until the page is loaded anew.
  const wantsSolid = (): boolean => {
    const look = catLook();
    return look ? look === "solid" : settings.detail;
  };
  let solidFailed = false;
  let fetching = false;

  const install = (next: Brush): void => {
    const old = brush;
    brush = next;
    wrap.insertBefore(next.canvas, old ? old.canvas : hit);
    if (old) {
      old.canvas.remove();
      old.dispose();
    }
    layoutKey = ""; // (the new canvas is sized at the next frame)
  };

  const choose = (): void => {
    if (stopped) return;
    if (!wantsSolid() || solidFailed) {
      if (brush?.art === "classic") return;
      const simple = classicBrush();
      if (simple) install(simple);
      else if (!brush) halt(); // (a browser that cannot draw has no cat)
      return;
    }
    if (brush?.art === "solid" || fetching) return;
    fetching = true;
    void fetchMesh().then((data) => {
      fetching = false;
      if (stopped) return;
      const made = data ? solidBrush(data) : null;
      if (!made) solidFailed = true;
      if (made && wantsSolid()) install(made);
      else {
        made?.dispose();
        choose();
      }
    });
  };

  /* ------------------------------ the panel ------------------------------ */

  const askToPoint = (id: string): void => {
    pointed = id;
    window.clearTimeout(pointRetry);
    engine.send({ type: "cat.enable" });
    engine.send({ type: "cat.point", targetId: id });
    // (a cat that was sent away is only back in the next frames: if it was not able to hear the first time, it is told again)
    pointRetry = window.setTimeout(() => {
      const now = engine.debug();
      if (!stopped && pointed === id && now.act !== "point" && !now.queue.includes("point")) engine.send({ type: "cat.point", targetId: id });
    }, 1800);
  };

  const closePanel = (): void => {
    if (!panel) return;
    const gone = panel;
    const goneHost = panelHost;
    panel = null;
    panelHost = null;
    window.clearTimeout(pointRetry);
    pointed = null;
    clearPointed();
    // (not from inside the panel's own handler: it is taken down once that has finished)
    queueMicrotask(() => {
      gone.unmount();
      goneHost?.remove();
    });
    const back = opener instanceof HTMLElement && opener.isConnected ? opener : document.querySelector<HTMLElement>("[data-cat-chip]");
    opener = null;
    back?.focus({ preventScroll: true });
    page.touch();
  };

  const openPanel = (): void => {
    if (panel || stopped || read?.world.mode !== "browse") return;
    const tv = document.querySelector<HTMLElement>("main.tv");
    if (!tv) return;
    opener = document.activeElement;
    panelHost = document.createElement("div");
    panelHost.className = "cat-panel-host";
    tv.appendChild(panelHost);
    panel = mountPanel(panelHost, { send: (event) => engine.send(event), point: askToPoint, rng, close: closePanel });
    page.touch();
  };

  const togglePanel = (open?: boolean): void => {
    const want = open ?? !panel;
    if (want) openPanel();
    else closePanel();
  };

  /* ------------------------------ what the page tells the cat ------------------------------ */

  /** The page was read again: what changed on it that the cat is told of. */
  const onRead = (now: PageRead): void => {
    const world = now.world;
    emLast = world.bodyLength / BODY_EMS;
    if (now.focusId !== prevFocus) {
      prevFocus = now.focusId;
      if (now.focusId) engine.send({ type: "catalog.itemFocused", id: now.focusId });
    }
    // (the film's own changes; a film that has only just come up is the scene changing, which the cat follows by itself)
    if (world.mode === "player" && prevMode === "player" && world.player !== prevPlayer) {
      const type = world.player === "playing" ? (prevPlayer === "paused" ? "player.resume" : "player.play") : world.player === "paused" ? "player.pause" : world.player === "ended" ? "player.ended" : world.player === "error" ? "player.error" : null;
      if (type) engine.send({ type });
    }
    prevMode = world.mode;
    prevPlayer = world.player;
    if (panel && world.mode !== "browse") closePanel();
    if (now.home) attach(now.home);
    wrap.setAttribute("data-mode", world.mode);
    wrap.setAttribute("data-view", now.view);
  };

  /* ------------------------------ the loop ------------------------------ */

  const loop = (time: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) {
      last = time;
      return;
    }
    const gap = last ? time - last : 16.7;
    // a slow screen gets thirty frames a second; a screen where the cat is away (and not on its way back) is looked at a few times a second
    if (quality === "low" && gap < 30) return;
    if (read && !shown && prevMode === "away" && gap < 100) return;
    last = time;
    fps = fps * 0.9 + (1000 / Math.max(1, gap)) * 0.1;
    const dt = Math.min(gap, 100) / 1000;
    const t0 = performance.now();

    const now = page.read(time);
    if (now !== read) {
      read = now;
      onRead(now);
    }
    const world = now.world;
    if (pointer && time - pointerAt < 3000) world.pointer = pointer;
    else delete world.pointer;
    const says = hand.step(time, over);
    if (says === "pet") engine.send({ type: "cat.pet" });
    else if (says === "end") engine.send({ type: "cat.petEnd" });

    frame = engine.update(world, dt);
    const L = world.bodyLength;
    if (brush?.lost) {
      // the card took the picture away (it was reset, or needed for something else): the simple cat carries on
      solidFailed = true;
      choose();
    }
    const wanted = quality === "low" || !brush ? 1 : Math.min(brush.maxDpr, window.devicePixelRatio || 1);
    const key = `${L}|${wanted}`;
    if (key !== layoutKey) {
      layoutKey = key;
      layout(L, wanted);
    }

    const visible = frame.appear > 0.01 && wrap.isConnected && brush !== null;
    let waited = 0;
    if (visible && brush) {
      if (!shown) rig.snapTo(frame, L); // (a cat that comes in is already in its pose: it does not settle into it in front of the viewer)
      rig.update(frame, dt, L);
      const px = frame.x - origin.x - ox;
      const py = frame.y - origin.y - oy;
      const ix = Math.floor(px * dpr) / dpr;
      const iy = Math.floor(py * dpr) / dpr;
      // (a card is asked for a picture and answers later: twice a second the host waits for the answer, to know what the picture costs)
      frames++;
      waited = brush.paint(rig.solved, { ox: ox + (px - ix), oy: oy + (py - iy), px: L }, quality, frames % 30 === 0);
      if (waited > 0) gpu = gpu === 0 ? waited : gpu * 0.7 + waited * 0.3;
      brush.canvas.style.transform = `translate3d(${ix}px, ${iy}px, 0)`;
      hit.style.transform = `translate3d(${frame.x - origin.x - (HIT_W * L) / 2}px, ${frame.y - origin.y - HIT_H * L}px, 0)`;
    }
    if (visible !== shown) {
      shown = visible;
      wrap.hidden = !visible;
      wrap.setAttribute("data-visible", String(visible));
    }
    const handOk = visible && world.mode !== "away" && frame.appear > 0.5;
    if (handOk === hit.hasAttribute("data-off")) hit.toggleAttribute("data-off", !handOk);

    // the page answers the cat: a poster gives under its feet when it lands, and when it puts a paw out to one
    if (airborne && frame.grounded) {
      const tiles = now.shelves.get(engine.debug().surfaceId ?? "");
      const under = tiles?.find((tile) => frame.x >= tile.x0 && frame.x <= tile.x1);
      if (under) dip(under.el, 0.045 * L, world.reducedMotion);
    }
    airborne = !frame.grounded;
    const reaching = frame.clip === "point";
    if (reaching && !pointing && pointed) {
      const tile = tileOf(pointed);
      if (tile) dip(tile, 0.03 * L, world.reducedMotion);
    }
    pointing = reaching;

    // (the host's own time, less the wait for the card where there was one, plus what the card was last seen to take)
    cost = performance.now() - t0 - waited + gpu + (brush?.art === "solid" ? pretend : 0);
    const next = governor.note(cost, gap);
    if (next !== quality) {
      if (next === "off" && brush?.art === "solid") {
        // the detailed cat is more than this screen can spare; the simple one is a tenth of it, and is judged afresh
        solidFailed = true;
        governor = new Governor({ budget });
        gpu = 0;
        quality = "full";
        choose();
      } else {
        quality = next;
        if (quality === "off") {
          halt();
          return;
        }
      }
    }
    if (debug && time - lastDebug > 150) {
      lastDebug = time;
      debug.update({ read: now, frame, engine: engine.debug(), quality, cost: governor.average, fps, panel: panel !== null, art: brush?.art ?? "none" });
    }
  };

  /** The cat is not worth what it costs on this screen: it goes, and the rest of the page does not notice. */
  const halt = (): void => {
    stopped = true;
    cancelAnimationFrame(raf);
    wrap.hidden = true;
    brush?.dispose();
    closePanel();
    clearPointed();
  };

  /* ------------------------------ the viewer's hand ------------------------------ */

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    pointer = { x: event.clientX, y: event.clientY };
    pointerAt = performance.now();
  };
  const onEnter = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") over = true;
  };
  const onLeave = (): void => {
    over = false;
  };
  const onPress = (): void => {
    hand.press(performance.now());
    engine.send({ type: "cat.pet" });
  };
  const onContext = (event: Event): void => {
    event.preventDefault();
    togglePanel();
  };
  const onOutside = (event: PointerEvent): void => {
    if (!panel) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && (panelHost?.contains(target) || target.closest("[data-cat-chip]"))) return;
    closePanel();
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  hit.addEventListener("pointerenter", onEnter);
  hit.addEventListener("pointerleave", onLeave);
  hit.addEventListener("pointerdown", onPress);
  hit.addEventListener("contextmenu", onContext);
  document.addEventListener("pointerdown", onOutside, true);
  const offBus = onCat((command) => {
    if (command.type === "panel") togglePanel();
  });
  const offSettings = subscribeCatSettings(() => {
    settings = readCatSettings();
    choose(); // (the detailed cat may have been switched on or off)
    page.touch();
  });

  if (debugging) {
    window.__kinoCat = {
      send: (event) => engine.send(event),
      panel: togglePanel,
      snapshot: () => ({
        frame: { ...frame },
        engine: engine.debug(),
        view: read?.view ?? "",
        why: read?.why ?? "",
        art: brush?.art ?? "none",
        quality,
        cost: governor.average,
        fps,
        panel: panel !== null,
        visible: shown,
        places: read?.world.surfaces.length ?? 0,
        keepOut: read?.world.keepOut.length ?? 0,
        posters: read?.world.targets.length ?? 0,
      }),
    };
  }

  engine.send({ type: "cat.enable" });
  choose();
  raf = requestAnimationFrame(loop);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(pointRetry);
      brush?.dispose();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onOutside, true);
      hit.removeEventListener("pointerenter", onEnter);
      hit.removeEventListener("pointerleave", onLeave);
      hit.removeEventListener("pointerdown", onPress);
      hit.removeEventListener("contextmenu", onContext);
      offBus();
      offSettings();
      closePanel();
      clearPointed();
      page.dispose();
      debug?.dispose();
      wrap.remove();
      if (window.__kinoCat) delete window.__kinoCat;
    },
  };
}
