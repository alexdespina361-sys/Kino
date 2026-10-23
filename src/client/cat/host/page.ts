import { BODY_EMS, bodyLengthFor } from "../math";
import type { PlayerMode, Rect, Surface, Target, World } from "../types";
import { carried, type Rides } from "./carry";
import { inflate, nameOf, rectOf, takesRoom, textRect } from "./dom";
import { LINE_GAP, lies, mergeLines, placesInFront, zoneOf, type Line } from "./lines";
import { perchesFor } from "./perch";
import { readPieces } from "./text";

/**
 * The page as the cat sees it. Reads the TV's own screens (the library, and a film's picture) and says, as a `World` of plain numbers: the lines the
 * cat can stand on (the tops of the rows of posters, the foot of the screen, a corner of the picture), what it must keep out of (the words, the
 * buttons, the card that has the remote's focus, the subtitles and the controls), the posters it can look at or point to, and whether to be there
 * at all (a menu, a settings page or a film's menu is open: the cat is away). It only reads; nothing is written to the page.
 *
 * A read of the page costs, so it is done when something may have changed (a scroll, a focus, a change in the tree, a transition), at most every
 * frame while the page is moving and every tenth of a second otherwise, and the cat is handed the same world until it does.
 */

/** Things that, when open, are in front of everything: the cat gives way to them. */
const MODALS = '[role="dialog"], [aria-modal="true"], .tv-menu-backdrop, .tv-detail, .tv-screen, .tv-welcome';

/**
 * The parts of the library's page that are boxes of words and buttons, and that are kept out of whole (the words and the buttons themselves are read from the page, whatever
 * they are called: see `text.ts`; these are for what is drawn that is not words: the strip of icons down the side, the round buttons of the top bar).
 */
const BROWSE_FURNITURE = [".tv-browse-top", ".tv-rail", ".tv-hero-text", ".tv-hero-profile", ".tv-notice", ".tv-rows-note", ".tv-row-more", ".tv-view-foot", ".tv-filters", ".tv-keys", ".tv-query"];

/** The longest, in milliseconds, that a page which is moving is left unread, however dear a read is. */
const MOVING_GAP_MAX = 90;

export interface PageTile {
  el: HTMLElement;
  /** The catalogue's id. */
  id: string;
  surfaceId: string;
  /** The tile's laid-out box (as it is without the grow of the focus), which the poster dips under the cat by. */
  x0: number;
  x1: number;
}

export interface PageRead {
  world: World;
  /** The poster the viewer is on with the remote or the pointer, if there is one. */
  focusId?: string;
  /** Which page of the library, or a film: for the cat to notice a change of page. */
  view: string;
  /** Where a canvas for the cat belongs: in `parent`, straight after `after` (a film: right after the picture, so every control and subtitle is drawn over it) or at the end (the library); or none: the page is not one the cat can be on. */
  home: { parent: HTMLElement; after: Element | null } | null;
  /** The posters on the shelves of the page, by shelf. */
  shelves: Map<string, PageTile[]>;
  /** Whether the page asked for the cat to be away, and why (for the diagnostics). */
  why: string;
}

export interface PageContext {
  films: () => boolean;
  quiet: () => boolean;
  /** The cat's own layer: what it does to its own nodes (it moves its canvas at every frame) is not the page changing, and is not read again for. */
  own?: () => Element | null;
  /** How big the cat is against what the screen's size makes of it (1 if not given). */
  size?: () => number;
  /** More places the cat keeps out of, that are not part of the screen's own page (the cat's own panel). */
  extra?: () => Rect[];
}

interface Draft {
  surfaces: Surface[];
  keepOut: Rect[];
  targets: Target[];
  shelves: Map<string, PageTile[]>;
  /** The names under the cards (see `World.soft`). */
  soft: Rect[];
  focus?: Rect;
  focusId?: string;
  /** What scrolls, if the page has a scroller (the rows, or a grid of posters), and which of the zones and the card with the focus are on it (see `carried`). */
  scroller: HTMLElement | null;
  keepOutRides: boolean[];
  focusRides: boolean;
}

/** How many cards' names are kept for the cat to settle clear of (a page has more cards than a screen shows; the ones in view come first). */
const MAX_SOFT = 80;
/** How many lines of words and buttons a page is read for (a screen holds a few dozen; a page of a thousand cards is read as far as this). */
const MOST_PIECES = 500;

const tileId = (el: HTMLElement): string | undefined => el.dataset.entry || undefined;

