import { handHeld, openLayer } from "../../shared/backButton";
import { actionForKey } from "../../tv/keys";
import type { Rect } from "../types";

/**
 * The cat's menu: what a right click on the cat (or a finger held on it) offers, a few buttons in a card beside it. It is for a hand, and it takes nothing from the page: it has no
 * focus, so the remote and the keyboard stay where they were; none of its presses reaches the player under it; and it is gone at the first thing that is not for it: Back (or
 * Escape), a click anywhere else (which is only that: it does not also tap the picture), another key, the page scrolling under it, the window changing. The corner's panel is how the remote, a
 * keyboard and a screen reader reach the same things, so this one is not in the tab order.
 */

export interface MenuItem {
  id: string;
  label: string;
  run: () => void;
}

export interface Menu {
  /** Opens the menu in `parent` beside `beside` (the cat's body, in the pixels of the page); one that is open is closed first. */
  open(parent: HTMLElement, beside: Rect, items: readonly MenuItem[], label: string): void;
  close(): void;
  isOpen(): boolean;
  /** The menu's own box, while it is open. */
  element(): HTMLElement | null;
  /** Closes it and takes away everything it listens to. */
  dispose(): void;
}

/** How long a click that follows the press that closed the menu is swallowed (milliseconds): it is the end of that press, and not a click of the viewer's own. */
const SWALLOW_MS = 600;
/** Keys that are not a key: pressing one does not close the menu. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "AltGraph", "Fn", "Hyper", "Super"]);

/** The menu beside its anchor, clear of the edges of its parent (on the other side of the anchor if there is no room on the first). */
function place(menu: HTMLElement, parent: HTMLElement, beside: Rect): void {
  const room = parent.getBoundingClientRect();
  const em = parseFloat(getComputedStyle(menu).fontSize) || 16;
  const gap = 0.5 * em;
  const edge = 0.5 * em;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let x = beside.x + beside.w + gap;
  if (x + w > room.right - edge) x = beside.x - gap - w;
  x = Math.min(Math.max(x, room.left + edge), Math.max(room.left + edge, room.right - edge - w));
  const y = Math.min(Math.max(beside.y + beside.h / 2 - h / 2, room.top + edge), Math.max(room.top + edge, room.bottom - edge - h));
  menu.style.left = `${Math.round(x - room.left)}px`;
  menu.style.top = `${Math.round(y - room.top)}px`;
}

export function createMenu(): Menu {
  let box: HTMLElement | null = null;
  let undo: Array<() => void> = [];
  let layer: ReturnType<typeof openLayer> | null = null;
  let swallowing = 0;

  const swallow = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  const stopSwallowing = (): void => {
    window.clearTimeout(swallowing);
    window.removeEventListener("click", swallow, true);
  };

  const close = (): void => {
    if (!box) return;
    const gone = box;
    box = null;
    for (const off of undo) off();
    undo = [];
    gone.remove();
    const mine = layer;
    layer = null;
    mine?.leave();
  };

  const open = (parent: HTMLElement, beside: Rect, items: readonly MenuItem[], label: string): void => {
    close();
    const menu = document.createElement("div");
    menu.className = "kino-cat-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);
    menu.setAttribute("data-testid", "cat-menu");
    // (what the cat's own reading of the page leaves alone: the menu is not part of the page it keeps out of)
    menu.setAttribute("data-cat-own", "");
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cat-btn";
      button.setAttribute("role", "menuitem");
      button.setAttribute("data-item", item.id);
      button.setAttribute("data-testid", `cat-menu-${item.id}`);
      button.tabIndex = -1;
      button.textContent = item.label;
      menu.append(button);
    }
    menu.style.visibility = "hidden";
    parent.append(menu);
    place(menu, parent, beside);
    menu.style.visibility = "";
    box = menu;
    stopSwallowing();

    const on = (target: EventTarget, type: string, listener: (event: Event) => void, options: boolean | AddEventListenerOptions = false): void => {
      target.addEventListener(type, listener, options);
      undo.push(() => target.removeEventListener(type, listener, options));
    };

    // A press on the menu is the menu's: the focus stays where it was, and nothing under the menu (the player's taps and holds, the page's clicks) hears of it.
    on(menu, "mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    for (const type of ["pointerdown", "dblclick", "auxclick", "touchstart"]) on(menu, type, (event) => event.stopPropagation(), type === "touchstart" ? { passive: true } : false);
    on(menu, "contextmenu", swallow);
    on(menu, "click", (event) => {
      event.stopPropagation();
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-item]") : null;
      const item = items.find((one) => one.id === button?.dataset.item);
      if (!item) return;
      close();
      item.run();
    });

    // A press anywhere else closes it, and is only that: it is no tap on the picture and no click on a button of the page. (Another button than the first is a right click,
    // which may well be on the cat again, for a menu of its own.) A finger's press is cancelled too, so that the browser makes no mouse events of it (the player takes a mouse that
    // moves for a hand that wants the bars, and it never saw the finger).
    on(
      document,
      "pointerdown",
      (event) => {
        if (event.target instanceof Node && menu.contains(event.target)) return;
        close();
        const press = event as PointerEvent;
        if (press.button !== 0) return;
        event.stopPropagation();
        if (press.pointerType !== "mouse") event.preventDefault();
        window.addEventListener("click", swallow, { capture: true, once: true });
        swallowing = window.setTimeout(stopSwallowing, SWALLOW_MS);
      },
      true,
    );
    // Back, and Escape, close it and are not the page's (they would leave the film). Any other key is the page's and the menu is done with: the hand is not the viewer's any more.
    on(
      window,
      "keydown",
      (event) => {
        const key = event as KeyboardEvent;
        if (key.altKey || key.ctrlKey || key.metaKey) return;
        if (actionForKey(key) === "back") {
          key.preventDefault();
          key.stopPropagation();
          close();
        } else if (!MODIFIERS.has(key.key)) close();
      },
      true,
    );
    on(window, "blur", close);
    on(window, "resize", close);
    // The page going by under it (the library's rows, the body of a page) leaves the cat behind and the card with nothing to point at. The box the card is in is not that: it
    // goes with the cat's layer when that box scrolls (and it does, a few pixels, when the player's bar has slid out of it and a robot or a browser brings something into view),
    // and the document does not carry a fixed box.
    on(window, "scroll", (event) => { if (event.target !== parent && event.target !== document) close(); }, { capture: true, passive: true });
    on(window, "wheel", close, { passive: true });
    on(document, "visibilitychange", close);
    // A phone's own Back closes it, as it does a panel or a sheet.
    if (handHeld()) layer = openLayer(close);
  };

  return {
    open,
    close,
    isOpen: () => box !== null,
    element: () => box,
    dispose: () => {
      close();
      stopSwallowing();
    },
  };
}
