import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Key } from "../i18n";
import { thisIsHandHeld } from "../role";

/**
 * The phone's own Back (the button, the swipe from the edge) closes what is on top, a sheet or a page of the account or the scanner,
 * instead of leaving the site. Each of them puts one entry on the history while it is open; Back takes that entry off and the one on top
 * closes. An entry says how many of them there were when it was made, which tells a Back that a hand made from one the code made itself
 * (a sheet closed by its own button takes its entry off again, and nobody pressed anything).
 *
 * The browser keeps a rule about the entries a page makes (Chrome's "history manipulation intervention"): one that is made when the person
 * has not touched the page since their last Back is held against the page, and the Back after it runs past every entry the page made, out of
 * the site. So no entry is made then. A layer that stays after a Back (a page that only steps back to the one before) gets its entry back by
 * going forward to where the Back took it from, which the browser does not hold against a page; one that has to be made new is made at the
 * next touch (`honored`, `repay`).
 */
interface Layer {
  close: () => void;
  /** Its entry is not on the history: Back took it and the layer has not left since, or it opened when an entry would have been held against the page. */
  taken: boolean;
}

interface State {
  /** How many layers there were when the entry was made. */
  layers: number;
  /** The entry of the guard under the layers, below which is the page the site was opened on. */
  guard?: true;
  /** Where it stands among the entries of this code, counted up from the page the site was opened on (the guard, when there is one, is the first). */
  at: number;
  /** The load of the page that made it. */
  visit: string;
}

interface Entry {
  layers: number;
  guard: boolean;
  at: number;
  /** Made by this load of the page. */
  mine: boolean;
}

const layers: Layer[] = [];

/**
 * The entries of layers that closed a moment ago and are still on the history. A layer that opens in the same moment (a sheet swapped
 * for the one it opens: the menu for the party) takes the place of one of them. Taking an entry off and putting one on in the same breath
 * does not work: a Back travels from where the history stood when it was asked for, the new entry lands behind it, and the Back then
 * finds the new layer on top and closes that.
 */
let vacated = 0;
/** Entries were asked to go (`clear`) and the history has not said that they have. */
let leaving = false;
/** The history was asked to go forward to the entry at this place (`repay`) and has not said that it has. */
let returning: number | null = null;
let returnTimer: number | undefined;
/** The highest place of an entry of this code that is on the history, whether the person stands on it or it is ahead of them (a Back took them off it). */
let reach = 0;
/** ...and whether the guard stood under the entries up to it when they were made (entries made without it are not the ones a guard and layers need). */
let reachGuarded = false;

/** This load of the page. A page that is reloaded, or brought back by the browser, stands on entries its earlier load made: they carry another. */
const visit = Math.random().toString(36).slice(2);

/** What an entry of the history says of itself, or null for one this code did not make (the page the site was opened on). */
function entryOf(state: unknown): Entry | null {
  if (typeof state !== "object" || state === null || !("layers" in state) || typeof state.layers !== "number") return null;
  return {
    layers: state.layers,
    guard: "guard" in state && state.guard === true,
    at: "at" in state && typeof state.at === "number" ? state.at : 0,
    mine: "visit" in state && state.visit === visit,
  };
}

const layerState = (count: number, at: number): State => ({ layers: count, at, visit });
const guardState = (): State => ({ layers: 0, guard: true, at: 1, visit });

/** Where the person stands among the entries of this code: 0 on the page the site was opened on, or on any entry it did not make. */
function here(): number {
  const entry = entryOf(window.history.state);
  return entry?.mine ? entry.at : 0;
}

function push(state: State) {
  window.history.pushState(state, "");
  reach = state.at;
  reachGuarded = phase === "armed";
}

/** The entries the guard (when it is up) and the layers that are open stand on. */
const wantedPlaces = () => (phase === "armed" ? 1 : 0) + layers.length;

