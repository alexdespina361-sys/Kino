import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./format";

/**
 * Whether this phone's home screen has the box for pasting a link: off until it is turned on (most people play from the library). It is
 * the phone's own choice, kept in its browser, and turned on or off in the settings, which goes through here, so the home screen follows it.
 */
const KEY = "kino.linkbox";

let on = readStorage(KEY) === "1";
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((listener) => listener());

export function setLinkBox(value: boolean): void {
  on = value;
  writeStorage(KEY, value ? "1" : null);
  tell();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // (Another tab of this browser changed it.)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    on = readStorage(KEY) === "1";
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

/** The box's state, and the way to change it. */
export function useLinkBox(): [boolean, (value: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => on, () => false), setLinkBox];
}
