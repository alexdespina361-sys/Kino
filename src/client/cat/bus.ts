/**
 * What the rest of the website can ask of the cat (the button in the library's corner opens its panel), without knowing whether there is a cat:
 * a command nobody hears is dropped. In the website's first download, with the settings; the cat itself listens from its own file.
 */
export type CatCommand = { type: "panel" };

const EVENT = "kino:cat-command";
/** A command sent as the cat is still being fetched (the button was pressed in the first moments after the switch) waits this long for it. */
const WAIT_MS = 5000;

let waiting: { command: CatCommand; at: number } | null = null;

export function emitCat(command: CatCommand): void {
  if (typeof window === "undefined") return;
  waiting = { command, at: Date.now() };
  window.dispatchEvent(new CustomEvent<CatCommand>(EVENT, { detail: command }));
}

/** The id of the cat's panel on the page, for the button that opens it to point at. */
export const CAT_PANEL_ID = "kino-cat-panel";

let panelOpen = false;
const panelListeners = new Set<() => void>();

/** The cat's panel was opened or closed (the button that opens it says so to a reader). */
export function setPanelOpen(open: boolean): void {
  if (panelOpen === open) return;
  panelOpen = open;
  for (const listener of [...panelListeners]) listener();
}

export const panelIsOpen = (): boolean => panelOpen;

export function subscribePanel(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

export function onCat(listener: (command: CatCommand) => void): () => void {
  const handler = (event: Event) => {
    waiting = null;
    listener((event as CustomEvent<CatCommand>).detail);
  };
  window.addEventListener(EVENT, handler);
  if (waiting && Date.now() - waiting.at < WAIT_MS) {
    const late = waiting.command;
    waiting = null;
    queueMicrotask(() => listener(late));
  }
  return () => window.removeEventListener(EVENT, handler);
}
