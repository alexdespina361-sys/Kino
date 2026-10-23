import { isTvAgent } from "../../role";
import { onCat, setPanelOpen } from "../bus";
import { BODY_EMS } from "../math";
import { CatEngine, type EngineDebug } from "../engine/engine";
import { coreOf, HEIGHT, shapeCovers } from "../engine/shape";
import { temperamentOf } from "../engine/temperament";
import { CatRig } from "../render/rig";
import { createRng } from "../rng";
import { CAT_SIZE_FACTOR, catAsk, catCoatAsk, catLook, catSizeAsk, coatOfLook, readCatSettings, setCatGone, setCatShown, subscribeCatSettings, type CatCoat, type CatWhy } from "../settings";
import { SWAT_HIT, type CatEvent, type CatFrame, type Clip, type PlayerMode, type Rect, type Vec, type World } from "../types";
import "./cat.css";
import { createDebugView, type DebugView } from "./debug";
import { inflate, rectOf, takesRoom } from "./dom";
import { clearPointed, dip, swatPoster } from "./effects";
import { Governor, Revival, type Quality } from "./governor";
import { Hand } from "./hand";
import { tileOf } from "./assistant";
import { TvPage, type PageRead } from "./page";
import { mountPanel, type PanelHandle } from "./panel";
import { classicBrush, fetchCatFiles, solidBrush, type Brush, type CatFiles } from "./render";

/**
 * The cat on a screen: the loop that reads the page, lets the cat's brain decide, and paints it. This is the only file that touches both the page
 * and the cat; everything it knows of the page comes from `TvPage` as numbers, and everything it asks of the cat is an event (see ../types.ts).
 *
 * The cat is one canvas, a few body lengths wide, that follows the cat about the screen (not a canvas the size of the screen to clear at every
 * frame), over a box of the same size as its body that takes a hand. It lives inside the screen it is on (the library's, or the film's, right
 * behind the controls and the subtitles) and goes where that screen goes. It is not in the tab order and not in the reading order: the button in the
 * library's corner and its panel are how the remote, a screen reader and a keyboard reach it.
 */

/**
 * The canvas is this many body lengths wide and tall, with the cat's feet this far down it (as a share of it: a cat that hangs from a lip by its forepaws is drawn up to a body length and
 * a half under the point the frame holds, which is where it ends up standing, so there is that much canvas under the feet).
 */
const CANVAS_BODIES = 4;
const GROUND_AT = 0.62;
/**
 * How long after the picture has changed the card is first asked what a picture costs (it is getting ready for it until then), how often it is asked for the
 * next two, and how often after that (milliseconds). The ask empties the card's whole queue, the page's and a film's with it, so it is rare.
 */
const PROBE_AFTER_MS = 1500;
const PROBE_BURST_MS = 600;
const PROBE_EVERY_MS = 5000;
/** A cat asleep in a film is painted at about this many frames a second (it only breathes, and the film is the screen's work). */
const ASLEEP_GAP_MS = 40;
/** How far a pressed pointer goes (pixels) before the press is a hand taking hold of the cat and not a click that wobbled (which still strokes it). */
const GRAB_SLOP = 8;
/** How wide and how thick the mark of where the cat would be put down is, in body lengths. */
const SPOT_WIDE = 0.95;
const SPOT_THICK = 0.16;
/** A screen that comes round at least this many times a second (smoothed) is keeping up: what the card says a picture costs does not count against the cat then. */
const KEEPING_UP_FPS = 50;

