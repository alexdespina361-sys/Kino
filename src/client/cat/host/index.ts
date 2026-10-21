import { isTvAgent } from "../../role";
import { onCat, setPanelOpen } from "../bus";
import { BODY_EMS } from "../math";
import { CatEngine, type EngineDebug } from "../engine/engine";
import { coreOf, shapeCovers } from "../engine/shape";
import { CatRig } from "../render/rig";
import { createRng } from "../rng";
import { CAT_SIZE_FACTOR, catAsk, catCoatAsk, catLook, catSizeAsk, readCatSettings, setCatGone, subscribeCatSettings, type CatCoat } from "../settings";
import type { CatEvent, CatFrame, Clip, PlayerMode, Rect, Vec, World } from "../types";
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
/**
 * How long after the picture has changed the card is first asked what a picture costs (it is getting ready for it until then), how often it is asked for the
 * next two, and how often after that (milliseconds). The ask empties the card's whole queue, the page's and a film's with it, so it is rare.
 */
const PROBE_AFTER_MS = 1500;
const PROBE_BURST_MS = 600;
const PROBE_EVERY_MS = 5000;
/** A cat asleep in a film is painted at about this many frames a second (it only breathes, and the film is the screen's work). */
const ASLEEP_GAP_MS = 40;

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
  /** The coat the detailed cat wears, and how long its body is on this screen, in pixels. */
  coat: CatCoat;
  body: number;
  quality: Quality;
  cost: number;
  fps: number;
  panel: boolean;
  visible: boolean;
  places: number;
  keepOut: number;
  posters: number;
  /** How many names under the cards the cat knows of, and how much of them its body covers just now (in squares of its body length). */
  names: number;
  covers: number;
  /** How many times the page has been read (a page that only sits there is read twice a second). */
  reads: number;
  /** Where a frame's time goes, smoothed, in milliseconds (reading the page, the cat's brain, painting without the wait for the card), and what the card was seen to take. */
  phases: { read: number; think: number; paint: number };
  gpu: number;
}

declare global {
  interface Window {
    __kinoCat?: CatHandle;
  }
}

