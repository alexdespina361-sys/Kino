import { BODY_EMS, bodyLengthFor } from "../math";
import type { PlayerMode, Rect, Surface, Target, World } from "../types";
import { inflate, nameOf, rectOf, takesRoom, textRect } from "./dom";

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

/** The parts of the library's page that are words and buttons, not for standing in front of. */
const BROWSE_FURNITURE = [".tv-browse-top", ".tv-rail", ".tv-hero-text", ".tv-hero-profile", ".tv-notice", ".tv-rows-note", ".tv-row-more", ".tv-view-foot", ".tv-filters", ".tv-keys", ".tv-query"];
/** ...and the ones whose words are what take up the room (a heading is as wide as its row, the words as wide as they are). */
const BROWSE_TEXT = [".tv-row-title", ".tv-view-title", ".tv-view-meta", ".tv-view-hint", ".tv-view-empty", ".tv-results-closest", ".tv-hero-eyebrow"];

/** How much of the screen's width a corner of the picture takes for the cat to sit on in a film (in body lengths). */
const PERCH_FROM = 0.7;
const PERCH_TO = 3.6;

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
  focus?: Rect;
  focusId?: string;
}

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
  private readonly observer: MutationObserver | null;
  private readonly off: Array<() => void> = [];
  private signature = "";

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
    this.observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(touch);
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

  /** The page now, read again if it has to be; the very same read otherwise. */
  read(now: number): PageRead {
    const stale = now - this.builtAt;
    const due = this.dirtyAt && (stale >= 100 || now < this.movingUntil);
    if (!this.last || due || stale >= 500) {
      this.dirtyAt = false;
      this.builtAt = now;
      this.last = this.build();
    }
    return this.last;
  }

  private build(): PageRead {
    const tv = document.querySelector<HTMLElement>("main.tv");
    const viewport = tv ? rectOf(tv) : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const vw = viewport.w;
    const vh = viewport.h;
    const L = Math.max(40, Math.round(bodyLengthFor(vw, vh) * (this.context.size?.() ?? 1)));
    const em = tv ? parseFloat(getComputedStyle(tv).fontSize) || L / BODY_EMS : L / BODY_EMS;
    const draft: Draft = { surfaces: [], keepOut: [], targets: [], shelves: new Map() };
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
        this.readFilm(tv, { vw, vh, L, em }, draft, controlsUp);
        home = { parent: tv, after: video };
      }
    } else if (browse) {
      mode = "browse";
      view = `library:${browse.dataset.view ?? ""}`;
      this.readLibrary(browse, { vw, vh, L, em }, draft);
      home = { parent: browse, after: null };
    } else why = "no library";

    if (mode === "browse") for (const rect of this.context.extra?.() ?? []) draft.keepOut.push(rect);

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

    // The world is a new object only when the page really is another one (the engine works its ledges out again for a new object); a page that only
    // sits there is the very same, so the cat is not made to look afresh at a page that has not changed.
    const signature = JSON.stringify([mode, player, controlsUp, vw, vh, L, world.quiet, world.reducedMotion, draft.surfaces.map((s) => [s.id, round(s.y), round(s.x0), round(s.x1)]), draft.keepOut.map((r) => [round(r.x), round(r.y), round(r.w), round(r.h)]), draft.focus && [round(draft.focus.x), round(draft.focus.y)]]);
    const same = this.world && signature === this.signature;
    if (same) {
      // (the posters moved by less than a pixel, or not at all: the cat's world stands; only the targets, which are not geometry the cat walks on, follow)
      this.world!.targets = draft.targets;
      if (draft.focus) this.world!.focus = draft.focus;
      else delete this.world!.focus;
    } else {
      this.world = world;
      this.signature = signature;
    }
    const read: PageRead = { world: this.world!, view, home, shelves: draft.shelves, why, ...(draft.focusId ? { focusId: draft.focusId } : {}) };
    return read;
  }

  /* ------------------------------ the library ------------------------------ */

  private readLibrary(root: HTMLElement, c: Metrics, draft: Draft): void {
    const { em } = c;
    for (const selector of BROWSE_FURNITURE) {
      for (const el of root.querySelectorAll<HTMLElement>(selector)) if (takesRoom(el) && !el.closest(".tv-row-tiles")) draft.keepOut.push(inflate(rectOf(el), 0.15 * em));
    }
    for (const selector of BROWSE_TEXT) {
      for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        if (!takesRoom(el)) continue;
        const box = textRect(el);
        if (box) draft.keepOut.push(inflate(box, 0.15 * em));
      }
    }
    // the card that has the focus: it grows and has a ring, so the cat leaves it room
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active) && active.matches(".tv-tile, .tv-hero-button, .tv-action, .tv-choice, .tv-key, .tv-corner-button, .tv-account-chip, .tv-bell, button")) {
      const box = rectOf(active);
      draft.keepOut.push(inflate(box, 0.4 * em));
      if (active.matches(".tv-tile")) {
        draft.focus = box;
        const id = tileId(active);
        if (id) draft.focusId = id;
      }
    }

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
    }
    for (const line of lines.values()) {
      if (line.y < clip.y - 1) continue;
      const id = `${nameOf(grid, "grid")}:${Math.round(line.y / 4)}`;
      for (const tile of line.tiles) tile.surfaceId = id;
      for (const target of draft.targets) if (line.tiles.some((tile) => tile.id === target.id)) target.surfaceId ??= id;
      draft.surfaces.push({ id, kind: "shelfTop", y: line.y, x0: Math.max(line.x0, 0, clip.x), x1: Math.min(line.x1, c.vw, clip.x + clip.w), weight: 0.85 });
      draft.shelves.set(id, line.tiles);
    }
  }

  /* ------------------------------ a film ------------------------------ */

  private readFilm(tv: HTMLElement, c: Metrics, draft: Draft, controlsUp: boolean): void {
    const { em, L } = c;
    if (controlsUp) {
      for (const el of tv.querySelectorAll<HTMLElement>(".hud-top, .hud-bottom, .hud-upnext, .hud-boost")) if (takesRoom(el)) draft.keepOut.push(inflate(rectOf(el), 0.3 * em));
    }
    // the subtitles: each line, with a margin (they are drawn over the cat, but they are what is being read)
    for (const el of tv.querySelectorAll<HTMLElement>(".tv-caption, .tv-note, .hud-toast, .tv-toast")) if (takesRoom(el)) draft.keepOut.push(inflate(rectOf(el), 0.6 * em));
    const ground = c.vh - Math.max(6, c.vh * 0.025);
    draft.surfaces.push(
      { id: "perch-right", kind: "playerPerch", y: ground, x0: c.vw - PERCH_TO * L, x1: c.vw - PERCH_FROM * L, weight: 1 },
      { id: "perch-left", kind: "playerPerch", y: ground, x0: PERCH_FROM * L, x1: PERCH_TO * L, weight: 0.7 },
    );
  }
}

interface Metrics {
  vw: number;
  vh: number;
  L: number;
  em: number;
}

const round = (value: number): number => Math.round(value * 2) / 2;
