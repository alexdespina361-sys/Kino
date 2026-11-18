import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Key } from "../i18n";
import { thisIsHandHeld } from "../role";

interface Layer {
  close: () => void;
  taken: boolean;
}

interface State {
  layers: number;
  guard?: true;
  at: number;
  visit: string;
}

interface Entry {
  layers: number;
  guard: boolean;
  at: number;
  mine: boolean;
}

const layers: Layer[] = [];

let vacated = 0;
let leaving = false;
let returning: number | null = null;
let returnTimer: number | undefined;
let reach = 0;
let reachGuarded = false;

const visit = Math.random().toString(36).slice(2);

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

function here(): number {
  const entry = entryOf(window.history.state);
  return entry?.mine ? entry.at : 0;
}

function push(state: State) {
  window.history.pushState(state, "");
  reach = state.at;
  reachGuarded = phase === "armed";
}

const wantedPlaces = () => (phase === "armed" ? 1 : 0) + layers.length;

function repay(): boolean {
  if (leaving || returning !== null || vacated > 0) return true;
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
        returning = null;
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

function clear() {
  if (returning !== null) return;
  const count = Math.min(vacated, Math.max(here() - wantedPlaces(), 0));
  vacated = 0;
  if (count === 0) return arm();
  leaving = true;
  window.setTimeout(() => {
    leaving = false;
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
  listen();
}

function landed(event: PopStateEvent) {
  const entry = entryOf(event.state);
  const arrived = returning !== null && entry?.mine === true && entry.at === returning;
  returning = null;
  window.clearTimeout(returnTimer);
  const ours = leaving;
  if (!arrived && !leaving) honored = false;
  leaving = false;
  if (arrived) {
    if (vacated > 0) clear();
    else repay();
    return;
  }
  if (ours) {
    arm();
    repay();
    return;
  }
  const top = layers[layers.length - 1];
  const depth = entry?.mine ? entry.layers : 0;
  if (phase === "asking" && entry?.mine) {
    window.clearTimeout(timer);
    hideHint();
    phase = "armed";
    return;
  }
  if (top && layers.length > depth) {
    const standing = entry?.mine ? entry.at : 0;
    const base = phase === "armed" ? 1 : 0;
    layers.forEach((layer, index) => {
      if (base + index + 1 > standing) layer.taken = true;
    });
    top.close();
    window.setTimeout(repay, 150);
    return;
  }
  if (phase === "armed" && layers.length === 0 && !entry?.mine) {
    if (entry) window.history.back();
    else ask();
    return;
  }
  arm();
  repay();
}

type Phase = "off" | "waiting" | "armed" | "asking";

let phase: Phase = "off";
let touched = false;
let honored = false;
let timer: number | undefined;

export const ASK_MS = 2500;

function arm() {
  if ((phase !== "waiting" && phase !== "asking") || !touched || layers.length > 0 || vacated > 0 || leaving || returning !== null) return;
  const before = phase;
  phase = "armed";
  if (!repay()) {
    phase = before;
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

export function installExitGuard(): void {
  if (phase !== "off") return;
  phase = "waiting";
  track();
  if (entryOf(window.history.state)) {
    window.history.replaceState(guardState(), "");
    phase = "armed";
    reach = 0;
  }
  listen();
  arm();
}

export interface Hint {
  id: number;
  text: Key;
  ms: number;
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

export const hintNow = (): Hint | null => hint;

export const useHint = (): Hint | null => useSyncExternalStore(watch, hintNow, () => null);

let asked: { text: Key; until: number } | null = null;

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

let attached = false;

function listen() {
  const wanted = layers.length > 0 || phase !== "off" || leaving || returning !== null;
  if (wanted === attached) return;
  attached = wanted;
  if (wanted) window.addEventListener("popstate", back);
  else window.removeEventListener("popstate", back);
}

export function openLayer(close: () => void): { leave: () => void; stayed: () => void } {
  track();
  arm();
  const layer: Layer = { close, taken: true };
  layers.push(layer);
  listen();
  if (vacated > 0) {
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
      vacated += 1;
      queueMicrotask(clear);
    },
    stayed: () => keep(layer),
  };
}

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

export function useBackToClose(onBack: () => void): void {
  useBackWhile(true, onBack);
}

let held: boolean | undefined;
export const handHeld = (): boolean => (held ??= thisIsHandHeld());
export const browserBack = (): boolean => handHeld() || document.documentElement.dataset.fit === "desk";

export function useHandHeldBack(onBack: (() => void) | undefined): void {
  useBackWhile(onBack !== undefined && handHeld(), () => onBack?.());
}