/** The laid-out box of a tile: the grow of the focus (`scale`, about the middle) is taken away, so a card does not move the line the cat stands on when it is chosen. */
function laidOut(el: HTMLElement): Rect {
  const box = rectOf(el);
  const w = el.offsetWidth || box.w;
  const h = el.offsetHeight || box.h;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export class TvPage {
  private world: World | null = null;
  private last: PageRead | null = null;
  private dirtyAt = true;
  private movingUntil = 0;
  private builtAt = -1e9;
  private built = 0;
  private buildMs = 0;
  private readonly observer: MutationObserver | null;
  private readonly off: Array<() => void> = [];
  private signature = "";
  /** The scroller of the page as it was read, where it was scrolled to then, and what of the page is on it (see `carried`). */
  private ride: { scroller: HTMLElement; top: number; rides: Rides } | null = null;
  /** The page carried on to the scroller's place at some frame, for the next frames if it has not moved since. */
  private onward: { built: number; shift: number; world: World } | null = null;

  constructor(private readonly context: PageContext) {
    const touch = () => this.touch();
    const move = () => this.moving();
    const on = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
      target.addEventListener(type, listener, { capture, passive: true });
      this.off.push(() => target.removeEventListener(type, listener, { capture }));
    };
    on(window, "scroll", move, true);
    on(window, "resize", touch);
    on(window, "focusin", touch, true);
    on(window, "focusout", touch, true);
    on(window, "transitionrun", move, true);
    on(window, "transitionend", move, true);
    on(window, "animationstart", move, true);
    on(window, "animationend", move, true);
    on(document, "visibilitychange", touch);
    on(document, "fullscreenchange", touch);
    // (the cat's layer is inside the page it reads, and its canvas is moved at every frame: if that counted, every read would ask for the next)
    this.observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            const own = this.context.own?.();
            if (!own || records.some((record) => !own.contains(record.target))) touch();
          });
    this.observer?.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-state", "data-hud", "data-view", "aria-hidden", "aria-checked"],
    });
  }

  dispose(): void {
    this.observer?.disconnect();
    for (const off of this.off) off();
    this.off.length = 0;
  }

  /** Something on the page may have changed. */
  touch(): void {
    this.dirtyAt = true;
  }

  /** The page is moving (a scroll, a transition): it is read again at every frame for a moment. */
  moving(): void {
    this.dirtyAt = true;
    this.movingUntil = performance.now() + 450;
  }

  /**
   * The page now, read again if it has to be; the very same read otherwise. While the page moves it is read at every frame, unless a read is dear: a read
   * is not done again before ten times as long as the last took has passed, so that on a screen where it costs it never takes more than a tenth of the time.
   * (And in between, a page whose scroller has been scrolled since it was read is carried on to where the scroller is now, which costs nothing: see `carried`.)
   */
  read(now: number): PageRead {
    const stale = now - this.builtAt;
    const due = this.dirtyAt && (stale >= 100 || (now < this.movingUntil && stale >= Math.min(MOVING_GAP_MAX, this.buildMs * 10)));
    if (!this.last || due || stale >= 500) {
      const started = performance.now();
      this.dirtyAt = false;
      this.builtAt = now;
      this.built++;
      this.last = this.build();
      // (the world is the very same object when the page has not changed; the cat is told that it was read again, and found as it was)
      this.last.world.readAt = now;
      const took = performance.now() - started;
      this.buildMs = this.buildMs === 0 ? took : this.buildMs * 0.8 + took * 0.2;
    }
    const base = this.world!;
    const ride = this.ride;
    const shift = ride && ride.scroller.isConnected ? ride.top - ride.scroller.scrollTop : 0;
    if (ride && shift !== 0) {
      let onward = this.onward;
      if (!onward || onward.built !== this.built || onward.shift !== shift) onward = this.onward = { built: this.built, shift, world: carried(base, shift, ride.rides, now) };
      this.last.world = onward.world;
    } else this.last.world = base;
    return this.last;
  }

  /** What a read of the page takes now, in milliseconds (smoothed), for the diagnostics. */
  get readMs(): number {
    return this.buildMs;
  }

  /** How many times the page has been read, for the diagnostics (a page that is only sitting there is read twice a second). */
  get reads(): number {
    return this.built;
  }

  private build(): PageRead {
    const tv = document.querySelector<HTMLElement>("main.tv");
    const viewport = tv ? rectOf(tv) : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const vw = viewport.w;
    const vh = viewport.h;
    const L = Math.max(40, Math.round(bodyLengthFor(vw, vh) * (this.context.size?.() ?? 1)));
    const em = tv ? parseFloat(getComputedStyle(tv).fontSize) || L / BODY_EMS : L / BODY_EMS;
    const draft: Draft = { surfaces: [], keepOut: [], targets: [], shelves: new Map(), soft: [], scroller: null, keepOutRides: [], focusRides: false };
    let mode: World["mode"] = "away";
    let player: PlayerMode = "none";
    let controlsUp = false;
    let home: PageRead["home"] = null;
    let view = "away";
    let why = "";

    const video = tv?.querySelector<HTMLVideoElement>("video.tv-video") ?? null;
    const film = Boolean(video && video.style.display !== "none");
    const browse = tv?.querySelector<HTMLElement>(".tv-browse") ?? null;
    // (anything in front of the page, whoever drew it: the feedback form is not inside the screen, a menu is)
    const modal = [...document.querySelectorAll<HTMLElement>(MODALS)].find((el) => takesRoom(el));

    if (!tv || document.hidden) why = !tv ? "no screen" : "tab hidden";
    else if (modal) why = `open: ${modal.className.split(/\s+/)[0] || modal.getAttribute("role") || "dialog"}`;
    else if (film && video) {
      if (!this.context.films()) why = "films off";
      else {
        mode = "player";
        view = "film";
        const state = tv.dataset.state ?? "";
        controlsUp = tv.dataset.hud === "visible";
        player = tv.querySelector(".tv-end") ? "ended" : tv.querySelector(".tv-fail") || state === "error" ? "error" : state === "loading" ? "loading" : state === "playing" ? "playing" : state === "paused" ? "paused" : "none";
        this.readFilm({ vw, vh, L, em }, draft);
        home = { parent: tv, after: video };
      }
    } else if (browse) {
      mode = "browse";
      view = `library:${browse.dataset.view ?? ""}`;
      this.readLibrary(browse, { vw, vh, L, em }, draft);
      home = { parent: browse, after: null };
    } else why = "no library";

    if (mode === "browse") {
      for (const rect of this.context.extra?.() ?? []) {
        draft.keepOut.push(rect);
        draft.keepOutRides.push(false);
      }
    }

    // the foot of the screen is always a place to be, in the library (a film has its perches instead)
    if (mode === "browse") draft.surfaces.push({ id: "floor", kind: "fallbackFloor", y: vh - Math.max(6, vh * 0.012), x0: 0, x1: vw, weight: 0.4 });

    const world: World = {
      viewport: { x: 0, y: 0, w: vw, h: vh },
      bodyLength: L,
      surfaces: draft.surfaces,
      keepOut: draft.keepOut,
      targets: draft.targets,
      mode,
      player,
      controlsUp,
      quiet: this.context.quiet(),
      reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    if (draft.focus) world.focus = draft.focus;
    if (draft.soft.length > 0) world.soft = draft.soft;

    // The world is a new object only when the page really is another one (the engine works its ledges out again for a new object); a page that only
    // sits there is the very same, so the cat is not made to look afresh at a page that has not changed.
    const signature = JSON.stringify([mode, player, controlsUp, vw, vh, L, world.quiet, world.reducedMotion, draft.surfaces.map((s) => [s.id, round(s.y), round(s.x0), round(s.x1)]), draft.keepOut.map((r) => [round(r.x), round(r.y), round(r.w), round(r.h)]), draft.focus && [round(draft.focus.x), round(draft.focus.y)]]);
    const same = this.world && signature === this.signature;
    if (same) {
      // (the posters moved by less than a pixel, or not at all: the cat's world stands; only the targets, which are not geometry the cat walks on, follow)
      this.world!.targets = draft.targets;
      if (draft.soft.length > 0) this.world!.soft = draft.soft;
      else delete this.world!.soft;
      if (draft.focus) this.world!.focus = draft.focus;
      else delete this.world!.focus;
    } else {
      this.world = world;
      this.signature = signature;
    }
    // (where the scroller is as the page was read, to carry the page on from: the keep-out zones are in the order they were pushed, which the signature above says is the order of the world's own)
    this.ride = draft.scroller ? { scroller: draft.scroller, top: draft.scroller.scrollTop, rides: { keepOut: draft.keepOutRides, focus: draft.focusRides } } : null;
    const read: PageRead = { world: this.world!, view, home, shelves: draft.shelves, why, ...(draft.focusId ? { focusId: draft.focusId } : {}) };
    return read;
  }

  /* ------------------------------ the library ------------------------------ */

  private readLibrary(root: HTMLElement, c: Metrics, draft: Draft): void {
    const { em } = c;
    // (what scrolls: the rows of the library, or the grid of a category, a list or the results of a search; the page has one of them at a time)
    const scroller = root.querySelector<HTMLElement>(".tv-rows") ?? root.querySelector<HTMLElement>(".tv-grid");
    draft.scroller = scroller;
    const keep = (zone: Rect, rides: boolean): void => {
      draft.keepOut.push(zone);
      draft.keepOutRides.push(rides);
    };
    for (const selector of BROWSE_FURNITURE) {
      for (const el of root.querySelectorAll<HTMLElement>(selector)) if (takesRoom(el) && !el.closest(".tv-row-tiles")) keep(inflate(rectOf(el), 0.15 * em), scroller?.contains(el) === true);
    }
    // the card that has the focus: it grows and has a ring, so the cat leaves it room
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active) && active.matches(".tv-tile, .tv-hero-button, .tv-action, .tv-choice, .tv-key, .tv-corner-button, .tv-account-chip, .tv-bell, button")) {
      const box = rectOf(active);
      keep(inflate(box, 0.4 * em), scroller?.contains(active) === true);
      if (active.matches(".tv-tile")) {
        draft.focus = box;
        draft.focusRides = scroller?.contains(active) === true;
        const id = tileId(active);
        if (id) draft.focusId = id;
      }
    }
    // everything that is read on the page, and what can be pressed: whatever it is called
    const lines = this.words(root, c, draft, scroller);
    // in a grid of cards, whose names are under them, the line of every card's name is a place in front of the cards (the line along the top of the cards is cut by the names of the line above)
    if (scroller?.classList.contains("tv-grid")) draft.surfaces.push(...placesInFront(lines.filter((line) => line.rides), c.L, { x: 0, y: 0, w: c.vw, h: c.vh }));

    // the rows of posters, each with its own sideways scroll
    const rowsBox = root.querySelector<HTMLElement>(".tv-rows");
    const clip = rowsBox ? rectOf(rowsBox) : { x: 0, y: 0, w: c.vw, h: c.vh };
    for (const row of root.querySelectorAll<HTMLElement>(".tv-row")) {
      const scroller = row.querySelector<HTMLElement>(".tv-row-tiles");
      if (!scroller || row.getAttribute("aria-hidden") === "true") continue;
      const box = rectOf(scroller);
      if (box.y + box.h < clip.y || box.y > clip.y + clip.h || box.h <= 0) continue;
      this.shelf(row, scroller, box, clip, c, draft);
    }
    // the pages of a grid of posters (a category, a list, the results of a search): the tops of its lines
    for (const grid of root.querySelectorAll<HTMLElement>(".tv-grid")) {
      if (takesRoom(grid)) this.gridShelves(grid, c, draft);
    }
  }

  private shelf(row: HTMLElement, scroller: HTMLElement, box: Rect, clip: Rect, c: Metrics, draft: Draft): void {
    const x0 = Math.max(box.x, clip.x, 0);
    const x1 = Math.min(box.x + box.w, clip.x + clip.w, c.vw);
    if (!(x1 > x0)) return;
    const id = nameOf(row, "row");
    const seen: PageTile[] = [];
    const tops: number[] = [];
    for (const child of scroller.children) {
      if (!(child instanceof HTMLElement) || !child.classList.contains("tv-tile")) continue;
      const lay = laidOut(child);
      if (lay.x + lay.w < x0) continue;
      if (lay.x > x1) break;
      const entry = tileId(child);
      if (!entry) continue;
      if (tops.length < 3) tops.push(lay.y);
      seen.push({ el: child, id: entry, surfaceId: id, x0: lay.x, x1: lay.x + lay.w });
      if (draft.targets.length < 90) draft.targets.push({ id: entry, rect: rectOf(child), surfaceId: id });
      this.names(child, c.em, draft);
    }
    if (tops.length === 0) return;
    tops.sort((a, b) => a - b);
    const y = tops[Math.floor(tops.length / 2)]!;
    if (y < clip.y - 1 || y > clip.y + clip.h) return;
    draft.surfaces.push({ id, kind: "shelfTop", y, x0, x1, weight: 1 });
    draft.shelves.set(id, seen);
  }

  private gridShelves(grid: HTMLElement, c: Metrics, draft: Draft): void {
    const clip = rectOf(grid);
    const lines = new Map<number, { y: number; x0: number; x1: number; tiles: PageTile[] }>();
    for (const el of grid.querySelectorAll<HTMLElement>(".tv-tile")) {
      const entry = tileId(el);
      if (!entry) continue;
      const lay = laidOut(el);
      if (lay.y + lay.h < clip.y || lay.y > clip.y + clip.h) continue;
      const key = Math.round(lay.y / 4);
      let line = lines.get(key);
      if (!line) lines.set(key, (line = { y: lay.y, x0: Infinity, x1: -Infinity, tiles: [] }));
      line.x0 = Math.min(line.x0, lay.x);
      line.x1 = Math.max(line.x1, lay.x + lay.w);
      line.tiles.push({ el, id: entry, surfaceId: "", x0: lay.x, x1: lay.x + lay.w });
      if (draft.targets.length < 90) draft.targets.push({ id: entry, rect: rectOf(el) });
      this.names(el, c.em, draft);
    }
    for (const line of lines.values()) {
      if (line.y < clip.y - 1) continue;
      // (a line is named by its first card, not by where it is on the screen: a grid scrolls by itself under the cat, and a name made of the line's height
      // would be a new shelf at every few pixels of the scroll, which the cat standing on it would take for a shelf that is gone)
      const id = `${nameOf(grid, "grid")}:${line.tiles[0]!.id}`;
      for (const tile of line.tiles) tile.surfaceId = id;
      for (const target of draft.targets) if (line.tiles.some((tile) => tile.id === target.id)) target.surfaceId ??= id;
      draft.surfaces.push({ id, kind: "shelfTop", y: line.y, x0: Math.max(line.x0, 0, clip.x), x1: Math.min(line.x1, c.vw, clip.x + clip.w), weight: 0.85 });
      draft.shelves.set(id, line.tiles);
    }
  }

  /**
   * Every line of words on the page and every button, read as the page draws them (see `text.ts`), put into the zones the cat keeps out of: no letter of the page is covered by the cat
   * while it stands or walks. A line that lies inside a box that is kept out of whole (the top bar, the banner's text) is part of it. The lines are handed back, for the places in front of them.
   */
  private words(root: HTMLElement, c: Metrics, draft: Draft, scroller: HTMLElement | null): Line[] {
    const own = this.context.own?.() ?? null;
    const pieces = readPieces(root, {
      screen: { x: -c.L, y: -c.L, w: c.vw + 2 * c.L, h: c.vh + 2 * c.L },
      scroller,
      scrollBox: scroller ? rectOf(scroller) : null,
      skip: (element) => element === own,
      quietCards: !scroller?.classList.contains("tv-grid"),
      limit: MOST_PIECES,
    });
    const lines = mergeLines(pieces, LINE_GAP * c.L);
    const zones = lines.map((line) => zoneOf(line, c.em));
    lines.forEach((line, i) => {
      const zone = zones[i]!;
      if (draft.keepOut.some((box) => lies(zone, box))) return;
      if (zones.some((other, j) => j !== i && lies(zone, other) && (!lies(other, zone) || j < i))) return;
      draft.keepOut.push(zone);
      draft.keepOutRides.push(line.rides);
    });
    return lines;
  }

  /** The words under a card (its name, and its year or the time left), as wide as the words are and not as wide as the card: for the cat to settle clear of. */
  private names(tile: HTMLElement, em: number, draft: Draft): void {
    if (draft.soft.length >= MAX_SOFT) return;
    for (const el of tile.querySelectorAll<HTMLElement>(".tv-tile-name, .tv-tile-year, .tv-category-name, .tv-category-count")) {
      const box = textRect(el);
      if (box) draft.soft.push(inflate(box, 0.06 * em));
    }
  }

  /* ------------------------------ a film ------------------------------ */

  private readFilm(c: Metrics, draft: Draft): void {
    // (Nothing of the player is a place to keep out of: the cat's layer is under the subtitles, the controls and the notes, so it never covers one, and a
    // cat that left whenever they came would be leaving at every key the viewer pressed and every line that was said. It rests where the controls' row has no
    // button, if it has such a place: the groups are there whether the controls are up or not, so the place does not change with them.)
    const groups = [...document.querySelectorAll<HTMLElement>("main.tv .hud-controls > .hud-group")].filter(takesRoom).map(rectOf);
    draft.surfaces.push(...perchesFor(groups, c.vw, c.vh, c.L));
  }
}

interface Metrics {
  vw: number;
  vh: number;
  L: number;
  em: number;
}

const round = (value: number): number => Math.round(value * 2) / 2;