/**
 * The entries that the guard and the layers need and the history lacks: a Back took them (a layer that stays, a Back that went past the
 * guard as well), or a layer opened when none could be made. They are made where the browser does not hold it against the page, at a touch
 * (`honored`); anywhere else they are gone forward to, when a Back took them and nothing was made since, which is no entry made at all.
 * False when something is wanted that cannot be had yet either way: it is had at the next touch.
 */
function repay(): boolean {
  if (leaving || returning !== null || vacated > 0) return true; // (the history is on its way somewhere: this comes again when it has arrived)
  const base = phase === "armed" ? 1 : 0;
  const wanted = wantedPlaces();
  const standing = here();
  if (standing < wanted) {
    if (honored) {
      if (base > standing) push(guardState());
      for (let at = Math.max(standing, base) + 1; at <= wanted; at += 1) push(layerState(at - base, at));
    } else if ((phase === "armed" || phase === "off") && wanted <= reach && reachGuarded === (base > 0)) {
      returning = wanted;
      window.clearTimeout(returnTimer);
      returnTimer = window.setTimeout(() => {
        returning = null; // (a history that has nowhere to go says nothing)
        listen();
        if (vacated > 0) clear();
      }, 400);
      listen();
      window.history.go(wanted - standing);
    } else return false;
  }
  for (const layer of layers) layer.taken = false;
  return true;
}

/** The entries nobody took the place of go, once the layers that came and went in this moment have settled. */
function clear() {
  if (returning !== null) return; // (`back` comes here again when the history has arrived)
  const count = Math.min(vacated, Math.max(here() - wantedPlaces(), 0)); // (never below the guard: the only thing under it is the way out of the site)
  vacated = 0;
  if (count === 0) return arm();
  leaving = true;
  window.setTimeout(() => {
    leaving = false; // (a history that has nowhere to go says nothing)
    listen();
  }, 400);
  listen();
  window.history.go(-count);
}

function keep(layer: Layer) {
  if (!layer.taken || !layers.includes(layer)) return;
  repay();
}

function back(event: PopStateEvent) {
  landed(event);
  listen(); // (the history is listened to for as long as it is needed: that may be over now)
}

function landed(event: PopStateEvent) {
  const entry = entryOf(event.state);
  const arrived = returning !== null && entry?.mine === true && entry.at === returning;
  returning = null;
  window.clearTimeout(returnTimer);
  // (A Back or a Forward of the person is the browser's own navigation: from it on, what the page makes is held against it until the person touches it.)
  if (!arrived && !leaving) honored = false;
  leaving = false;
  if (arrived) {
    if (vacated > 0) clear();
    else repay();
    return;
  }
  const top = layers[layers.length - 1];
  // (Landing on an entry that stands for as many as are open, or for more, is the code's own doing: whatever it took off has already gone.)
  const depth = entry?.mine ? entry.layers : 0;
  if (phase === "asking" && entry?.mine) {
    // Forward again onto the guard: nobody is leaving after all.
    window.clearTimeout(timer);
    hideHint();
    phase = "armed";
    return;
  }
  if (top && layers.length > depth) {
    // The entries above the one landed on are gone, the guard's as well when the Back went past it: they come back with the layers that stay.
    const standing = entry?.mine ? entry.at : 0;
    const base = phase === "armed" ? 1 : 0;
    layers.forEach((layer, index) => {
      if (base + index + 1 > standing) layer.taken = true;
    });
    top.close();
    window.setTimeout(repay, 150); // (a layer that stays and draws again says so itself, at once: this is for one that does not draw at all)
    return;
  }
  if (phase === "armed" && layers.length === 0 && !entry?.mine) {
    if (entry) window.history.back(); // an entry an earlier visit made, which nothing here stands for: gone through on the way down
    else ask(); // the bottom of the site: the next Back leaves it
    return;
  }
  arm(); // (a guard that was waiting for the layers to be gone)
  repay(); // (and a layer that opened while the history was on its way has its entry now)
}

/* ------------------------------ the bottom of the site ------------------------------ */

