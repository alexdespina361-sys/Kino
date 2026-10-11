import { useEffect, useRef } from "react";

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

const stands = (state: unknown): number => (typeof state === "object" && state !== null && "layers" in state && typeof state.layers === "number" ? state.layers : 0);

function enter(inPlaceOfOneThatClosed: boolean) {
  const state = { layers: layers.length };
  if (inPlaceOfOneThatClosed && vacated > 0) {
    vacated -= 1;
    window.history.replaceState(state, "");
  } else window.history.pushState(state, "");
}

/** The entries nobody took the place of go, once the layers that came and went in this moment have settled. */
function clear() {
  const count = vacated;
  vacated = 0;
  if (count > 0) window.history.go(-count);
}

function keep(layer: Layer) {
  if (!layer.taken || !layers.includes(layer)) return;
  layer.taken = false;
  enter(false);
}

function back(event: PopStateEvent) {
  const top = layers[layers.length - 1];
  // (Landing on an entry that stands for as many as are open, or for more, is the code's own doing: whatever it took off has already gone.)
  if (!top || layers.length <= stands(event.state)) return;
  top.taken = true;
  top.close();
  window.setTimeout(() => keep(top), 150); // a close that changed nothing on screen leaves the layer open with no entry
}

/** Something that is on top of the page until it closes. `leave` is for when it has; `stayed` for after it was closed by Back and is still there. */
export function openLayer(close: () => void): { leave: () => void; stayed: () => void } {
  const layer: Layer = { close, taken: false };
  layers.push(layer);
  if (layers.length === 1) window.addEventListener("popstate", back);
  enter(true);
  return {
    leave() {
      const at = layers.indexOf(layer);
      if (at < 0) return;
      layers.splice(at, 1);
      if (layers.length === 0) window.removeEventListener("popstate", back);
      if (layer.taken) return;
      vacated += 1; // it closed some other way (its own button): its entry comes off too, unless another layer takes its place
      queueMicrotask(clear);
    },
    stayed: () => keep(layer),
  };
}

/** While this is on screen, Back calls `onBack` (which may leave it up, as a page does that goes back to the one before it). */
export function useBackToClose(onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  const layer = useRef<ReturnType<typeof openLayer> | null>(null);
  useEffect(() => {
    const mine = openLayer(() => latest.current());
    layer.current = mine;
    return mine.leave;
  }, []);
  useEffect(() => layer.current?.stayed());
}