/** An attribute is written only when it changes (a write of the same value is still a change to anything that watches the page). */
const setAttr = (element: Element, name: string, value: string): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

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
  // (what the address asks of the coat and the size is for this load only, and wins over what the device keeps)
  const coatNow = () => catCoatAsk() ?? settings.coat;
  const page = new TvPage({
    films: () => settings.films,
    quiet: () => settings.quiet,
    own: () => wrap,
    size: () => CAT_SIZE_FACTOR[catSizeAsk() ?? settings.size],
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
  let probedAt = -1e9;
  /** When the first picture after a change (another cat, another quality, another size) was painted (-1: not yet), and how many times the card is still to be asked what that kind of picture costs, soon, before the long wait. */
  let changedAt = -1;
  let burst = 3;
  /** What the card was seen to take at the last few probes (the first picture after a change includes the card getting ready for it: the middle one of them is taken). */
  const taken: number[] = [];
  /** What the card was last seen to take for a frame, in milliseconds, without the time it takes to answer at all (a smoothed number; 0 until it has been timed). */
  let gpu = 0;
  let shown = false;
  let raf = 0;
  let stopped = false;
  /** Takes the cat away because the screen cannot spare it (set below, where everything it takes away is in reach). */
  let halt: () => void = () => undefined;
  let last = 0;
  let cost = 0;
  /** Where a frame's time goes, smoothed (milliseconds): reading the page, the cat's brain, and painting (less the wait for the card). */
  let phases = { read: 0, think: 0, paint: 0 };
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

  /** What the card took for the last picture says nothing of the next one (another cat, another quality, another size): it is looked at afresh. */
  const pictureChanged = (): void => {
    changedAt = -1; // (the card gets ready for the picture when it is first asked for it: the time is counted from then)
    burst = 3;
    taken.length = 0;
    gpu = 0;
  };

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
    // (a square a body length on a side, which is stretched over the cat's body at every frame: see the transform below)
    hit.style.width = `${L}px`;
    hit.style.height = `${L}px`;
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
    pictureChanged();
    next.setCoat(coatNow());
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
    setPanelOpen(false);
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
    setPanelOpen(true);
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
    setAttr(wrap, "data-mode", world.mode);
    setAttr(wrap, "data-view", now.view);
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
    // a cat asleep in a film only breathes: it is painted a third as often, and the film has the rest of the screen's time
    if (shown && prevMode === "player" && frame.appear > 0.99 && (frame.clip === "curl" || frame.clip === "loaf") && !frame.petted && gap < ASLEEP_GAP_MS) return;
    last = time;
    fps = fps * 0.9 + (1000 / Math.max(1, gap)) * 0.1;
    const dt = Math.min(gap, 100) / 1000;
    const t0 = performance.now();

    const now = page.read(time);
    // (what the page costs to read is the page's, laid out as it would be at the next frame whoever asked: it is kept to a tenth of the time by how often it is
    // done (see TvPage.read), and is not counted against the cat)
    const tRead = performance.now();
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
    const tThink = performance.now();
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
      pictureChanged();
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
      // (a card is asked for a picture and answers later: now and then the host waits for the answer, to know what the picture costs. The wait empties the
      // card's whole queue, the page's and a film's with it, so it is done soon after anything about the picture has changed, and only rarely after that)
      if (changedAt < 0) changedAt = time;
      const probe = time - changedAt > PROBE_AFTER_MS && time - probedAt > (burst > 0 ? PROBE_BURST_MS : PROBE_EVERY_MS);
      if (probe) {
        probedAt = time;
        if (burst > 0) burst--;
      }
      waited = brush.paint(rig.solved, { ox: ox + (px - ix), oy: oy + (py - iy), px: L }, quality, probe);
      if (waited > 0) {
        taken.push(brush.gpuMs);
        if (taken.length > 3) taken.shift();
        gpu = [...taken].sort((a, b) => a - b)[(taken.length - 1) >> 1] ?? 0;
      }
      brush.canvas.style.transform = `translate3d(${ix}px, ${iy}px, 0)`;
      // (the box a hand is on is the cat's body and head, as it is drawn now and the way it faces; its tail is not a thing to click)
      const [back, front, high] = coreOf(frame.clip);
      hit.style.transform = `translate3d(${frame.x - origin.x - (frame.facing > 0 ? back : front) * L}px, ${frame.y - origin.y - high * L}px, 0) scale(${back + front}, ${high})`;
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
    const tEnd = performance.now();
    cost = tEnd - tRead - waited + gpu + (brush?.art === "solid" ? pretend : 0);
    phases = {
      read: phases.read * 0.9 + (tRead - t0) * 0.1,
      think: phases.think * 0.9 + (tThink - tRead) * 0.1,
      paint: phases.paint * 0.9 + (tEnd - tThink - waited) * 0.1,
    };
    // (a cat that is not on the screen costs nothing worth judging: what its first pictures take is the card getting ready, and is not counted either)
    const next = visible ? governor.note(cost, gap) : quality;
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
        pictureChanged();
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
  const onPress = (event: Event): void => {
    // (a hand on the cat strokes the cat: it takes nothing else with it, and the remote's focus is where it was)
    event.preventDefault();
    if (event.type === "mousedown") return;
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
  hit.addEventListener("mousedown", onPress);
  hit.addEventListener("contextmenu", onContext);
  document.addEventListener("pointerdown", onOutside, true);
  const offBus = onCat((command) => {
    if (command.type === "panel") togglePanel();
  });
  const offSettings = subscribeCatSettings(() => {
    if (stopped) return;
    settings = readCatSettings();
    choose(); // (the detailed cat may have been switched on or off)
    brush?.setCoat(coatNow());
    page.touch(); // (and the size: the page is read again, and the cat's body length with it)
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
        coat: coatNow(),
        body: read?.world.bodyLength ?? 0,
        quality,
        cost: governor.average,
        fps,
        panel: panel !== null,
        visible: shown,
        places: read?.world.surfaces.length ?? 0,
        keepOut: read?.world.keepOut.length ?? 0,
        posters: read?.world.targets.length ?? 0,
        names: read?.world.soft?.length ?? 0,
        covers: read ? shapeCovers(frame.clip, frame.facing, frame.x, frame.y, read.world.bodyLength, read.world.soft ?? []) / read.world.bodyLength ** 2 : 0,
        reads: page.reads,
        phases: { ...phases },
        gpu,
      }),
    };
  }

  /* ------------------------------ going ------------------------------ */

  /** Everything the cat put on the page and everything it listens to, taken away; the same however it ends, and harmless if asked twice. */
  let gone = false;
  const teardown = (): void => {
    if (gone) return;
    gone = true;
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(pointRetry);
    brush?.dispose();
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerdown", onOutside, true);
    hit.removeEventListener("pointerenter", onEnter);
    hit.removeEventListener("pointerleave", onLeave);
    hit.removeEventListener("pointerdown", onPress);
    hit.removeEventListener("mousedown", onPress);
    hit.removeEventListener("contextmenu", onContext);
    offBus();
    offSettings();
    closePanel();
    clearPointed();
    page.dispose();
    debug?.dispose();
    wrap.remove();
    if (window.__kinoCat) delete window.__kinoCat;
  };

  /** The cat is not worth what it costs on this screen: it goes with everything that was its own, and the rest of the page does not notice (the corner's button goes with it). */
  halt = (): void => {
    teardown();
    setCatGone(true);
  };

  engine.send({ type: "cat.enable" });
  choose();
  raf = requestAnimationFrame(loop);

  return { stop: teardown };
}