/**
 * A phone has one Back for everything, and a slip of the thumb at the edge of the screen is enough to leave the site and everything that was
 * in the middle of being done. At the bottom of the site, where Back would leave it, the first one is a question instead: it says so, and
 * a second one within a moment is the answer. It is the way the phone's own apps ask, and the site is kept for anyone who is not sure.
 *
 * "waiting": nothing was touched yet, so there is nothing to lose (and the browser passes over entries a page makes by itself, which would
 * make this a trap rather than a question). "armed": an entry of the guard stands between the page the site was opened on and the person,
 * and any layers are above it. "asking": the person pressed Back at the bottom, the guard's entry is gone, one more Back goes through; it
 * comes back after a moment, or at once at the first touch (a Back long after is a first Back again, not the answer to an old question).
 */
type Phase = "off" | "waiting" | "armed" | "asking";

let phase: Phase = "off";
/** The person has used the page: the entries that are made from now on count with the browser. */
let touched = false;
/**
 * The browser holds an entry against the page unless the person has touched it since their last Back (or since it was opened). Touching
 * counts when the browser says so (`navigator.userActivation.isActive` is on for five seconds after a touch, Back or not, so it is no answer).
 */
let honored = false;
let timer: number | undefined;

/** How long the question is asked: the time to read it and press again, and not so long that a second slip answers it. */
export const ASK_MS = 2500;

/** The question is over, and the guard is put back: under the layers there are none open, so it goes on the page the site was opened on. */
function arm() {
  if ((phase !== "waiting" && phase !== "asking") || !touched || layers.length > 0 || vacated > 0 || leaving || returning !== null) return;
  const before = phase;
  phase = "armed";
  if (!repay()) {
    phase = before; // (it cannot be put back yet: the next touch tries again)
    return;
  }
  window.clearTimeout(timer);
  if (before === "asking") hideHint();
}

function ask() {
  phase = "asking";
  showHint("exit.press", ASK_MS, false);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => phase === "asking" && arm(), ASK_MS);
}

/** What the browser counts as the person using the page: a finger lifted, a click, a key (not Escape, not one that only changes the others). */
function counts(event: Event): boolean {
  if (!event.isTrusted || window.navigator.userActivation?.isActive === false) return false;
  if (event.type === "keydown") return !["Escape", "Shift", "Control", "Alt", "Meta"].includes((event as KeyboardEvent).key);
  return event.type === "click" || (event.type === "pointerup" && (event as PointerEvent).pointerType !== "mouse");
}

function used(event: Event) {
  if (!touched) touched = window.navigator.userActivation ? window.navigator.userActivation.hasBeenActive : event.type !== "pointerdown";
  if (counts(event)) honored = true;
  arm();
  repay();
}

const TOUCHES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
let tracking = false;

/** What the person does to the page is watched (once), for the layers of any screen and for the guard. */
function track() {
  if (tracking) return;
  tracking = true;
  touched = window.navigator.userActivation?.hasBeenActive ?? false;
  honored = touched;
  for (const type of TOUCHES) window.addEventListener(type, used, { capture: true, passive: true });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    honored = false;
    arm();
  });
}

/** Put the guard under a site that is opened on a phone (see above). Once, at the start. */
export function installExitGuard(): void {
  if (phase !== "off") return;
  phase = "waiting";
  track();
  if (entryOf(window.history.state)) {
    // Reloaded, or brought back by the browser, on an entry of the earlier visit: it stands for the guard now, and any under it are gone through.
    window.history.replaceState(guardState(), "");
    phase = "armed";
    reach = 0; // (the entries ahead of it, if any, are the earlier visit's: none is gone forward to)
  }
  listen();
  arm();
}

/* ------------------------------ the question ------------------------------ */

/** What is asked at the bottom of the screen (see `ExitHint`), for as long as it stays. */
export interface Hint {
  id: number;
  text: Key;
  ms: number;
  /** It is asked of someone who is watching something, with the controls at the bottom of the screen: it stands above them. */
  lifted: boolean;
}

let hint: Hint | null = null;
let hints = 0;
let hintTimer: number | undefined;
const watchers = new Set<() => void>();

