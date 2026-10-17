import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Key } from "../i18n";
import { thisIsHandHeld } from "../role";

/**
 * The phone's own Back (the button, the swipe from the edge) closes what is on top, a sheet or a page of the account or the scanner,
 * instead of leaving the site. Each of them puts one entry on the history while it is open; Back takes that entry off and the one on top
 * closes. An entry says how many of them there were when it was made, which tells a Back that a hand made from one the code made itself
 * (a sheet closed by its own button takes its entry off again, and nobody pressed anything).
 */
interface Layer {
  close: () => void;
  /** Back took its entry and it has not left since: if it stays (a page that only steps back to the one before) it needs an entry again. */
  taken: boolean;
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

/** This load of the page. A page that is reloaded, or brought back by the browser, stands on entries its earlier load made: they carry another. */
const visit = Math.random().toString(36).slice(2);

interface Entry {
  layers: number;
  /** The entry of the guard under the layers, below which is the page the site was opened on. */
  guard: boolean;
  /** Made by this load of the page. */
  mine: boolean;
}

/** What an entry of the history says of itself, or null for one this code did not make (the page the site was opened on). */
function entryOf(state: unknown): Entry | null {
  if (typeof state !== "object" || state === null || !("layers" in state) || typeof state.layers !== "number") return null;
  return { layers: state.layers, guard: "guard" in state && state.guard === true, mine: "visit" in state && state.visit === visit };
}

const layerState = (count: number) => ({ layers: count, visit });
const guardState = () => ({ layers: 0, guard: true, visit });

function enter(inPlaceOfOneThatClosed: boolean) {
  const state = layerState(layers.length);
  if (inPlaceOfOneThatClosed && vacated > 0) {
    vacated -= 1;
    window.history.replaceState(state, "");
  } else window.history.pushState(state, "");
}

/** The entries nobody took the place of go, once the layers that came and went in this moment have settled. */
function clear() {
  const count = vacated;
  vacated = 0;
  if (count === 0) return arm();
  leaving = true;
  window.setTimeout(() => (leaving = false), 400); // (a history that has nowhere to go says nothing)
  window.history.go(-count);
}

function keep(layer: Layer) {
  if (!layer.taken || !layers.includes(layer)) return;
  layer.taken = false;
  enter(false);
}

/** A Back that went further than the layer's entry (two in a row, or an entry the browser passed over): the guard and an entry for each layer still open are made again. */
function rebuild() {
  if (phase !== "armed" || entryOf(window.history.state)?.mine) return;
  window.history.pushState(guardState(), "");
  layers.forEach((layer, index) => {
    layer.taken = false;
    window.history.pushState(layerState(index + 1), "");
  });
}

function back(event: PopStateEvent) {
  leaving = false;
  const entry = entryOf(event.state);
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
    top.taken = true;
    top.close();
    // On the page the site was opened on the guard has gone as well, with every entry above it: they come back with the layers that are still open.
    if (phase === "armed" && !entry?.mine) window.setTimeout(rebuild, 150);
    else window.setTimeout(() => keep(top), 150); // a close that changed nothing on screen leaves the layer open with no entry
    return;
  }
  if (phase === "armed" && layers.length === 0 && !entry?.mine) {
    if (entry) window.history.back(); // an entry an earlier visit made, which nothing here stands for: gone through on the way down
    else ask(); // the bottom of the site: the next Back leaves it
    return;
  }
  arm(); // (a guard that was waiting for the layers to be gone)
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
let timer: number | undefined;

/** How long the question is asked: the time to read it and press again, and not so long that a second slip answers it. */
export const ASK_MS = 2500;

/** The question is over, and the guard is put back: under the layers there are none open, so it goes on the page the site was opened on. */
function arm() {
  if ((phase !== "waiting" && phase !== "asking") || !touched || layers.length > 0 || vacated > 0 || leaving) return;
  window.clearTimeout(timer);
  if (phase === "asking") hideHint();
  window.history.pushState(guardState(), "");
  phase = "armed";
}

function ask() {
  phase = "asking";
  showHint("exit.press", ASK_MS, false);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => phase === "asking" && arm(), ASK_MS);
}

function used(event: Event) {
  if (!touched) touched = window.navigator.userActivation ? window.navigator.userActivation.hasBeenActive : event.type !== "pointerdown";
  arm();
}

const TOUCHES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/** Put the guard under a site that is opened on a phone (see above). Once, at the start. */
export function installExitGuard(): void {
  if (phase !== "off") return;
  phase = "waiting";
  touched = window.navigator.userActivation?.hasBeenActive ?? false;
  if (entryOf(window.history.state)) {
    // Reloaded, or brought back by the browser, on an entry of the earlier visit: it stands for the guard now, and any under it are gone through.
    window.history.replaceState(guardState(), "");
    phase = "armed";
  }
  for (const type of TOUCHES) window.addEventListener(type, used, { capture: true, passive: true });
  window.addEventListener("pageshow", (event) => event.persisted && arm());
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

/** The history is listened to while a layer is open and while the guard is up. */
function listen() {
  const wanted = layers.length > 0 || phase !== "off";
  if (wanted === attached) return;
  attached = wanted;
  if (wanted) window.addEventListener("popstate", back);
  else window.removeEventListener("popstate", back);
}

/** Something that is on top of the page until it closes. `leave` is for when it has; `stayed` for after it was closed by Back and is still there. */
export function openLayer(close: () => void): { leave: () => void; stayed: () => void } {
  arm(); // (a question that is being asked is over: the person is about to be somewhere the question does not reach)
  const layer: Layer = { close, taken: false };
  layers.push(layer);
  listen();
  enter(true);
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