export interface CatHandle {
  /** Tells the cat something, as the page would. */
  send(event: CatEvent): void;
  /** What the cat is doing and what it sees, for a test or a person who looks (see ?cat=debug). */
  snapshot(): CatSnapshot;
  /** Opens or closes the panel. */
  panel(open?: boolean): void;
  /** The page as the cat last read it (plain numbers), to be tried again somewhere else. */
  world(): World | null;
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
  // (a TV's browser and a phone's or a tablet's, which have a finger and not a mouse, are given twice what a computer is: the work of a screen like that is the card's
  // and the page's together, and the page is not the cat's to judge it by. A computer, whose cat is a small part of a screen that has room, is held to two)
  const asked = Number(params.get("catbudget"));
  const handheld = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const budget = Number.isFinite(asked) && asked > 0 ? asked : isTvAgent(navigator.userAgent) || handheld ? 4 : 2;
  const pretend = Math.max(0, Number(params.get("catslow")) || 0);
  let governor = new Governor({ budget });
  let settings = readCatSettings();
  let panel: PanelHandle | null = null;
  let panelHost: HTMLElement | null = null;
  let opener: Element | null = null;
  let emLast = 12;
  // (what the address asks of the coat and the size is for this load only, and wins over what the device keeps)
  const coatNow = () => catCoatAsk() ?? coatOfLook(settings.look);
  // (the cat is the character it looks like: the ginger is friendly and restless, the ragdoll grumpy and lazy; any other coat the address asks for is the cat as it was)
  engine.setTemperament(temperamentOf(coatNow()));
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
  // (where the cat would be put down, while a hand has it: a soft mark on the place, under the cat's own picture)
  const spot = document.createElement("div");
  spot.className = "kino-cat-spot";
  spot.setAttribute("data-testid", "cat-spot");
  wrap.append(spot, hit);
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
  /** When the cat's brain last ran, on which page, and how long of its time the skeleton has not been told of yet (seconds): see `follow`. */
  let thought = 0;
  let thoughtOf: World | null = null;
  let owed = 0;
  let cost = 0;
  /** Where a frame's time goes, smoothed (milliseconds): reading the page, the cat's brain, and painting (less the wait for the card). */
  let phases = { read: 0, think: 0, paint: 0 };
  let fps = 60;
  let lastDebug = 0;
  let read: PageRead | null = null;
  let frame: CatFrame = engine.frame;
  let airborne = false;
  let pointing = false;
  /** How far through a swat the last frame was (0 when it was not swatting), to see the paw land. */
  let swatWas = 0;
  let pointed: string | null = null;
  let pointRetry = 0;
  let pointer: Vec | null = null;
  let pointerAt = -1e9;
  let over = false;
  /** A pointer that is pressed on the cat: where it went down, where it is, and whether it has gone far enough to be a hand that holds the cat. */
  let drag: { id: number; from: Vec; at: Vec; held: boolean } | null = null;
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
    spot.style.width = `${SPOT_WIDE * L}px`;
    spot.style.height = `${SPOT_THICK * L}px`;
  };

  /* ------------------------------ which cat is painted ------------------------------ */

  // The detailed (solid) cat is wanted where the device and the address do not say otherwise: it is the ragdoll, one of the two cats of the settings. Its mesh is
  // fetched, and the cat is not shown until it is there (a cat that changed its look in front of the viewer would be a bad moment); a screen that cannot do it,
  // cannot get it or cannot afford it gets the same cat drawn simply, once, and is not asked again until the page is loaded anew, or somebody asks (the settings
  // page says why the cat is the simple one, and has a button for another try). A card that takes the picture away is not that: a phone does it whenever the page
  // has been in the background, and the cat is made again from the file that was fetched; only one that keeps doing it is given up on (see `Revival`).
  const wantsSolid = (): boolean => {
    const look = catLook();
    return look ? look === "solid" : settings.look === "ragdoll";
  };
  let solidFailed = false;
  let fetching = false;
  /** The cat's files as they came, kept for the cat to be made again without fetching them again. */
  let catFiles: CatFiles | null = null;
  let revival = new Revival();
  /** Why the detailed cat was given up for this load (see `CatWhy`), for the settings page. */
  let failedWhy: CatWhy = "";

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
    // (the simple cat is the one that was wanted when it is the cat that was chosen, or the address asked for it; otherwise the page says why it is not the detailed one)
    setCatShown({ art: next.art, why: next.art === "classic" && wantsSolid() ? failedWhy : "" });
  };

  /** The detailed cat is given up for this load, for this reason. */
  const giveUp = (why: CatWhy): void => {
    solidFailed = true;
    failedWhy = why;
  };

  /** The detailed cat, made again after the card took its picture away. If the card will not give one yet nothing changes, and it is asked again soon. */
  const revive = (): void => {
    const made = catFiles ? solidBrush(catFiles) : null;
    if (made && wantsSolid()) install(made);
    else made?.dispose();
  };

  const choose = (): void => {
    if (stopped) return;
    if (!wantsSolid() || solidFailed) {
      if (brush?.art === "classic") {
        // (and the coat of the one that is there, if the choice has been made again)
        brush.setCoat(coatNow());
        setCatShown({ art: "classic", why: wantsSolid() ? failedWhy : "" });
        return;
      }
      const simple = classicBrush();
      if (simple) install(simple);
      else if (!brush) halt(); // (a browser that cannot draw has no cat)
      return;
    }
    if (brush?.art === "solid") {
      brush.setCoat(coatNow());
      setCatShown({ art: "solid", why: "" });
      return;
    }
    if (fetching) return;
    fetching = true;
    void fetchCatFiles().then((data) => {
      fetching = false;
      if (stopped) return;
      if (data) catFiles = data;
      const made = data ? solidBrush(data) : null;
      if (!made) giveUp(data ? "graphics" : "file");
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

  /**
   * How low from the top of the screen the line along the tops of a found poster's row has to be, for the cat to have room to stand in front of the poster: under everything that is fixed
   * over the top of the rows (the library's words, the top bar, the cat's own card; not what scrolls with the rows, or the tall strips down the sides), and a cat's height more.
   */
  const shelfRoom = (tile: HTMLElement): number => {
    const world = read?.world;
    const rows = tile.closest<HTMLElement>(".tv-rows");
    if (!world || !rows) return 0;
    const top = rows.getBoundingClientRect().top;
    // (the card as it is now: it has just changed from the screen it was on, and the page has not been read since, so what the page has of it is not to be trusted: the zones it overlaps are left out)
    const card = panel?.element();
    const mine = card ? inflate(rectOf(card), 0.3 * emLast) : null;
    let lowest = mine ? mine.y + mine.h : -Infinity;
    for (const zone of world.keepOut) {
      if (zone.y >= top || zone.h >= world.viewport.h / 2) continue;
      if (mine && zone.x < mine.x + mine.w && zone.x + zone.w > mine.x && zone.y < mine.y + mine.h && zone.y + zone.h > mine.y) continue;
      lowest = Math.max(lowest, zone.y + zone.h);
    }
    return Number.isFinite(lowest) ? lowest + (HEIGHT + 0.1) * world.bodyLength : 0;
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
    panel = mountPanel(panelHost, { send: (event) => engine.send(event), point: askToPoint, shelfRoom, rng, close: closePanel });
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

  /** The picture's place and the box a hand is on, put where the brain has the cat (the picture on whole pixels of the screen: the rest of a pixel is in the painting). */
  const putCat = (ix: number, iy: number, L: number): void => {
    if (!brush) return;
    brush.canvas.style.transform = `translate3d(${ix}px, ${iy}px, 0)`;
    // (the box a hand is on is the cat's body and head, as it is drawn now and the way it faces; its tail is not a thing to click)
    const [back, front, high] = coreOf(frame.clip);
    hit.style.transform = `translate3d(${frame.x - origin.x - (frame.facing > 0 ? back : front) * L}px, ${frame.y - origin.y - high * L}px, 0) scale(${back + front}, ${high})`;
  };

  /**
   * A frame that a slow screen is not given a picture for (it gets thirty a second): while the rows of the page go by under the cat, the brain runs and the cat is put where
   * its shelf is now, so that it goes with the shelf at every frame as the shelf does, and is not jerked along behind it at every other one. The skeleton and the picture wait for the
   * next frame that paints (the skeleton is told how long it was). A page that has not moved since the brain last looked costs nothing here; a cat in a hand is moved by the hand.
   */
  const follow = (time: number): void => {
    if (!shown || !brush || !wrap.isConnected || drag?.held) return;
    const now = page.read(time);
    if (now !== read) {
      read = now;
      onRead(now);
    }
    const world = now.world;
    if (world === thoughtOf) return;
    if (pointer && time - pointerAt < 3000) world.pointer = pointer;
    else delete world.pointer;
    const dt = Math.min(thought ? time - thought : 16.7, 100) / 1000;
    thought = time;
    thoughtOf = world;
    owed += dt;
    frame = engine.update(world, dt);
    putCat(Math.floor((frame.x - origin.x - ox) * dpr) / dpr, Math.floor((frame.y - origin.y - oy) * dpr) / dpr, world.bodyLength);
  };

  const loop = (time: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) {
      last = time;
      thought = time;
      return;
    }
    const gap = last ? time - last : 16.7;
    // a slow screen gets thirty frames a second (and its cat goes with the page in between: see `follow`); a screen where the cat is away (and not on its way back) is looked at a few times a second
    if (quality === "low" && gap < 30) {
      follow(time);
      return;
    }
    if (read && !shown && prevMode === "away" && gap < 100) return;
    // a cat asleep in a film only breathes: it is painted a third as often, and the film has the rest of the screen's time
    if (shown && prevMode === "player" && frame.appear > 0.99 && (frame.clip === "curl" || frame.clip === "loaf") && !frame.petted && gap < ASLEEP_GAP_MS) return;
    last = time;
    fps = fps * 0.9 + (1000 / Math.max(1, gap)) * 0.1;
    // (the brain's time is from the last time it ran, which may have been a frame between: see `follow`)
    const dt = Math.min(thought ? time - thought : 16.7, 100) / 1000;
    thought = time;
    const owing = owed;
    owed = 0;
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
    const held = drag?.held === true;
    const says = hand.step(time, over && !held);
    if (says === "pet") engine.send({ type: "cat.pet" });
    else if (says === "end") engine.send({ type: "cat.petEnd" });
    // (a hand that has the cat says so at every frame: a hand that goes quiet is a lost pointer, and the cat is let go)
    if (drag && held) engine.send({ type: "cat.carry", at: drag.at });

    thoughtOf = world;
    frame = engine.update(world, dt);
    const tThink = performance.now();
    const L = world.bodyLength;
    if (brush?.lost) {
      // the card took the picture away (it was reset, the page was in the background, a film needed the memory): the cat is made again, and the simple one only
      // takes its place when the card keeps doing it. (Until there is a new picture the cat is not drawn, and a moment is all that takes.)
      const again = revival.ask(time);
      if (again === "now") revive();
      else if (again === "never") {
        giveUp("lost");
        choose();
      }
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
      rig.update(frame, owing + dt, L);
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
      putCat(ix, iy, L);
    }
    if (visible !== shown) {
      shown = visible;
      wrap.hidden = !visible;
      wrap.setAttribute("data-visible", String(visible));
    }
    // (a hand is the library's: in a film the picture is the player's, with its taps, its double-taps to skip and its holds to speed up, and a box over the cat
    // that took them would be a patch of the picture where none of those worked, and where the cursor came back)
    // (nor is a hand on a cat that hauls itself up over a lip: the frame is the point it ends up at, and the picture hangs below it, so a box there would be on nothing)
    const handOk = visible && world.mode === "browse" && frame.appear > 0.5 && frame.clip !== "climb";
    if (handOk === hit.hasAttribute("data-off")) hit.toggleAttribute("data-off", !handOk);
    if (!handOk) over = false; // (a box that takes no pointer does not say that the pointer left it: a cat that cannot be touched is not being stroked)
    // (a hand can take hold of the cat where the cat is let to move about; the cursor says so)
    const carryable = handOk && !world.quiet && !world.reducedMotion;
    if (carryable !== hit.hasAttribute("data-carry")) hit.toggleAttribute("data-carry", carryable);
    // (and while it has the cat, the place the cat would be put down is marked)
    const landing = held ? engine.landing() : null;
    if (landing) spot.style.transform = `translate3d(${landing.x - origin.x - (SPOT_WIDE * L) / 2}px, ${landing.y - origin.y - (SPOT_THICK * L) / 2}px, 0)`;
    if ((landing !== null) !== spot.hasAttribute("data-on")) spot.toggleAttribute("data-on", landing !== null);

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
    // (and when the paw lands in a swat the poster is swatted: it gives and rocks, the way the paw was going)
    const swatNow = frame.clip === "swat" ? frame.progress : 0;
    if (swatWas < SWAT_HIT && swatNow >= SWAT_HIT) {
      // (the poster under the paw: on the shelf the cat stands on, and where the paw lands; the one the cat was asked to show, if the paw is not on a shelf's own)
      const reach = frame.reach;
      const under = reach ? now.shelves.get(engine.debug().surfaceId ?? "")?.find((tile) => reach.x >= tile.x0 && reach.x <= tile.x1)?.el : undefined;
      const tile = under ?? (pointed ? tileOf(pointed) : null);
      if (tile) swatPoster(tile, 0.07 * L, frame.facing, world.reducedMotion);
    }
    swatWas = swatNow;

    // (the host's own time, less the wait for the card where there was one, plus what the card was last seen to take, when the screen is not keeping up: what a probe
    // costs on a card that is given a picture and has to answer for it at once -- a phone's, whose work is done in tiles at the end -- is mostly the answering, and a
    // screen that is still coming round sixty times a second is a screen that is coping, whatever the answer took)
    const tEnd = performance.now();
    cost = tEnd - tRead - waited + (fps < KEEPING_UP_FPS ? gpu : 0) + (brush?.art === "solid" ? pretend : 0);
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
        giveUp("slow");
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
    // (and a hand that then moves, still pressed, takes hold of it: the pointer is kept for as long as it is down, wherever it goes)
    // (a second hand, a finger while the mouse has the cat, is not the one that lets it go: the first stays the hand until it comes up)
    const press = event as PointerEvent;
    if (press.pointerId !== undefined && press.button === 0 && press.isPrimary !== false && !drag?.held) {
      drag = { id: press.pointerId, from: { x: press.clientX, y: press.clientY }, at: { x: press.clientX, y: press.clientY }, held: false };
      try {
        hit.setPointerCapture(press.pointerId);
      } catch {
        /* a pointer that is already gone cannot be kept */
      }
    }
  };
  const onDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.at = { x: event.clientX, y: event.clientY };
    // (only where a hand can take hold of the cat, which the cursor says: for a quiet cat, or one that is to move as little as it can, the press stays a stroke,
    // and the cursor does not close on a cat that was not lifted)
    if (!drag.held && Math.hypot(drag.at.x - drag.from.x, drag.at.y - drag.from.y) > GRAB_SLOP && hit.hasAttribute("data-carry")) {
      drag.held = true;
      hit.setAttribute("data-held", "");
      engine.send({ type: "cat.grab", at: drag.at });
    }
  };
  /** The hand lets go (the pointer came up, was taken away, or the window lost it): a cat that was held is put down where the engine says. */
  const onRelease = (event?: PointerEvent): void => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const was = drag;
    drag = null;
    hit.removeAttribute("data-held");
    if (was.held) engine.send({ type: "cat.drop" });
    try {
      hit.releasePointerCapture(was.id);
    } catch {
      /* it was let go of already */
    }
  };
  const onBlur = (): void => onRelease();
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
  hit.addEventListener("pointermove", onDrag);
  hit.addEventListener("pointerup", onRelease);
  hit.addEventListener("pointercancel", onRelease);
  hit.addEventListener("lostpointercapture", onRelease);
  hit.addEventListener("contextmenu", onContext);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onBlur);
  document.addEventListener("pointerdown", onOutside, true);
  /** The detailed cat is given another chance, as if the page had just been loaded: its file again, and a screen that is judged afresh. */
  const tryAgain = (): void => {
    solidFailed = false;
    failedWhy = "";
    revival = new Revival();
    governor = new Governor({ budget });
    gpu = 0;
    quality = "full";
    pictureChanged();
    choose();
  };
  const offBus = onCat((command) => {
    if (command.type === "panel") togglePanel();
    else if (command.type === "retry" && !stopped) tryAgain();
  });
  const offSettings = subscribeCatSettings(() => {
    if (stopped) return;
    const before = settings.look;
    settings = readCatSettings();
    engine.setTemperament(temperamentOf(coatNow()));
    // (another cat chosen is a new start: a screen that could not afford the ragdoll is not held to that for the ginger, and one that chose the ragdoll again is asking)
    if (settings.look !== before) tryAgain();
    else choose(); // (or the same cat, asked for again)
    page.touch(); // (and the size: the page is read again, and the cat's body length with it)
  });

  if (debugging) {
    window.__kinoCat = {
      send: (event) => engine.send(event),
      panel: togglePanel,
      world: () => (read ? (JSON.parse(JSON.stringify(read.world)) as World) : null),
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
    hit.removeEventListener("pointermove", onDrag);
    hit.removeEventListener("pointerup", onRelease);
    hit.removeEventListener("pointercancel", onRelease);
    hit.removeEventListener("lostpointercapture", onRelease);
    hit.removeEventListener("contextmenu", onContext);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onBlur);
    offBus();
    offSettings();
    closePanel();
    clearPointed();
    page.dispose();
    debug?.dispose();
    wrap.remove();
    setCatShown({ art: "none", why: "" });
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