function showHint(text: Key, ms: number, lifted: boolean) {
  window.clearTimeout(hintTimer);
  hint = { id: (hints += 1), text, ms, lifted };
  hintTimer = window.setTimeout(hideHint, ms);
  watchers.forEach((watch) => watch());
}

function hideHint() {
  window.clearTimeout(hintTimer);
  if (!hint) return;
  hint = null;
  watchers.forEach((watch) => watch());
}

const watch = (listener: () => void) => {
  watchers.add(listener);
  return () => void watchers.delete(listener);
};

/** The question that is up now, if there is one. */
export const hintNow = (): Hint | null => hint;

/** ...for a component that shows it. */
export const useHint = (): Hint | null => useSyncExternalStore(watch, hintNow, () => null);

let asked: { text: Key; until: number } | null = null;

/**
 * A Back that would be hard to take back (the film of a whole party ends, a guest leaves the party) asks first: the first press says so,
 * a second one for the same thing within a moment is the answer and gets `true`.
 */
export function pressAgain(text: Key, ms = ASK_MS): boolean {
  const now = Date.now();
  if (asked && asked.text === text && now < asked.until) {
    asked = null;
    hideHint();
    return true;
  }
  asked = { text, until: now + ms };
  showHint(text, ms, true);
  return false;
}

/* ------------------------------ the layers ------------------------------ */

let attached = false;

/** The history is listened to while a layer is open, while the guard is up and while it is on its way somewhere. */
function listen() {
  const wanted = layers.length > 0 || phase !== "off" || leaving || returning !== null;
  if (wanted === attached) return;
  attached = wanted;
  if (wanted) window.addEventListener("popstate", back);
  else window.removeEventListener("popstate", back);
}

/** Something that is on top of the page until it closes. `leave` is for when it has; `stayed` for after it was closed by Back and is still there. */
export function openLayer(close: () => void): { leave: () => void; stayed: () => void } {
  track();
  arm(); // (a question that is being asked is over: the person is about to be somewhere the question does not reach)
  const layer: Layer = { close, taken: true }; // (no entry yet)
  layers.push(layer);
  listen();
  if (vacated > 0) {
    // In the place of the entry of a layer that closed in this moment.
    vacated -= 1;
    layer.taken = false;
    window.history.replaceState(layerState(layers.length, here()), "");
  } else repay();
  return {
    leave() {
      const at = layers.indexOf(layer);
      if (at < 0) return;
      layers.splice(at, 1);
      listen();
      if (layer.taken) return queueMicrotask(arm);
      vacated += 1; // it closed some other way (its own button): its entry comes off too, unless another layer takes its place
      queueMicrotask(clear);
    },
    stayed: () => keep(layer),
  };
}

/** While `active`, the phone's Back calls `onBack` (which may leave it up, as a page does that goes back to the one before it). */
export function useBackWhile(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  const layer = useRef<ReturnType<typeof openLayer> | null>(null);
  useEffect(() => {
    if (!active) return;
    const mine = openLayer(() => latest.current());
    layer.current = mine;
    return () => {
      layer.current = null;
      mine.leave();
    };
  }, [active]);
  useEffect(() => layer.current?.stayed());
}

/** While this is on screen, Back calls `onBack` (which may leave it up, as a page does that goes back to the one before it). */
export function useBackToClose(onBack: () => void): void {
  useBackWhile(true, onBack);
}

let held: boolean | undefined;
/** Whether the system's Back is what this device has (a phone, a tablet), where a TV has a key and a computer a button nobody presses by mistake. */
export const handHeld = (): boolean => (held ??= thisIsHandHeld());

/**
 * What the remote's Back does on a screen of the TV (it is a key there), the phone's own Back does too. Without a handler there is nothing
 * to do, and Back is left to whoever listens; on a TV or a computer the keys are all there is.
 */
export function useHandHeldBack(onBack: (() => void) | undefined): void {
  useBackWhile(onBack !== undefined && handHeld(), () => onBack?.());
}
